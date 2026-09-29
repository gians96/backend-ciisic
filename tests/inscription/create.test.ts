import type { Evento } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/database/prisma'
import { crearInscripcion } from '../../src/api/inscription/services/inscription'
import { firmarVerificacion } from '../../src/api/student-verification/services/verification-token'
import { verificarEstudiante } from '../../src/api/student-verification/services/student-verification'
import type { CrearInscripcionInput } from '../../src/api/inscription/validation'

jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        tipoInscripcion: { findFirst: jest.fn() },
        clasificacion: { findUnique: jest.fn() },
        personaConsultada: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { findUnique: jest.fn(), create: jest.fn() },
    }
    mock.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mock))
    return { prisma: mock }
})

jest.mock('../../src/api/student-verification/services/student-verification', () => ({
    ...jest.requireActual('../../src/api/student-verification/services/student-verification'),
    verificarEstudiante: jest.fn(),
}))

const m = prisma as unknown as {
    tipoInscripcion: { findFirst: jest.Mock }, clasificacion: { findUnique: jest.Mock }, personaConsultada: { findUnique: jest.Mock }
    participante: { findUnique: jest.Mock, create: jest.Mock, update: jest.Mock }, inscripcion: { findUnique: jest.Mock, create: jest.Mock }
}

const evento = {
    id: 1, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO', inscripcionesAbiertas: true, inscripcionesInicio: null, inscripcionesFin: null,
    dominioInstitucional: 'undc.edu.pe',
} as unknown as Evento

const tipoEstudiante = {
    id: 1, activo: true, precio: new Prisma.Decimal(120), precioInstitucional: new Prisma.Decimal(100),
    categoria: { id: 1, eventoId: 1, codigo: 'ESTUDIANTES', esEstudiantil: true },
}
const tipoGeneral = {
    id: 3, activo: true, precio: new Prisma.Decimal(140), precioInstitucional: new Prisma.Decimal(120),
    categoria: { id: 2, eventoId: 1, codigo: 'PUBLICO_GENERAL', esEstudiantil: false },
}

function input(extra: Partial<CrearInscripcionInput> = {}): CrearInscripcionInput {
    return {
        participante: { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Juan', apellidos: 'Pérez', correo: '2020123456@undc.edu.pe', celular: '987654321' },
        tipoInscripcionId: 1,
        clasificacionId: null,
        modalidadPago: 'banco',
        banco: 'bcp',
        tipoOperacion: 'directo',
        billeteraDigital: 'yape',
        numeroOperacion: 'OP-123',
        fechaPago: '2026-09-20',
        verificacionToken: null,
        ...extra,
    }
}

function tokenValido(esEstudianteUndc = true) {
    return firmarVerificacion({
        eventoId: 1, tipoDocumento: 'dni', numeroDocumento: '12345678', correo: '2020123456@undc.edu.pe', esEstudianteUndc,
        codigoEstudiante: '2020123456', carrera: 'INGENIERÍA DE SISTEMAS', matriculadoSemestreActivo: true, criterio: 'NOMBRE', motivo: null,
        verificadoEn: new Date().toISOString(),
    })
}

const datosCreados = () => m.inscripcion.create.mock.calls[0][0].data

beforeEach(() => {
    jest.clearAllMocks()
    m.tipoInscripcion.findFirst.mockResolvedValue(tipoEstudiante)
    m.personaConsultada.findUnique.mockResolvedValue(null)
    m.participante.findUnique.mockResolvedValue(null)
    m.participante.create.mockImplementation(({ data }) => Promise.resolve({ id: 10, ...data }))
    m.participante.update.mockImplementation(({ data }) => Promise.resolve({ id: 10, ...data }))
    m.inscripcion.findUnique.mockResolvedValue(null)
    m.inscripcion.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))
})

describe('crear inscripción', () => {
    it('siempre nace PENDIENTE y el monto lo calcula el servidor', async () => {
        await crearInscripcion(evento, input(), 'voucher-1.png')
        const data = datosCreados()
        expect(data.estado).toEqual({ connect: { codigo: 'PENDIENTE' } })
        expect(data.monto).toBe(120)
        expect(data.voucherArchivo).toBe('voucher-1.png')
        expect(data.esEstudianteUndc).toBe(false)
        expect(data.verificacionEstudiante).toMatchObject({ esEstudianteUndc: false, motivo: 'SIN_VERIFICACION' })
    })

    it('aplica el precio UNDC con un token de verificación válido', async () => {
        await crearInscripcion(evento, input({ verificacionToken: tokenValido() }), 'v.png')
        const data = datosCreados()
        expect(data.monto).toBe(100)
        expect(data.descuento).toBe(20)
        expect(data.esEstudianteUndc).toBe(true)
        expect(data.codigoEstudiante).toBe('2020123456')
    })

    it('ignora un token emitido para otro correo', async () => {
        const otro = input({ verificacionToken: tokenValido() })
        otro.participante.correo = '2020999999@undc.edu.pe'
        await crearInscripcion(evento, otro, 'v.png')
        expect(datosCreados().monto).toBe(120)
    })

    it('categoría general usa el dominio del correo', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue(tipoGeneral)
        await crearInscripcion(evento, input({ tipoInscripcionId: 3 }), 'v.png')
        expect(datosCreados().monto).toBe(120)
    })

    it('exige voucher en la ruta nueva', async () => {
        await expect(crearInscripcion(evento, input(), null)).rejects.toMatchObject({ status: 422, code: 'VOUCHER_REQUIRED' })
    })

    it('rechaza tipos de otro evento o inactivos', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue(null)
        await expect(crearInscripcion(evento, input(), 'v.png')).rejects.toMatchObject({ status: 422, code: 'REGISTRATION_TYPE_INVALID' })
    })

    it('rechaza cuando las inscripciones están cerradas', async () => {
        await expect(crearInscripcion({ ...evento, inscripcionesAbiertas: false }, input(), 'v.png')).rejects.toMatchObject({ status: 409, code: 'REGISTRATION_CLOSED' })
    })

    it('no permite dos inscripciones de la misma persona en el mismo evento', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.correo ? { id: 10 } : { id: 10 }))
        m.inscripcion.findUnique.mockResolvedValue({ id: 5 })
        await expect(crearInscripcion(evento, input(), 'v.png')).rejects.toMatchObject({ status: 409, code: 'ALREADY_REGISTERED' })
    })

    it('reutiliza al participante de un evento anterior', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.correo ? null : { id: 10, correo: '2020123456@undc.edu.pe' }))
        await crearInscripcion(evento, input(), 'v.png')
        expect(m.participante.create).not.toHaveBeenCalled()
        expect(m.participante.update.mock.calls[0][0].data).not.toHaveProperty('googleSub')
    })

    it('guarda la evidencia de correo verificado con Google solo si el token coincide', async () => {
        const { firmarVerificacionCorreo } = await import('../../src/api/google-auth/services/verificacion-correo')
        const base = { correo: '2020123456@undc.edu.pe', tipoCuenta: 'ESTUDIANTE' as const, hd: 'undc.edu.pe', metodo: 'GOOGLE' as const, verificadoEn: '2026-09-29T20:00:00.000Z' }
        await crearInscripcion(evento, { ...input(), verificacionCorreoToken: firmarVerificacionCorreo({ ...base, eventoId: evento.id }) }, 'v.png')
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ esCorreoVerificado: true, verificacionCorreo: { metodo: 'GOOGLE', tipoCuenta: 'ESTUDIANTE', hd: 'undc.edu.pe' } })

        m.inscripcion.create.mockClear()
        await crearInscripcion(evento, { ...input(), verificacionCorreoToken: firmarVerificacionCorreo({ ...base, eventoId: 999 }) }, 'v.png')
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ esCorreoVerificado: false })
    })

    it('si el participante cambia de correo se deshace su vínculo con Google', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.correo ? null : { id: 10, correo: 'anterior@gmail.com', googleSub: 'g-1' }))
        await crearInscripcion(evento, input(), 'v.png')
        expect(m.participante.update.mock.calls[0][0].data).toMatchObject({ correo: '2020123456@undc.edu.pe', googleSub: null, googleVinculadoEn: null })
    })

    it('rechaza un correo que pertenece a otra persona', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.correo ? { id: 77 } : null))
        await expect(crearInscripcion(evento, input(), 'v.png')).rejects.toMatchObject({ status: 409, code: 'EMAIL_IN_USE' })
    })

    it('usa los nombres oficiales de RENIEC cuando existen en caché', async () => {
        m.personaConsultada.findUnique.mockResolvedValue({ numeroDocumento: '12345678', nombres: 'JUAN CARLOS', apellidoPaterno: 'PÉREZ', apellidoMaterno: 'GARCÍA' })
        await crearInscripcion(evento, input(), 'v.png')
        expect(m.participante.create.mock.calls[0][0].data).toMatchObject({ nombres: 'JUAN CARLOS', apellidos: 'PÉREZ GARCÍA' })
    })

    it('traduce el número de operación duplicado', async () => {
        m.inscripcion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_inscripciones_numero_operacion' } }))
        await expect(crearInscripcion(evento, input(), 'v.png')).rejects.toMatchObject({ status: 409, code: 'OPERATION_ALREADY_REGISTERED' })
    })

    it('modo legacy: voucher opcional, precio por dominio y verificación informativa', async () => {
        ;(verificarEstudiante as jest.Mock).mockResolvedValue({ esEstudianteUndc: false, motivo: 'SERVICIO_NO_DISPONIBLE', codigoEstudiante: null, verificadoEn: 'x' })
        await crearInscripcion(evento, input(), null, { legacy: true })
        const data = datosCreados()
        expect(data.monto).toBe(100)
        expect(data.voucherArchivo).toBeNull()
        expect(data.verificacionEstudiante).toMatchObject({ motivo: 'SERVICIO_NO_DISPONIBLE' })
    })
})

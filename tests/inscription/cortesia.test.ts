import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { REGEX_CODIGO_CREDENCIAL } from '../../src/core/codigos'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { generarCredencialPdf } from '../../src/api/inscription/utils/generatePdf'
import { enviarCorreoAprobacion } from '../../src/api/inscription/utils/sendEmail'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/** `POST /v1/events/:eventId/courtesy-inscriptions` (spec 014). */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn() },
        tipoInscripcion: { findFirst: jest.fn() },
        inscripcion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    },
}))
jest.mock('../../src/api/inscription/utils/generatePdf', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/generatePdf'),
    generarCredencialPdf: jest.fn(),
}))
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoAprobacion: jest.fn() }))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }, participante: { findUnique: Mock }, tipoInscripcion: { findFirst: Mock }
    inscripcion: { findUnique: Mock, create: Mock, update: Mock }
}
const generarPdf = generarCredencialPdf as Mock
const enviarCorreo = enviarCorreoAprobacion as Mock

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', dominioInstitucional: 'undc.edu.pe' }
const participante = { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@undc.edu.pe', celular: '987654321' }
const tipo = {
    id: 7, codigo: 'PONENTE', nombre: 'Ponente', etiqueta: null, precio: new Prisma.Decimal(0), precioInstitucional: new Prisma.Decimal(0),
    categoria: { id: 3, codigo: 'INVITADOS', nombre: 'Invitados', esEstudiantil: false },
}

/** Lo que devolvería la BD para los datos creados (con las relaciones de `detalleInclude`). */
function detalle(data: Record<string, unknown>, cambios: Record<string, unknown> = {}) {
    return {
        id: 120, eventoId: 2, participanteId: 50, tipoInscripcionId: data.tipoInscripcion ? 7 : null, clasificacionId: null, estadoId: 3,
        creadoEn: new Date('2026-10-01T15:00:00Z'), actualizadoEn: new Date('2026-10-01T15:00:00Z'),
        banco: null, tipoOperacion: null, billeteraDigital: null, modalidadPago: data.modalidadPago, numeroOperacion: data.numeroOperacion,
        fechaPago: new Date('2026-10-01T00:00:00Z'), voucherArchivo: null, monto: new Prisma.Decimal(0), descuento: new Prisma.Decimal(0),
        tieneDescuento: false, esCorreoInstitucional: data.esCorreoInstitucional, esEstudianteUndc: false, codigoEstudiante: null,
        verificacionEstudiante: null, esCorreoVerificado: false, verificacionCorreo: null, motivoRechazo: null, revisadoPorId: 2,
        revisadoEn: data.revisadoEn, credencialEnviadaEn: null, codigoCredencial: data.codigoCredencial, esQrLegado: false,
        evento, participante, tipoInscripcion: data.tipoInscripcion ? tipo : null, clasificacion: null,
        estado: { id: 3, codigo: 'APROBADO', nombre: 'Aprobado' }, revisadoPor: { id: 2, nombres: 'Test', apellidos: 'Administrador del sistema' },
        ...cambios,
    }
}

let creada: ReturnType<typeof detalle> | null = null
const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const enviar = (cuerpo: Record<string, unknown>, cabeceras = admin(), eventoId = 2) =>
    request(app).post(`/api/v1/events/${eventoId}/courtesy-inscriptions`).set(cabeceras).send(cuerpo)
const datosCreados = (llamada = 0) => m.inscripcion.create.mock.calls[llamada][0].data

beforeEach(() => {
    jest.clearAllMocks()
    creada = null
    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 2 ? evento : null))
    m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 50 ? participante : null))
    m.tipoInscripcion.findFirst.mockImplementation(({ where }) => Promise.resolve(where.id === 7 && where.categoria.eventoId === 2 ? { id: 7 } : null))
    m.inscripcion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id && creada ? creada : null))
    m.inscripcion.create.mockImplementation(({ data }) => {
        creada = detalle(data)
        return Promise.resolve(creada)
    })
    m.inscripcion.update.mockResolvedValue({})
    generarPdf.mockResolvedValue('/tmp/credencial.pdf')
    enviarCorreo.mockResolvedValue(true)
})

describe('inscripción de cortesía', () => {
    it('nace APROBADO, con monto 0, modalidad cortesia, CORTESIA-<aleatorio> y revisada por quien la registra', async () => {
        const r = await enviar({ participanteId: 50, tipoInscripcionId: 7 })
        expect(r.status).toBe(201)
        const data = datosCreados()
        expect(data).toMatchObject({
            evento: { connect: { id: 2 } },
            participante: { connect: { id: 50 } },
            tipoInscripcion: { connect: { id: 7 } },
            estado: { connect: { codigo: 'APROBADO' } },
            modalidadPago: 'cortesia',
            monto: 0,
            descuento: 0,
            tieneDescuento: false,
            esCorreoInstitucional: true,
            revisadoPor: { connect: { id: 2 } },
        })
        expect(data.codigoCredencial).toMatch(REGEX_CODIGO_CREDENCIAL)
        // El número de operación sale en listados, CSV y búsquedas: nunca lleva el código del QR
        expect(data.numeroOperacion).toMatch(/^CORTESIA-[0-9A-F]{12}$/)
        expect(data.numeroOperacion).not.toContain(data.codigoCredencial)
        expect(data.revisadoEn).toBeInstanceOf(Date)
        expect(r.body.data).toMatchObject({
            id: 120,
            estado: { codigo: 'APROBADO' },
            codigoCredencial: data.codigoCredencial,
            pago: { monto: 0, modalidad: 'cortesia', numeroOperacion: data.numeroOperacion, tieneVoucher: false },
            revision: { revisadoPor: { id: 2 } },
            credencialEnviada: null,
        })
        expect(generarPdf).not.toHaveBeenCalled()
        expect(enviarCorreo).not.toHaveBeenCalled()
    })

    it('el tipo es opcional', async () => {
        const r = await enviar({ participanteId: 50 })
        expect(r.status).toBe(201)
        expect(datosCreados()).not.toHaveProperty('tipoInscripcion')
        expect(m.tipoInscripcion.findFirst).not.toHaveBeenCalled()
        expect(r.body.data.tipoInscripcion).toBeNull()
    })

    it('con enviarCredencial genera y envía la credencial como al aprobar', async () => {
        const r = await enviar({ participanteId: 50, enviarCredencial: true })
        expect(r.status).toBe(201)
        expect(r.body.data.credencialEnviada).toBe(true)
        expect(generarPdf).toHaveBeenCalledTimes(1)
        expect(generarPdf.mock.calls[0][0]).toMatchObject({ id: 120, codigoCredencial: datosCreados().codigoCredencial })
        expect(enviarCorreo).toHaveBeenCalledWith(expect.objectContaining({ id: 120 }), '/tmp/credencial.pdf')
        expect(m.inscripcion.update).toHaveBeenCalledWith({ where: { id: 120 }, data: { credencialEnviadaEn: expect.any(Date) } })
    })

    it('si el correo falla la inscripción se mantiene y credencialEnviada es false', async () => {
        enviarCorreo.mockResolvedValue(false)
        const r = await enviar({ participanteId: 50, enviarCredencial: true })
        expect(r.status).toBe(201)
        expect(r.body.data.credencialEnviada).toBe(false)
        expect(m.inscripcion.update).not.toHaveBeenCalled()
    })

    it('un tipo de otro evento responde 422 REGISTRATION_TYPE_INVALID', async () => {
        const r = await enviar({ participanteId: 50, tipoInscripcionId: 8 })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('REGISTRATION_TYPE_INVALID')
        expect(m.tipoInscripcion.findFirst.mock.calls[0][0].where).toEqual({ id: 8, categoria: { eventoId: 2 } })
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('si ya tiene inscripción en el evento responde 409 ALREADY_REGISTERED', async () => {
        m.inscripcion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.eventoId_participanteId ? { id: 5 } : null))
        const r = await enviar({ participanteId: 50 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ALREADY_REGISTERED')
        expect(m.inscripcion.findUnique.mock.calls[0][0].where).toEqual({ eventoId_participanteId: { eventoId: 2, participanteId: 50 } })
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('una inscripción creada a la vez por otra vía también es 409 ALREADY_REGISTERED', async () => {
        m.inscripcion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_inscripciones_evento_participante' } }))
        const r = await enviar({ participanteId: 50 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ALREADY_REGISTERED')
    })

    it('participante o evento inexistentes responden 404', async () => {
        const sinPersona = await enviar({ participanteId: 99 })
        expect(sinPersona.status).toBe(404)
        expect(sinPersona.body.code).toBe('PARTICIPANT_NOT_FOUND')
        const sinEvento = await enviar({ participanteId: 50 }, admin(), 9)
        expect(sinEvento.status).toBe(404)
        expect(sinEvento.body.code).toBe('EVENT_NOT_FOUND')
    })

    it('si el código choca (con su índice o con el número de operación) se reintenta con otro', async () => {
        const choque = (target: string) => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target } })
        m.inscripcion.create
            .mockRejectedValueOnce(choque('uq_inscripciones_codigo_credencial'))
            .mockRejectedValueOnce(choque('uq_inscripciones_numero_operacion'))
        const r = await enviar({ participanteId: 50 })
        expect(r.status).toBe(201)
        expect(m.inscripcion.create).toHaveBeenCalledTimes(3)
        const codigos = [0, 1, 2].map((i) => datosCreados(i).codigoCredencial)
        expect(new Set(codigos).size).toBe(3)
        // Cada intento con un número de operación nuevo también
        expect(new Set([0, 1, 2].map((i) => datosCreados(i).numeroOperacion)).size).toBe(3)
        expect(r.body.data.codigoCredencial).toBe(codigos[2])
    })

    it('tras 3 choques responde 409 DUPLICATE_RECORD', async () => {
        m.inscripcion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_inscripciones_codigo_credencial' } }))
        const r = await enviar({ participanteId: 50 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DUPLICATE_RECORD')
        expect(m.inscripcion.create).toHaveBeenCalledTimes(3)
    })

    it('valida el cuerpo (422 VALIDATION_ERROR)', async () => {
        const r = await enviar({ participanteId: 'x' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })

    it('solo las cuentas globales: Tesorero, Comisión y participante reciben 403 antes de validar', async () => {
        const tokens = [
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] }),
            tokenDeParticipante(50),
        ]
        for (const token of tokens) {
            const r = await enviar({ participanteId: 'x' }, { Authorization: `Bearer ${token}` })
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        const sinSesion = await request(app).post('/api/v1/events/2/courtesy-inscriptions').send({ participanteId: 50 })
        expect(sinSesion.status).toBe(401)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('el número de operación CORTESIA- no se puede usar desde un formulario', async () => {
        const { crearInscripcionSchema } = await import('../../src/api/inscription/validation')
        await expect(crearInscripcionSchema.validateAt('numeroOperacion', { numeroOperacion: 'cortesia-ABC' })).rejects.toThrow()
        await expect(crearInscripcionSchema.validateAt('numeroOperacion', { numeroOperacion: 'OP-123' })).resolves.toBe('OP-123')
    })
})

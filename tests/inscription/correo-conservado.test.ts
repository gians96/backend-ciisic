import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { crearInscripcion } from '../../src/api/inscription/services/inscription'
import { firmarVerificacionCorreo } from '../../src/api/google-auth/services/verificacion-correo'
import { enviarAvisoCorreoConservado } from '../../src/api/inscription/utils/sendEmail'
import type { CrearInscripcionInput } from '../../src/api/inscription/validation'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

/**
 * Regla del correo al reinscribirse (spec 014): un correo distinto del registrado nunca lo reemplaza
 * desde el formulario público, ni verificado con Google (eso solo prueba el correo nuevo, no que sea
 * el dueño del documento: sería una toma de cuenta). La inscripción se hace con el participante tal
 * cual, sin 409, se avisa al correo registrado y el precio sale del correo registrado.
 */
jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        tipoInscripcion: { findFirst: jest.fn() },
        clasificacion: { findUnique: jest.fn() },
        personaConsultada: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { findUnique: jest.fn(), create: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        evento: { findFirst: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    }
    mock.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mock))
    return { prisma: mock }
})

// El aviso se simula (Brevo); `enDiferido` corre la tarea en el acto para poder comprobarla
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/sendEmail'),
    enDiferido: jest.fn((_descripcion: string, tarea: () => Promise<unknown>) => {
        void tarea()
    }),
    enviarAvisoCorreoConservado: jest.fn(async () => true),
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    tipoInscripcion: { findFirst: Mock }, clasificacion: { findUnique: Mock }, personaConsultada: { findUnique: Mock }
    participante: { findUnique: Mock, create: Mock, update: Mock }, inscripcion: { findUnique: Mock, create: Mock }
    tokenAcceso: { findUnique: Mock, update: Mock }, evento: { findFirst: Mock }, configuracionSistema: { findUnique: Mock }
}
const aviso = enviarAvisoCorreoConservado as Mock

const evento = {
    id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', esPrincipal: true,
    inscripcionesAbiertas: true, inscripcionesInicio: null, inscripcionesFin: null, dominioInstitucional: 'undc.edu.pe',
} as unknown as Evento

const tipoGeneral = {
    id: 3, codigo: 'GENERAL', nombre: 'General', etiqueta: null, activo: true, precio: new Prisma.Decimal(140), precioInstitucional: new Prisma.Decimal(120),
    categoria: { id: 2, eventoId: 2, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', esEstudiantil: false },
}

/** Participante registrado en un evento anterior, con Google vinculado. */
const REGISTRADO = {
    id: 10, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321',
    googleSub: 'g-ana', googleVinculadoEn: new Date('2026-01-01T00:00:00Z'), fotoArchivo: null,
}
/** Estado del participante en la «BD» simulada. */
let participanteActual: typeof REGISTRADO
/** Otra persona, dueña del correo `otra@gmail.com`. */
const OTRA = { ...REGISTRADO, id: 77, numeroDocumento: '87654321', correo: 'otra@gmail.com' }

function input(correo: string, extra: Partial<CrearInscripcionInput> = {}): CrearInscripcionInput {
    return {
        participante: { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo, celular: '911222333' },
        tipoInscripcionId: 3,
        clasificacionId: null,
        modalidadPago: 'banco',
        banco: 'bcp',
        tipoOperacion: 'directo',
        billeteraDigital: null,
        numeroOperacion: 'OP-123',
        fechaPago: '2026-09-20',
        verificacionToken: null,
        verificacionCorreoToken: null,
        ...extra,
    }
}

function tokenGoogle(correo: string, eventoId = evento.id) {
    return firmarVerificacionCorreo({ correo, tipoCuenta: 'PERSONAL', hd: null, metodo: 'GOOGLE', verificadoEn: '2026-09-29T20:00:00.000Z', eventoId })
}

beforeEach(() => {
    jest.clearAllMocks()
    participanteActual = { ...REGISTRADO }
    m.tipoInscripcion.findFirst.mockResolvedValue(tipoGeneral)
    m.personaConsultada.findUnique.mockResolvedValue(null)
    m.participante.findUnique.mockImplementation(({ where }) => {
        if (where.correo) return Promise.resolve([participanteActual, OTRA].find((p) => p.correo === where.correo) ?? null)
        return Promise.resolve(where.tipoDocumentoId_numeroDocumento?.numeroDocumento === participanteActual.numeroDocumento ? participanteActual : null)
    })
    m.participante.update.mockImplementation(({ data }) => {
        participanteActual = { ...participanteActual, ...data }
        return Promise.resolve(participanteActual)
    })
    m.participante.create.mockImplementation(({ data }) => Promise.resolve({ id: 11, googleSub: null, googleVinculadoEn: null, fotoArchivo: null, ...data }))
    m.inscripcion.findUnique.mockResolvedValue(null)
    m.inscripcion.create.mockImplementation(({ data }) => Promise.resolve({
        id: 99, eventoId: evento.id, participanteId: data.participante.connect.id, tipoInscripcionId: 3, clasificacionId: null, estadoId: 1,
        creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        banco: data.banco, tipoOperacion: data.tipoOperacion, billeteraDigital: data.billeteraDigital, modalidadPago: data.modalidadPago,
        numeroOperacion: data.numeroOperacion, fechaPago: new Date('2026-09-20T00:00:00Z'), voucherArchivo: data.voucherArchivo,
        monto: new Prisma.Decimal(data.monto), descuento: new Prisma.Decimal(data.descuento), tieneDescuento: data.tieneDescuento,
        esCorreoInstitucional: data.esCorreoInstitucional, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: data.esCorreoVerificado, verificacionCorreo: null, motivoRechazo: null, revisadoPorId: null, revisadoEn: null,
        credencialEnviadaEn: null, codigoCredencial: data.codigoCredencial, esQrLegado: false,
        evento, participante: data.participante.connect.id === participanteActual.id ? participanteActual : { ...REGISTRADO, id: 11 },
        tipoInscripcion: tipoGeneral, clasificacion: null, estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' }, revisadoPor: null,
    }))
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
    m.tokenAcceso.update.mockResolvedValue({})
    m.evento.findFirst.mockResolvedValue(evento)
    m.configuracionSistema.findUnique.mockResolvedValue(null)
})

describe('reinscripción con otro correo (servicio)', () => {
    it('sin verificación con Google conserva el correo registrado, no responde 409 y avisa al correo registrado', async () => {
        // El correo nuevo es incluso de otra persona: antes era 409 EMAIL_IN_USE
        const creada = await crearInscripcion(evento, input('otra@gmail.com'), 'v.png')

        expect(creada.correoConservado).toBe(true)
        expect(m.participante.update).not.toHaveBeenCalled()
        expect(m.participante.create).not.toHaveBeenCalled()
        expect(m.inscripcion.create.mock.calls[0][0].data.participante).toEqual({ connect: { id: 10 } })
        expect(creada.participante).toMatchObject({ correo: 'ana@gmail.com', celular: '987654321', googleSub: 'g-ana' })
        // Aviso al correo registrado, con el correo ingresado enmascarado
        expect(aviso).toHaveBeenCalledTimes(1)
        expect(aviso.mock.calls[0][0].participante.correo).toBe('ana@gmail.com')
        expect(aviso.mock.calls[0][1]).toBe('o***@g***.com')
    })

    it('si hay nombres oficiales (RENIEC) los actualiza sin tocar el contacto ni Google', async () => {
        m.personaConsultada.findUnique.mockResolvedValue({ numeroDocumento: '12345678', nombres: 'ANA LUCÍA', apellidoPaterno: 'PÉREZ', apellidoMaterno: 'RÍOS' })
        const creada = await crearInscripcion(evento, input('nuevo@gmail.com'), 'v.png')
        expect(creada.correoConservado).toBe(true)
        expect(m.participante.update).toHaveBeenCalledTimes(1)
        expect(m.participante.update.mock.calls[0][0].data).toEqual({ nombres: 'ANA LUCÍA', apellidos: 'PÉREZ RÍOS' })
    })

    it('aunque el correo nuevo venga verificado con Google, no lo cambia ni deshace el vínculo con Google (toma de cuenta)', async () => {
        // Quien conoce el DNI de alguien verifica SU Gmail: antes eso le daba el correo de la víctima
        // (y con él su portal, su fotocheck y sus credenciales futuras)
        const creada = await crearInscripcion(evento, input('atacante@gmail.com', { verificacionCorreoToken: tokenGoogle('atacante@gmail.com') }), 'v.png')
        expect(creada.correoConservado).toBe(true)
        expect(m.participante.update).not.toHaveBeenCalled()
        expect(participanteActual).toMatchObject({ correo: 'ana@gmail.com', googleSub: 'g-ana' })
        // La verificación era del correo ingresado, no del de la inscripción
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ esCorreoVerificado: false, verificacionCorreo: Prisma.JsonNull })
        // La víctima se entera
        expect(aviso).toHaveBeenCalledTimes(1)
        expect(aviso.mock.calls[0][0].participante.correo).toBe('ana@gmail.com')
        expect(aviso.mock.calls[0][1]).toBe('a***@g***.com')
    })

    it('verificado o no, un correo de otra persona no da 409: se conserva el registrado', async () => {
        const creada = await crearInscripcion(evento, input('otra@gmail.com', { verificacionCorreoToken: tokenGoogle('otra@gmail.com') }), 'v.png')
        expect(creada.correoConservado).toBe(true)
        expect(m.inscripcion.create.mock.calls[0][0].data.participante).toEqual({ connect: { id: 10 } })
    })

    it('el precio institucional sale del correo registrado, no del ingresado', async () => {
        // Registrado con Gmail, escribe un correo institucional ajeno: precio regular y sin la marca
        const conGmail = await crearInscripcion(evento, input('cualquiera@undc.edu.pe'), 'v.png')
        expect(conGmail.correoConservado).toBe(true)
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ monto: 140, descuento: 0, esCorreoInstitucional: false })
        // También por la ruta legacy (regla histórica por dominio)
        await crearInscripcion(evento, input('cualquiera@undc.edu.pe'), null, { legacy: true })
        expect(m.inscripcion.create.mock.calls[1][0].data).toMatchObject({ monto: 140, esCorreoInstitucional: false })
        // Registrado con el correo institucional: lo conserva aunque escriba un Gmail
        participanteActual = { ...REGISTRADO, correo: '2020100100@undc.edu.pe' }
        await crearInscripcion(evento, input('ana@gmail.com'), 'v.png')
        expect(m.inscripcion.create.mock.calls[2][0].data).toMatchObject({ monto: 120, descuento: 20, esCorreoInstitucional: true })
        // Sin cambio de correo, como siempre
        participanteActual = { ...REGISTRADO, correo: 'ana@undc.edu.pe' }
        await crearInscripcion(evento, input('ana@undc.edu.pe'), 'v.png')
        expect(m.inscripcion.create.mock.calls[3][0].data).toMatchObject({ monto: 120, esCorreoInstitucional: true })
    })

    it('una verificación de otro evento o de otro correo no sirve: se conserva el correo', async () => {
        for (const token of [tokenGoogle('nuevo@gmail.com', 999), tokenGoogle('distinto@gmail.com')]) {
            const creada = await crearInscripcion(evento, input('nuevo@gmail.com', { verificacionCorreoToken: token }), 'v.png')
            expect(creada.correoConservado).toBe(true)
        }
        expect(m.participante.update).not.toHaveBeenCalled()
    })

    it('la ruta legacy nunca cambia el correo, aunque llegue una verificación válida', async () => {
        const creada = await crearInscripcion(evento, input('nuevo@gmail.com', { verificacionCorreoToken: tokenGoogle('nuevo@gmail.com') }), null, { legacy: true })
        expect(creada.correoConservado).toBe(true)
        expect(m.participante.update).not.toHaveBeenCalled()
        expect(aviso).toHaveBeenCalledTimes(1)
    })

    it('el mismo correo (sin importar mayúsculas) no es un cambio: actualiza el celular y no avisa', async () => {
        const creada = await crearInscripcion(evento, input('ANA@gmail.com', { verificacionCorreoToken: tokenGoogle('ana@gmail.com') }), 'v.png')
        expect(creada.correoConservado).toBe(false)
        expect(m.participante.update.mock.calls[0][0].data).toEqual({ celular: '911222333' })
        // Aquí la verificación sí es del correo de la inscripción
        expect(m.inscripcion.create.mock.calls[0][0].data.esCorreoVerificado).toBe(true)
        expect(aviso).not.toHaveBeenCalled()
    })

    it('una persona nueva se registra con su correo; si es de otra persona, 409 EMAIL_IN_USE', async () => {
        const nueva = { ...input('nueva@gmail.com'), participante: { ...input('nueva@gmail.com').participante, numeroDocumento: '11112222' } }
        const creada = await crearInscripcion(evento, nueva, 'v.png')
        expect(creada.correoConservado).toBe(false)
        expect(m.participante.create.mock.calls[0][0].data).toMatchObject({ correo: 'nueva@gmail.com' })

        const ajena = { ...nueva, participante: { ...nueva.participante, correo: 'otra@gmail.com' } }
        await expect(crearInscripcion(evento, ajena, 'v.png')).rejects.toMatchObject({ status: 409, code: 'EMAIL_IN_USE' })
    })

    it('si ya tiene inscripción en el evento responde 409 ALREADY_REGISTERED sin avisar', async () => {
        m.inscripcion.findUnique.mockResolvedValue({ id: 5 })
        await expect(crearInscripcion(evento, input('nuevo@gmail.com'), 'v.png')).rejects.toMatchObject({ status: 409, code: 'ALREADY_REGISTERED' })
        expect(aviso).not.toHaveBeenCalled()
    })
})

// PNG mínimo: basta la firma para `validateUploadedFileContent`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])

describe('respuesta del sitio y de la ruta legacy', () => {
    function enviarAlSitio(correo: string, extra: Record<string, string> = {}) {
        let solicitud = request(app).post('/api/v1/site/inscriptions').set('X-Api-Key', TOKEN_SITIO)
        const campos: Record<string, string> = {
            participante: JSON.stringify(input(correo).participante),
            tipoInscripcionId: '3', modalidadPago: 'banco', banco: 'bcp', tipoOperacion: 'directo', numeroOperacion: 'OP-123', fechaPago: '2026-09-20',
            ...extra,
        }
        for (const [campo, valor] of Object.entries(campos)) solicitud = solicitud.field(campo, valor)
        return solicitud.attach('voucher', PNG, { filename: 'voucher.png', contentType: 'image/png' })
    }

    it('sitio: correoConservado y correoEnmascarado; el correo registrado sale enmascarado y el celular, oculto', async () => {
        const r = await enviarAlSitio('nuevo@gmail.com')
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ correoConservado: true, correoEnmascarado: 'a***@g***.com' })
        expect(r.body.data.participante).toMatchObject({ correo: 'a***@g***.com', celular: '*********', numeroDocumento: '12345678' })
        expect(JSON.stringify(r.body)).not.toContain('ana@gmail.com')
        expect(JSON.stringify(r.body)).not.toMatch(/321|987654321/)
    })

    it('sitio: sin cambio de correo, correoConservado false, correoEnmascarado null y el contacto completo', async () => {
        const r = await enviarAlSitio('ana@gmail.com')
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ correoConservado: false, correoEnmascarado: null })
        expect(r.body.data.participante).toMatchObject({ correo: 'ana@gmail.com', celular: '911222333' })
    })

    it('sitio: con verificación de Google válida del correo nuevo también se conserva el registrado', async () => {
        const r = await enviarAlSitio('nuevo@gmail.com', { verificacionCorreoToken: tokenGoogle('nuevo@gmail.com') })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ correoConservado: true, correoEnmascarado: 'a***@g***.com', esCorreoVerificado: false })
        expect(r.body.data.participante.correo).toBe('a***@g***.com')
        expect(m.participante.update).not.toHaveBeenCalled()
    })

    it('legacy: la forma anterior más el aviso; el correo nunca cambia', async () => {
        const r = await request(app).post('/api/v1/inscription').send({
            usuario: { idTipoDocumentoId: 'dni', dni: '12345678', nombres: 'Ana', apellidos: 'Pérez', correoElectronico: 'nuevo@gmail.com', celular: '911222333' },
            tipoInscripcionId: 3, modalidadDeposito: 'banco', bancoSeleccionado: 'bcp', tipoOperacion: 'directo', numeroOperacion: 'OP-123', fechaPago: '2026-09-20',
        })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ id: 99, usuarioId: 10, correoConservado: true, correoEnmascarado: 'a***@g***.com' })
        expect(r.body.data.usuario).toMatchObject({ correoElectronico: 'a***@g***.com', celular: '*********', dni: '12345678' })
        expect(m.participante.update).not.toHaveBeenCalled()
        expect(aviso).toHaveBeenCalledTimes(1)
    })
})

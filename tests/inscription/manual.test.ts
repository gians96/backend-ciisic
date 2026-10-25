import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { REGEX_CODIGO_CREDENCIAL } from '../../src/core/codigos'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { generarCredencialPdf } from '../../src/api/inscription/utils/generatePdf'
import { enviarCorreoAprobacion } from '../../src/api/inscription/utils/sendEmail'
import { crearParticipante } from '../../src/api/participant/services/participant'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/** `POST /v1/events/:eventId/manual-inscriptions` (spec 018). */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn() },
        tipoInscripcion: { findFirst: jest.fn() },
        clasificacion: { findUnique: jest.fn() },
        delegacion: { findFirst: jest.fn() },
        inscripcion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    },
}))
jest.mock('../../src/api/inscription/utils/generatePdf', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/generatePdf'),
    generarCredencialPdf: jest.fn(),
}))
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoAprobacion: jest.fn() }))
jest.mock('../../src/api/participant/services/participant', () => ({
    ...jest.requireActual('../../src/api/participant/services/participant'),
    crearParticipante: jest.fn(),
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    participante: { findUnique: Mock }
    tipoInscripcion: { findFirst: Mock }
    clasificacion: { findUnique: Mock }
    delegacion: { findFirst: Mock }
    inscripcion: { findUnique: Mock, create: Mock, update: Mock }
}
const altaParticipante = crearParticipante as Mock
const generarPdf = generarCredencialPdf as Mock
const enviarCorreo = enviarCorreoAprobacion as Mock

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', dominioInstitucional: 'undc.edu.pe' }
const participante = { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@undc.edu.pe', celular: '987654321' }
const tipo = {
    id: 7, codigo: 'ESTUDIANTE', nombre: 'Estudiante', etiqueta: null, precio: new Prisma.Decimal(150), precioInstitucional: new Prisma.Decimal(100),
    categoria: { id: 1, codigo: 'ESTUDIANTES', nombre: 'Estudiantes', esEstudiantil: true },
}
const delegacion = { id: 9, eventoId: 2, nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', activo: true }

/** Lo que devolvería la BD para los datos creados (con las relaciones de `detalleInclude`). */
function detalle(data: Record<string, unknown>, cambios: Record<string, unknown> = {}) {
    return {
        id: 130, eventoId: 2, participanteId: 50, tipoInscripcionId: data.tipoInscripcion ? 7 : null,
        clasificacionId: data.clasificacion ? 1 : null, delegacionId: data.delegacion ? 9 : null, estadoId: 3,
        creadoEn: new Date('2026-10-01T15:00:00Z'), actualizadoEn: new Date('2026-10-01T15:00:00Z'),
        banco: data.banco ?? null, tipoOperacion: data.tipoOperacion ?? null, billeteraDigital: data.billeteraDigital ?? null,
        modalidadPago: data.modalidadPago, numeroOperacion: data.numeroOperacion,
        fechaPago: new Date('2026-10-01T00:00:00Z'), voucherArchivo: null,
        monto: new Prisma.Decimal(data.monto as number), descuento: new Prisma.Decimal(data.descuento as number),
        tieneDescuento: Number(data.descuento) > 0, esCorreoInstitucional: true,
        esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, motivoRechazo: null,
        revisadoPorId: 2, revisadoEn: data.revisadoEn, credencialEnviadaEn: null,
        codigoCredencial: data.codigoCredencial, esQrLegado: false,
        evento, participante, tipoInscripcion: data.tipoInscripcion ? tipo : null,
        clasificacion: data.clasificacion ? { id: 1, nombre: 'ESTUDIANTE - I CICLO' } : null,
        delegacion: data.delegacion ? delegacion : null,
        estado: { id: 3, codigo: 'APROBADO', nombre: 'Aprobado' },
        revisadoPor: { id: 2, nombres: 'Test', apellidos: 'Administrador del sistema' },
        ...cambios,
    }
}

let creada: ReturnType<typeof detalle> | null = null
const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
/** Pago en efectivo registrado por el staff: la forma mínima válida. */
const pagoEnEfectivo = { modalidadPago: 'efectivo', numeroOperacion: 'OP-123', fechaPago: '2026-10-01', monto: 150 }
const enviar = (cuerpo: Record<string, unknown>, cabeceras = admin(), eventoId = 2) =>
    request(app).post(`/api/v1/events/${eventoId}/manual-inscriptions`).set(cabeceras).send(cuerpo)
const datosCreados = (llamada = 0) => m.inscripcion.create.mock.calls[llamada][0].data

beforeEach(() => {
    jest.clearAllMocks()
    creada = null
    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 2 ? evento : null))
    m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(
        where.id === 50 || where.tipoDocumentoId_numeroDocumento?.numeroDocumento === '12345678' ? participante : null,
    ))
    m.tipoInscripcion.findFirst.mockImplementation(({ where }) => Promise.resolve(where.id === 7 && where.categoria.eventoId === 2 ? { id: 7 } : null))
    m.clasificacion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 1 ? { id: 1 } : null))
    m.delegacion.findFirst.mockImplementation(({ where }) => Promise.resolve(where.id === 9 ? { eventoId: 2, activo: true } : null))
    m.inscripcion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.eventoId_participanteId ? null : (where.id && creada ? creada : null)))
    m.inscripcion.create.mockImplementation(({ data }) => {
        creada = detalle(data)
        return Promise.resolve(creada)
    })
    m.inscripcion.update.mockResolvedValue({})
    altaParticipante.mockResolvedValue({ id: 80, correo: 'juan@gmail.com' })
    generarPdf.mockResolvedValue('/tmp/credencial.pdf')
    enviarCorreo.mockResolvedValue(true)
})

describe('inscripción manual', () => {
    it('nace APROBADO, con el pago real del staff, sin voucher y revisada por quien la registra', async () => {
        const r = await enviar({ participanteId: 50, ...pagoEnEfectivo })
        expect(r.status).toBe(201)
        const data = datosCreados()
        expect(data).toMatchObject({
            evento: { connect: { id: 2 } },
            participante: { connect: { id: 50 } },
            estado: { connect: { codigo: 'APROBADO' } },
            modalidadPago: 'efectivo',
            numeroOperacion: 'OP-123',
            monto: 150,
            descuento: 0,
            tieneDescuento: false,
            voucherArchivo: null,
            esCorreoInstitucional: true,
            revisadoPor: { connect: { id: 2 } },
        })
        expect(data.codigoCredencial).toMatch(REGEX_CODIGO_CREDENCIAL)
        expect(data.revisadoEn).toBeInstanceOf(Date)
        expect(r.body.data).toMatchObject({
            id: 130,
            estado: { codigo: 'APROBADO' },
            codigoCredencial: data.codigoCredencial,
            pago: { monto: 150, modalidad: 'efectivo', numeroOperacion: 'OP-123', banco: null, tieneVoucher: false },
            credencialEnviada: null,
        })
        expect(generarPdf).not.toHaveBeenCalled()
        expect(enviarCorreo).not.toHaveBeenCalled()
    })

    it('vincula la inscripción a su delegación', async () => {
        const r = await enviar({ participanteId: 50, delegacionId: 9, ...pagoEnEfectivo })
        expect(r.status).toBe(201)
        expect(datosCreados().delegacion).toEqual({ connect: { id: 9 } })
        expect(m.delegacion.findFirst.mock.calls[0][0].where).toEqual({ id: 9 })
        expect(r.body.data.delegacion).toMatchObject({ id: 9, nombre: 'Salón 5to A' })
    })

    it('acepta tipo, clasificación y descuento, y redondea los montos a 2 decimales', async () => {
        const r = await enviar({
            participanteId: 50, tipoInscripcionId: 7, clasificacionId: 1,
            ...pagoEnEfectivo, monto: 99.999, descuento: 10.555,
        })
        expect(r.status).toBe(201)
        expect(datosCreados()).toMatchObject({
            tipoInscripcion: { connect: { id: 7 } },
            clasificacion: { connect: { id: 1 } },
            monto: 100,
            descuento: 10.56,
            tieneDescuento: true,
        })
        expect(r.body.data).toMatchObject({ pago: { monto: 100, descuento: 10.56, tieneDescuento: true } })
    })

    it('un pago en banco exige banco y tipo de operación; en billetera, la billetera', async () => {
        const sinBanco = await enviar({ participanteId: 50, modalidadPago: 'banco', numeroOperacion: 'OP-1', fechaPago: '2026-10-01', monto: 150 })
        expect(sinBanco.status).toBe(422)
        expect(sinBanco.body.code).toBe('VALIDATION_ERROR')
        expect(sinBanco.body.fields).toHaveProperty('banco')
        const sinBilletera = await enviar({ participanteId: 50, modalidadPago: 'billetera', numeroOperacion: 'OP-1', fechaPago: '2026-10-01', monto: 150 })
        expect(sinBilletera.status).toBe(422)
        expect(sinBilletera.body.fields).toHaveProperty('billeteraDigital')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('un pago en banco guarda banco y tipo de operación y limpia los campos de la otra modalidad', async () => {
        const r = await enviar({
            participanteId: 50, modalidadPago: 'banco', banco: 'BCP', tipoOperacion: 'interbancario',
            numeroOperacion: 'OP-777', fechaPago: '2026-10-01', monto: 150,
        })
        expect(r.status).toBe(201)
        expect(datosCreados()).toMatchObject({ banco: 'bcp', tipoOperacion: 'interbancario', billeteraDigital: null })
    })

    it('con datos de participante lo reutiliza por documento si ya existe', async () => {
        const r = await enviar({
            participante: { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@undc.edu.pe', celular: '987654321' },
            ...pagoEnEfectivo,
        })
        expect(r.status).toBe(201)
        expect(altaParticipante).not.toHaveBeenCalled()
        expect(datosCreados().participante).toEqual({ connect: { id: 50 } })
    })

    it('con datos de participante sin documento registrado lo da de alta', async () => {
        const r = await enviar({
            participante: { tipoDocumento: 'dni', numeroDocumento: '87654321', nombres: 'Juan', apellidos: 'Torres', correo: 'juan@gmail.com', celular: '987111222' },
            ...pagoEnEfectivo,
        })
        expect(r.status).toBe(201)
        expect(altaParticipante).toHaveBeenCalledWith(expect.objectContaining({ numeroDocumento: '87654321', correo: 'juan@gmail.com' }))
        expect(datosCreados().participante).toEqual({ connect: { id: 80 } })
    })

    it('con enviarCredencial genera y envía la credencial como al aprobar', async () => {
        const r = await enviar({ participanteId: 50, enviarCredencial: true, ...pagoEnEfectivo })
        expect(r.status).toBe(201)
        expect(r.body.data.credencialEnviada).toBe(true)
        expect(generarPdf).toHaveBeenCalledTimes(1)
        expect(enviarCorreo).toHaveBeenCalledWith(expect.objectContaining({ id: 130 }))
        expect(m.inscripcion.update).toHaveBeenCalledWith({ where: { id: 130 }, data: { credencialEnviadaEn: expect.any(Date) } })
    })

    it('un tipo o una clasificación de otro evento responde 422', async () => {
        const tipoInvalido = await enviar({ participanteId: 50, tipoInscripcionId: 8, ...pagoEnEfectivo })
        expect(tipoInvalido.status).toBe(422)
        expect(tipoInvalido.body.code).toBe('REGISTRATION_TYPE_INVALID')
        const clasificacionInvalida = await enviar({ participanteId: 50, clasificacionId: 5, ...pagoEnEfectivo })
        expect(clasificacionInvalida.status).toBe(422)
        expect(clasificacionInvalida.body.code).toBe('CLASSIFICATION_INVALID')
    })

    it('una delegación de otro evento o inactiva responde 422', async () => {
        const ajena = await enviar({ participanteId: 50, delegacionId: 10, ...pagoEnEfectivo })
        expect(ajena.status).toBe(422)
        expect(ajena.body.code).toBe('DELEGATION_INVALID')
        m.delegacion.findFirst.mockResolvedValue({ eventoId: 2, activo: false })
        const inactiva = await enviar({ participanteId: 50, delegacionId: 9, ...pagoEnEfectivo })
        expect(inactiva.status).toBe(422)
        expect(inactiva.body.code).toBe('DELEGATION_INACTIVE')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('si ya tiene inscripción en el evento responde 409 ALREADY_REGISTERED', async () => {
        m.inscripcion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.eventoId_participanteId ? { id: 5 } : null))
        const r = await enviar({ participanteId: 50, ...pagoEnEfectivo })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ALREADY_REGISTERED')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('un número de operación repetido responde 409 OPERATION_ALREADY_REGISTERED', async () => {
        m.inscripcion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_inscripciones_numero_operacion' } }))
        const r = await enviar({ participanteId: 50, ...pagoEnEfectivo })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
    })

    it('si el código de credencial choca se reintenta con otro y conserva el número de operación', async () => {
        m.inscripcion.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_inscripciones_codigo_credencial' } }))
        const r = await enviar({ participanteId: 50, ...pagoEnEfectivo })
        expect(r.status).toBe(201)
        expect(m.inscripcion.create).toHaveBeenCalledTimes(2)
        expect(datosCreados(1).numeroOperacion).toBe('OP-123')
        expect(datosCreados(1).codigoCredencial).not.toBe(datosCreados(0).codigoCredencial)
    })

    it('participante o evento inexistentes responden 404', async () => {
        const sinPersona = await enviar({ participanteId: 99, ...pagoEnEfectivo })
        expect(sinPersona.status).toBe(404)
        expect(sinPersona.body.code).toBe('PARTICIPANT_NOT_FOUND')
        const sinEvento = await enviar({ participanteId: 50, ...pagoEnEfectivo }, admin(), 9)
        expect(sinEvento.status).toBe(404)
        expect(sinEvento.body.code).toBe('EVENT_NOT_FOUND')
    })

    it('valida el cuerpo: sin persona, con las dos formas o con montos inválidos, 422', async () => {
        const sinPersona = await enviar(pagoEnEfectivo)
        expect(sinPersona.status).toBe(422)
        expect(sinPersona.body.code).toBe('VALIDATION_ERROR')
        const lasDos = await enviar({ participanteId: 50, participante: { tipoDocumento: 'dni', numeroDocumento: '87654321', nombres: 'Juan', apellidos: 'Torres', correo: 'juan@gmail.com', celular: '987111222' }, ...pagoEnEfectivo })
        expect(lasDos.status).toBe(422)
        const montoNegativo = await enviar({ participanteId: 50, ...pagoEnEfectivo, monto: -1 })
        expect(montoNegativo.status).toBe(422)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('el número de operación CORTESIA- no se puede usar', async () => {
        const { inscripcionManualSchema } = await import('../../src/api/inscription/validation')
        await expect(inscripcionManualSchema.validateAt('numeroOperacion', { numeroOperacion: 'cortesia-ABC', modalidadPago: 'efectivo', monto: 1, fechaPago: '2026-10-01' })).rejects.toThrow()
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
        const sinSesion = await request(app).post('/api/v1/events/2/manual-inscriptions').send({ participanteId: 50 })
        expect(sinSesion.status).toBe(401)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })
})

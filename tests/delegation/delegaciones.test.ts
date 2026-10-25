import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/** Delegaciones (spec 018): CRUD por evento y listado de sus miembros. */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn() },
        delegacion: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { count: jest.fn(), findMany: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    participante: { findUnique: Mock }
    delegacion: { findUnique: Mock, findMany: Mock, create: Mock, update: Mock }
    inscripcion: { count: Mock, findMany: Mock }
}

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', dominioInstitucional: 'undc.edu.pe' }
const delegado = { id: 50, nombres: 'Ana', apellidos: 'Pérez', tipoDocumentoId: 'dni', numeroDocumento: '12345678', correo: 'ana@undc.edu.pe' }

/** Fila de `delegaciones` con las relaciones de `incluirDelegacion`. */
function registro(cambios: Record<string, unknown> = {}) {
    return {
        id: 7, eventoId: 2, nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', delegadoId: 50, activo: true,
        creadoEn: new Date('2026-10-01T15:00:00Z'), actualizadoEn: new Date('2026-10-01T15:00:00Z'),
        delegado, _count: { inscripciones: 3 }, ...cambios,
    }
}

/** Fila de `inscripciones` con las relaciones de `detalleInclude` (lo que lee `aFilaLista`). */
function inscripcionMiembro(cambios: Record<string, unknown> = {}) {
    return {
        id: 120, eventoId: 2, participanteId: 50, delegacionId: 7,
        creadoEn: new Date('2026-10-01T15:00:00Z'), actualizadoEn: new Date('2026-10-01T15:00:00Z'),
        codigoCredencial: 'ABC1234567', esQrLegado: false,
        participante: { ...delegado, celular: '987654321' },
        tipoInscripcion: null, clasificacion: null,
        delegacion: { id: 7, nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', activo: true },
        estado: { id: 3, codigo: 'APROBADO', nombre: 'Aprobado' },
        evento,
        revisadoPor: null,
        monto: new Prisma.Decimal(150), descuento: new Prisma.Decimal(0), tieneDescuento: false,
        modalidadPago: 'efectivo', banco: null, tipoOperacion: null, billeteraDigital: null,
        numeroOperacion: 'OP-123', fechaPago: new Date('2026-10-01T00:00:00Z'), voucherArchivo: null,
        esCorreoInstitucional: true, esEstudianteUndc: false, codigoEstudiante: null,
        verificacionEstudiante: null, esCorreoVerificado: false, verificacionCorreo: null,
        motivoRechazo: null, revisadoEn: null, credencialEnviadaEn: null,
        ...cambios,
    }
}

let creada: ReturnType<typeof registro> | null = null
const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const crear = (cuerpo: Record<string, unknown>, cabeceras = admin(), eventoId = 2) =>
    request(app).post(`/api/v1/events/${eventoId}/delegations`).set(cabeceras).send(cuerpo)
const datosCreados = () => m.delegacion.create.mock.calls[0][0].data

beforeEach(() => {
    jest.clearAllMocks()
    creada = null
    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 2 ? evento : null))
    m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 50 ? { id: 50, correo: delegado.correo } : null))
    m.delegacion.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 7 ? creada ?? registro() : null))
    m.delegacion.findMany.mockResolvedValue([registro()])
    m.delegacion.create.mockImplementation(({ data }) => {
        creada = registro({
            nombre: data.nombre, tipo: data.tipo, abreviatura: data.abreviatura, delegadoId: data.delegadoId,
            delegado: data.delegadoId ? delegado : null, _count: { inscripciones: 0 },
        })
        return Promise.resolve(creada)
    })
    m.delegacion.update.mockImplementation(({ data }) => {
        creada = registro({ nombre: data.nombre ?? 'Salón 5to A', tipo: data.tipo ?? 'SALON', activo: data.activo ?? true })
        return Promise.resolve(creada)
    })
    m.inscripcion.count.mockResolvedValue(1)
    m.inscripcion.findMany.mockResolvedValue([inscripcionMiembro()])
})

describe('delegaciones', () => {
    it('se crea con nombre, tipo, abreviatura y delegado, activa y sin inscritos', async () => {
        const r = await crear({ nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', delegadoId: 50 })
        expect(r.status).toBe(201)
        expect(datosCreados()).toEqual({ eventoId: 2, nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', delegadoId: 50 })
        expect(r.body.data).toMatchObject({
            id: 7, eventoId: 2, nombre: 'Salón 5to A', tipo: 'SALON', abreviatura: '5A', activo: true,
            delegado: { id: 50, nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@undc.edu.pe' },
            totalInscripciones: 0,
        })
    })

    it('el tipo es OTRO por defecto y la abreviatura puede quedar vacía', async () => {
        const r = await crear({ nombre: 'Ciclo III' })
        expect(r.status).toBe(201)
        expect(datosCreados()).toMatchObject({ tipo: 'OTRO', abreviatura: null, delegadoId: null })
        expect(r.body.data.delegado).toBeNull()
    })

    it('un evento inexistente responde 404 EVENT_NOT_FOUND', async () => {
        const r = await crear({ nombre: 'Salón 5to A' }, admin(), 9)
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('EVENT_NOT_FOUND')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('un delegado inexistente responde 404 PARTICIPANT_NOT_FOUND', async () => {
        const r = await crear({ nombre: 'Salón 5to A', delegadoId: 99 })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('PARTICIPANT_NOT_FOUND')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('un nombre repetido en el evento responde 409 DELEGATION_EXISTS', async () => {
        m.delegacion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_delegaciones_evento_nombre' } }))
        const r = await crear({ nombre: 'Salón 5to A' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DELEGATION_EXISTS')
    })

    it('valida el cuerpo (422 VALIDATION_ERROR)', async () => {
        for (const cuerpo of [{ nombre: 'x' }, { nombre: 'Salón 5to A', tipo: 'GRADO' }, { nombre: '' }]) {
            const r = await crear(cuerpo)
            expect(r.status).toBe(422)
            expect(r.body.code).toBe('VALIDATION_ERROR')
        }
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('el listado del evento trae cada delegación con su delegado y su total de inscritos', async () => {
        const r = await request(app).get('/api/v1/events/2/delegations').set(admin())
        expect(r.status).toBe(200)
        expect(m.delegacion.findMany.mock.calls[0][0].where).toEqual({ eventoId: 2 })
        expect(r.body.data).toHaveLength(1)
        expect(r.body.data[0]).toMatchObject({ id: 7, totalInscripciones: 3, delegado: { id: 50 }, activo: true })
    })

    it('el detalle responde la delegación; si no existe, 404', async () => {
        const encontrada = await request(app).get('/api/v1/delegations/7').set(admin())
        expect(encontrada.status).toBe(200)
        expect(encontrada.body.data).toMatchObject({ id: 7, nombre: 'Salón 5to A' })
        const inexistente = await request(app).get('/api/v1/delegations/99').set(admin())
        expect(inexistente.status).toBe(404)
        expect(inexistente.body.code).toBe('DELEGATION_NOT_FOUND')
    })

    it('PATCH cambia solo los campos enviados', async () => {
        const r = await request(app).patch('/api/v1/delegations/7').set(admin()).send({ activo: false, nombre: 'Salón 6to A' })
        expect(r.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0]).toMatchObject({
            where: { id: 7 },
            data: { activo: false, nombre: 'Salón 6to A' },
        })
        expect(r.body.data).toMatchObject({ id: 7, nombre: 'Salón 6to A', activo: false })
    })

    it('PATCH sin campos no toca la BD y devuelve la delegación actual', async () => {
        const r = await request(app).patch('/api/v1/delegations/7').set(admin()).send({})
        expect(r.status).toBe(200)
        expect(m.delegacion.update).not.toHaveBeenCalled()
        expect(r.body.data).toMatchObject({ id: 7, nombre: 'Salón 5to A' })
    })

    it('PATCH responde 404 si no existe y 409 si el nombre ya se usa en el evento', async () => {
        const inexistente = await request(app).patch('/api/v1/delegations/99').set(admin()).send({ activo: false })
        expect(inexistente.status).toBe(404)
        expect(inexistente.body.code).toBe('DELEGATION_NOT_FOUND')
        m.delegacion.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_delegaciones_evento_nombre' } }))
        const repetida = await request(app).patch('/api/v1/delegations/7').set(admin()).send({ nombre: 'Ciclo III' })
        expect(repetida.status).toBe(409)
        expect(repetida.body.code).toBe('DELEGATION_EXISTS')
    })

    it('los miembros son las inscripciones de la delegación, paginados como el listado de inscritos', async () => {
        const r = await request(app).get('/api/v1/delegations/7/members?pageSize=10').set(admin())
        expect(r.status).toBe(200)
        expect(m.inscripcion.findMany.mock.calls[0][0]).toMatchObject({
            where: { delegacionId: 7, eventoId: 2 },
            skip: 0,
            take: 10,
        })
        expect(r.body.meta).toEqual({ page: 1, pageSize: 10, total: 1 })
        expect(r.body.data).toHaveLength(1)
        expect(r.body.data[0]).toMatchObject({
            id: 120,
            participante: { id: 50, numeroDocumento: '12345678', correo: 'ana@undc.edu.pe' },
            delegacion: { id: 7, nombre: 'Salón 5to A' },
            estado: { codigo: 'APROBADO' },
            monto: 150,
        })
    })

    it('delegación inexistente: los miembros responden 404', async () => {
        const r = await request(app).get('/api/v1/delegations/99/members').set(admin())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('DELEGATION_NOT_FOUND')
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('solo cuentas globales: Tesorero, Comisión y participante reciben 403 antes de validar', async () => {
        const tokens = [
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2] }),
            tokenDeParticipante(50),
        ]
        for (const token of tokens) {
            const r = await crear({ nombre: 'x' }, { Authorization: `Bearer ${token}` })
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        const sinSesion = await request(app).post('/api/v1/events/2/delegations').send({ nombre: 'Salón 5to A' })
        expect(sinSesion.status).toBe(401)
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })
})

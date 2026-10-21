import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), update: jest.fn() },
        categoriaInscripcion: { findUnique: jest.fn() },
        tipoInscripcion: { update: jest.fn(), create: jest.fn() },
        delegacion: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock, update: Mock }
    categoriaInscripcion: { findUnique: Mock }
    tipoInscripcion: { update: Mock, create: Mock }
    delegacion: { count: Mock, findMany: Mock, updateMany: Mock }
    $queryRaw: Mock
    $transaction: Mock
}

const FECHA = new Date('2026-10-18T12:00:00Z')
const administrador = () => `Bearer ${tokenDeRol('ADMIN')}`

const evento = {
    id: 2, codigo: 'ciisic-2026', nombre: 'VIII CIISIC',
    delegacionesMinIntegrantes: 10, delegacionesPrecioEstandar: new Prisma.Decimal(60), delegacionesPrecioPromocional: new Prisma.Decimal(50),
    creadoEn: FECHA, actualizadoEn: FECHA,
}

const tipoGeneral = { id: 31, categoriaId: 9, codigo: 'delegacion_general', modalidad: 'PRESENCIAL', activo: true, orden: 1, precio: new Prisma.Decimal(60) }
const tipoPromocional = { id: 32, categoriaId: 9, codigo: 'delegacion_grupal', modalidad: 'PRESENCIAL', activo: true, orden: 2, precio: new Prisma.Decimal(50) }
const tipoVirtual = { id: 33, categoriaId: 9, codigo: 'delegacion_virtual', modalidad: 'VIRTUAL', activo: true, orden: 3, precio: new Prisma.Decimal(30) }
const categoria = (tipos: unknown[] = [tipoGeneral, tipoPromocional, tipoVirtual]) => ({ id: 9, eventoId: 2, codigo: 'DELEGACIONES', tipos })

const URL = '/api/v1/events/2/delegations/tarifa'

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.evento.update.mockResolvedValue(evento)
    m.categoriaInscripcion.findUnique.mockResolvedValue(categoria())
    m.tipoInscripcion.update.mockResolvedValue({})
    m.tipoInscripcion.create.mockResolvedValue({})
    // `total` cuenta todas; las «sin integrantes» llevan el filtro de pagos
    m.delegacion.count.mockImplementation(async ({ where }: { where: { pagos?: unknown } }) => (where.pagos ? 1 : 2))
    m.delegacion.findMany.mockResolvedValue([])
    m.delegacion.updateMany.mockResolvedValue({ count: 0 })
    m.$queryRaw.mockResolvedValue([])
    m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m))
})

describe('GET /v1/events/:eventId/delegations/tarifa', () => {
    it('entrega los precios de los tipos, el mínimo, la virtual y cuántas delegaciones hay', async () => {
        const r = await request(app).get(URL).set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({
            minIntegrantes: 10,
            presencial: { precioEstandar: 60, precioPromocional: 50 },
            virtual: { precio: 30, activo: true },
            delegaciones: { total: 2, sinIntegrantes: 1 },
        })
    })

    it('sin el tipo virtual, virtual es null; con el tipo oculto, activo es false', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional]))
        expect((await request(app).get(URL).set('Authorization', administrador())).body.data.virtual).toBeNull()

        m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional, { ...tipoVirtual, activo: false }]))
        expect((await request(app).get(URL).set('Authorization', administrador())).body.data.virtual).toEqual({ precio: 30, activo: false })
    })

    it('sin los tipos presenciales usa los precios de respaldo del evento', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(null)
        m.evento.findUnique.mockResolvedValue({ ...evento, delegacionesMinIntegrantes: 6, delegacionesPrecioEstandar: new Prisma.Decimal(70), delegacionesPrecioPromocional: new Prisma.Decimal(55) })
        const r = await request(app).get(URL).set('Authorization', administrador())
        expect(r.body.data).toMatchObject({ minIntegrantes: 6, presencial: { precioEstandar: 70, precioPromocional: 55 }, virtual: null })
    })

    it('un evento inexistente responde 404', async () => {
        m.evento.findUnique.mockResolvedValue(null)
        const r = await request(app).get(URL).set('Authorization', administrador())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('EVENT_NOT_FOUND')
    })

    it('un Tesorero con alcance por evento no la consulta', async () => {
        const token = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        expect((await request(app).get(URL).set('Authorization', `Bearer ${token}`)).status).toBe(403)
    })

    it('sin sesión responde 401', async () => {
        expect((await request(app).get(URL)).status).toBe(401)
    })
})

describe('PUT /v1/events/:eventId/delegations/tarifa', () => {
    const put = (body: Record<string, unknown>) => request(app).put(URL).set('Authorization', administrador()).send(body)

    it('actualiza los tres tipos (precio e institucional iguales), el mínimo y el respaldo del evento', async () => {
        const r = await put({ minIntegrantes: 8, precioEstandar: 70, precioPromocional: 55, precioVirtual: 35 })
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({
            minIntegrantes: 8,
            presencial: { precioEstandar: 70, precioPromocional: 55 },
            virtual: { precio: 35, activo: true },
            delegaciones: { total: 2, sinIntegrantes: 1 },
            delegacionesActualizadas: 0,
        })
        expect(m.evento.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { delegacionesMinIntegrantes: 8, delegacionesPrecioEstandar: 70, delegacionesPrecioPromocional: 55 } })
        expect(m.tipoInscripcion.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { precio: 70, precioInstitucional: 70 } })
        expect(m.tipoInscripcion.update).toHaveBeenCalledWith({ where: { id: 32 }, data: { precio: 55, precioInstitucional: 55 } })
        expect(m.tipoInscripcion.update).toHaveBeenCalledWith({ where: { id: 33 }, data: { precio: 35, precioInstitucional: 35 } })
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
        // Guardar la tarifa no reprecia lo ya creado
        expect(m.delegacion.updateMany).not.toHaveBeenCalled()
        expect(m.$queryRaw).toHaveBeenCalledTimes(1)
    })

    it('lo que no llega se conserva: solo el mínimo no toca los tipos', async () => {
        const r = await put({ minIntegrantes: 12 })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ minIntegrantes: 12, presencial: { precioEstandar: 60, precioPromocional: 50 }, virtual: { precio: 30, activo: true } })
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
        expect(m.evento.update.mock.calls[0][0].data).toEqual({ delegacionesMinIntegrantes: 12, delegacionesPrecioEstandar: 60, delegacionesPrecioPromocional: 50 })
    })

    it('un estándar menor que el promocional vigente responde 409 y no escribe nada', async () => {
        const r = await put({ precioEstandar: 40 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INVALID_PRICES')
        expect(m.evento.update).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it.each([
        ['promocional mayor que estándar', { precioEstandar: 50, precioPromocional: 60 }],
        ['mínimo en cero', { minIntegrantes: 0 }],
        ['precio negativo', { precioVirtual: -1 }],
        ['sin ningún dato', {}],
    ])('rechaza %s con 422 antes de escribir', async (_nombre, body) => {
        const r = await put(body)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('crea el tipo virtual cuando el evento no lo tiene', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional]))
        const r = await put({ precioVirtual: 35 })
        expect(r.status).toBe(200)
        expect(r.body.data.virtual).toEqual({ precio: 35, activo: true })
        const datos = m.tipoInscripcion.create.mock.calls[0][0].data
        expect(datos).toMatchObject({
            categoriaId: 9, codigo: 'delegacion_virtual', modalidad: 'VIRTUAL', disponiblePara: 'TODOS', precio: 35, precioInstitucional: 35, activo: true, orden: 3,
        })
        expect(datos.descripcion).toContain('S/ 35.00')
    })

    it('encender la virtual sin tipo lo crea con el precio por defecto', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional]))
        const r = await put({ virtualActivo: true })
        expect(r.body.data.virtual).toEqual({ precio: 30, activo: true })
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ precio: 30, activo: true })
    })

    it('apagar la virtual sin tipo no crea nada', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional]))
        const r = await put({ virtualActivo: false })
        expect(r.status).toBe(200)
        expect(r.body.data.virtual).toBeNull()
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
    })

    it('apagar la virtual oculta el tipo sin tocar su precio', async () => {
        const r = await put({ virtualActivo: false })
        expect(r.body.data.virtual).toEqual({ precio: 30, activo: false })
        expect(m.tipoInscripcion.update).toHaveBeenCalledWith({ where: { id: 33 }, data: { activo: false } })
    })

    it('sin la categoría DELEGACIONES no puede crear el tipo virtual: 422', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(null)
        const r = await put({ precioVirtual: 35 })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_CATEGORY_NOT_FOUND')
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
    })

    describe('aplicarAExistentes', () => {
        it('reprecia solo las delegaciones sin integrantes ni vouchers, cada una con su modalidad', async () => {
            m.delegacion.findMany.mockResolvedValue([{ id: 1, modalidad: 'PRESENCIAL' }, { id: 4, modalidad: 'PRESENCIAL' }, { id: 2, modalidad: 'VIRTUAL' }])
            const r = await put({ precioEstandar: 70, precioPromocional: 55, precioVirtual: 35, minIntegrantes: 8, aplicarAExistentes: true })
            expect(r.status).toBe(200)
            expect(r.body.data.delegacionesActualizadas).toBe(3)
            // Bloquea las delegaciones del evento y solo busca las vacías (sin integrantes activos ni pagos)
            expect(m.$queryRaw).toHaveBeenCalledTimes(2)
            expect(m.delegacion.findMany.mock.calls[0][0].where).toMatchObject({ eventoId: 2, pagos: { none: {} } })
            expect(m.delegacion.updateMany).toHaveBeenCalledWith({ where: { id: { in: [1, 4] } }, data: { minIntegrantes: 8, precioEstandar: 70, precioPromocional: 55 } })
            expect(m.delegacion.updateMany).toHaveBeenCalledWith({ where: { id: { in: [2] } }, data: { minIntegrantes: 8, precioEstandar: 35, precioPromocional: 35 } })
        })

        it('sin tipo virtual no toca las delegaciones virtuales', async () => {
            m.categoriaInscripcion.findUnique.mockResolvedValue(categoria([tipoGeneral, tipoPromocional]))
            m.delegacion.findMany.mockResolvedValue([{ id: 2, modalidad: 'VIRTUAL' }])
            const r = await put({ precioEstandar: 70, aplicarAExistentes: true })
            expect(r.body.data.delegacionesActualizadas).toBe(0)
            expect(m.delegacion.updateMany).not.toHaveBeenCalled()
        })

        it('apagado (por defecto) no busca ni modifica delegaciones', async () => {
            await put({ precioEstandar: 70 })
            expect(m.delegacion.findMany).not.toHaveBeenCalled()
            expect(m.delegacion.updateMany).not.toHaveBeenCalled()
        })
    })

    it('un Tesorero con alcance por evento no la cambia', async () => {
        const token = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).put(URL).set('Authorization', `Bearer ${token}`).send({ precioEstandar: 70 })
        expect(r.status).toBe(403)
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('un evento inexistente responde 404 sin abrir la transacción', async () => {
        m.evento.findUnique.mockResolvedValue(null)
        const r = await put({ precioEstandar: 70 })
        expect(r.status).toBe(404)
        expect(m.$transaction).not.toHaveBeenCalled()
    })
})

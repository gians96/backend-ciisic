import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const cliente = {
        evento: { findUnique: jest.fn() },
        padronEstudiante: { groupBy: jest.fn() },
        asesor: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
        asesorSeccion: { deleteMany: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn(),
    }
    cliente.$transaction.mockImplementation(async (trabajo: (tx: typeof cliente) => Promise<unknown>) => trabajo(cliente))
    return { prisma: cliente }
})

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    padronEstudiante: { groupBy: jest.Mock }
    asesor: { findMany: jest.Mock, findFirst: jest.Mock, create: jest.Mock, update: jest.Mock, deleteMany: jest.Mock }
    asesorSeccion: { deleteMany: jest.Mock, createMany: jest.Mock }
}

const admin = () => tokenDeRol('ADMIN', 2)
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['reportes.ver', 'reportes.exportar'] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

const duplicado = (indice: string) => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: indice } })

const ANGOMA = { id: 7, eventoId: 2, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '12345678', secciones: [{ asesorId: 7, eventoId: 2, ciclo: 'II', seccion: 'A' }, { asesorId: 7, eventoId: 2, ciclo: 'I', seccion: 'A' }] }
const CARDENAS = { id: 8, eventoId: 2, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', documento: null, secciones: [{ asesorId: 8, eventoId: 2, ciclo: 'II', seccion: 'B' }] }

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? { id: 2, codigo: 'ciisic-viii', nombre: 'CIISIC VIII', estado: 'PUBLICADO' } : null))
    m.padronEstudiante.groupBy.mockResolvedValue([
        { ciclo: 'II', seccion: 'B', _count: { _all: 30 } }, { ciclo: 'I', seccion: 'A', _count: { _all: 39 } }, { ciclo: 'II', seccion: 'A', _count: { _all: 37 } },
    ])
    m.asesor.findMany.mockResolvedValue([CARDENAS, ANGOMA])
    m.asesor.findFirst.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 7 ? ANGOMA : where.id === 8 ? CARDENAS : null))
    m.asesor.create.mockImplementation(({ data }: { data: { nombre: string, documento: string | null } }) => Promise.resolve({ id: 20, eventoId: 2, nombre: data.nombre, documento: data.documento, secciones: [] }))
    m.asesor.deleteMany.mockResolvedValue({ count: 1 })
    m.asesorSeccion.deleteMany.mockResolvedValue({ count: 2 })
    m.asesorSeccion.createMany.mockResolvedValue({ count: 2 })
})

describe('docentes: lista', () => {
    it('trae a cada docente con su DNI y sus secciones en orden, y las secciones del padrón', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/advisors').set(con(admin()))
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data.asesores).toEqual([
            { id: 8, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', documento: null, secciones: [{ ciclo: 'II', seccion: 'B' }] },
            { id: 7, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '12345678', secciones: [{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'A' }] },
        ])
        expect(r.body.data.secciones).toEqual([{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }])
    })

    it('el DNI de los docentes es solo de quien gestiona el padrón (no del Tesorero ni de la Comisión)', async () => {
        expect((await request(app).get('/api/v1/events/2/advisory/advisors')).status).toBe(401)
        for (const token of [tesorero(), comision()]) {
            expect((await request(app).get('/api/v1/events/2/advisory/advisors').set(con(token))).status).toBe(403)
            expect((await request(app).post('/api/v1/events/2/advisory/advisors').set(con(token)).send({ nombre: 'DR. NUEVO' })).status).toBe(403)
            expect((await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(token)).send({ nombre: 'DR. NUEVO' })).status).toBe(403)
            expect((await request(app).delete('/api/v1/events/2/advisory/advisors/7').set(con(token))).status).toBe(403)
        }
        expect(m.asesor.create).not.toHaveBeenCalled()
        expect(m.asesor.deleteMany).not.toHaveBeenCalled()
    })
})

describe('docentes: agregar', () => {
    it('crea un docente con su DNI (completa el cero que pierde Excel) y sus secciones sin repetir', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin()))
            .send({ nombre: '  DR.  JUAN   PÉREZ ', documento: '2442123', secciones: [{ ciclo: 'i', seccion: 'a' }, { ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'b' }] })
        expect(r.status).toBe(201)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(m.asesor.create).toHaveBeenCalledTimes(1)
        expect(m.asesor.create.mock.calls[0][0].data).toEqual({
            eventoId: 2, nombre: 'DR. JUAN PÉREZ', documento: '02442123',
            secciones: { create: [{ eventoId: 2, ciclo: 'I', seccion: 'A' }, { eventoId: 2, ciclo: 'II', seccion: 'B' }] },
        })
        expect(r.body.data).toMatchObject({ id: 20, nombre: 'DR. JUAN PÉREZ', documento: '02442123', secciones: [{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }] })
    })

    it('el DNI es opcional', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin())).send({ nombre: 'DR. SIN DNI', documento: '', secciones: [] })
        expect(r.status).toBe(201)
        expect(m.asesor.create.mock.calls[0][0].data.documento).toBeNull()
    })

    it('rechaza un DNI que no tiene 8 dígitos, un nombre corto y secciones mal formadas', async () => {
        for (const cuerpo of [
            { nombre: 'DR. X', documento: '123' },
            { nombre: 'DR. X', documento: '123456789' },
            { nombre: 'DR. X', documento: '1234567a' },
            { nombre: 'ab' },
            {},
            { nombre: 'DR. X', secciones: [{ ciclo: '', seccion: 'A' }] },
            { nombre: 'DR. X', secciones: 'I-A' },
        ]) {
            const r = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin())).send(cuerpo)
            expect({ cuerpo, status: r.status }).toEqual({ cuerpo, status: 422 })
        }
        expect(m.asesor.create).not.toHaveBeenCalled()
    })

    it('rechaza una sección que no está en el padrón', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin())).send({ nombre: 'DR. NUEVO', secciones: [{ ciclo: 'IX', seccion: 'Z' }] })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('SECTION_NOT_FOUND')
        expect(m.asesor.create).not.toHaveBeenCalled()
    })

    it('un nombre o un DNI repetidos en el evento responden 409 con su propio código', async () => {
        m.asesor.create.mockRejectedValueOnce(duplicado('uq_asesores_evento_nombre'))
        const nombre = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin())).send({ nombre: 'DR. REPETIDO' })
        expect({ status: nombre.status, code: nombre.body.code }).toEqual({ status: 409, code: 'ADVISOR_NAME_TAKEN' })
        m.asesor.create.mockRejectedValueOnce(duplicado('uq_asesores_evento_documento'))
        const dni = await request(app).post('/api/v1/events/2/advisory/advisors').set(con(admin())).send({ nombre: 'DR. OTRO', documento: '12345678' })
        expect({ status: dni.status, code: dni.body.code }).toEqual({ status: 409, code: 'ADVISOR_DOCUMENT_TAKEN' })
    })
})

describe('docentes: editar', () => {
    it('cambia el DNI y reemplaza las secciones (quita unas y agrega otras) sin tocar su enlace', async () => {
        const r = await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(admin()))
            .send({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '87654321', secciones: [{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }] })
        expect(r.status).toBe(200)
        expect(m.asesor.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '87654321' } })
        // Solo nombre y DNI: el token del enlace y el último acceso no están en lo que se escribe
        expect(Object.keys(m.asesor.update.mock.calls[0][0].data).sort()).toEqual(['documento', 'nombre'])
        expect(m.asesorSeccion.deleteMany).toHaveBeenCalledWith({ where: { asesorId: 7 } })
        expect(m.asesorSeccion.createMany).toHaveBeenCalledWith({ data: [{ asesorId: 7, eventoId: 2, ciclo: 'I', seccion: 'A' }, { asesorId: 7, eventoId: 2, ciclo: 'II', seccion: 'B' }] })
        expect(r.body.data).toEqual({ id: 7, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '87654321', secciones: [{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }] })
    })

    it('quitarle todas las secciones y el DNI es válido', async () => {
        const r = await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(admin())).send({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: null, secciones: [] })
        expect(r.status).toBe(200)
        expect(m.asesor.update.mock.calls[0][0].data.documento).toBeNull()
        expect(m.asesorSeccion.deleteMany).toHaveBeenCalledWith({ where: { asesorId: 7 } })
        expect(m.asesorSeccion.createMany).not.toHaveBeenCalled()
    })

    it('conserva una sección que el padrón nuevo ya no trae si ya era suya, pero no deja agregar otra que no existe', async () => {
        m.padronEstudiante.groupBy.mockResolvedValue([{ ciclo: 'I', seccion: 'A', _count: { _all: 10 } }])
        const suya = await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(admin())).send({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ ciclo: 'II', seccion: 'A' }] })
        expect(suya.status).toBe(200)
        const ajena = await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(admin())).send({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ ciclo: 'II', seccion: 'B' }] })
        expect(ajena.body.code).toBe('SECTION_NOT_FOUND')
    })

    it('un docente que no es del evento es 404 y un DNI o nombre repetidos son 409', async () => {
        const ajeno = await request(app).put('/api/v1/events/2/advisory/advisors/99').set(con(admin())).send({ nombre: 'DR. NUEVO' })
        expect({ status: ajeno.status, code: ajeno.body.code }).toEqual({ status: 404, code: 'ADVISOR_NOT_FOUND' })
        m.asesor.update.mockRejectedValueOnce(duplicado('uq_asesores_evento_documento'))
        const dni = await request(app).put('/api/v1/events/2/advisory/advisors/7').set(con(admin())).send({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: '11111111' })
        expect({ status: dni.status, code: dni.body.code }).toEqual({ status: 409, code: 'ADVISOR_DOCUMENT_TAKEN' })
    })
})

describe('docentes: eliminar', () => {
    it('elimina al docente del evento y es 404 si no existe', async () => {
        const r = await request(app).delete('/api/v1/events/2/advisory/advisors/7').set(con(admin()))
        expect(r.status).toBe(200)
        expect(m.asesor.deleteMany).toHaveBeenCalledWith({ where: { id: 7, eventoId: 2 } })
        m.asesor.deleteMany.mockResolvedValueOnce({ count: 0 })
        const ajeno = await request(app).delete('/api/v1/events/2/advisory/advisors/99').set(con(admin()))
        expect({ status: ajeno.status, code: ajeno.body.code }).toEqual({ status: 404, code: 'ADVISOR_NOT_FOUND' })
        expect((await request(app).delete('/api/v1/events/2/advisory/advisors/abc').set(con(admin()))).status).toBe(400)
    })
})

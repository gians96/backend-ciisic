import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        categoriaInscripcion: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        tipoInscripcion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
        inscripcion: { groupBy: jest.fn(), count: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    categoriaInscripcion: { findMany: jest.Mock, create: jest.Mock, update: jest.Mock, delete: jest.Mock }
    tipoInscripcion: { create: jest.Mock, update: jest.Mock, delete: jest.Mock }
    inscripcion: { groupBy: jest.Mock }
}

const categoria = {
    id: 3, eventoId: 2, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', descripcion: null, caracteristicas: null,
    precioDesde: new Prisma.Decimal(120), esEstudiantil: false, orden: 1,
    tipos: [{
        id: 7, categoriaId: 3, codigo: 'GENERAL', nombre: 'General', etiqueta: null, descripcion: null, caracteristicas: null,
        precio: new Prisma.Decimal(140), precioInstitucional: new Prisma.Decimal(120), activo: true, orden: 0,
    }],
}

const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = (permisos: string[]) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}` }))
    m.categoriaInscripcion.findMany.mockResolvedValue([categoria])
    m.inscripcion.groupBy.mockResolvedValue([{ tipoInscripcionId: 7, _count: { _all: 4 } }])
})

describe('categorías y tipos del evento (lista)', () => {
    it('el Tesorero ve los precios', async () => {
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ codigo: 'PUBLICO_GENERAL', precioDesde: 120 })
        expect(r.body.data[0].tipos[0]).toMatchObject({ id: 7, precio: 140, precioInstitucional: 120, totalInscripciones: 4 })
    })

    it('la Comisión con «inscripciones.ver» recibe los tipos con los precios en null (mismas claves)', async () => {
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(con(comision(['inscripciones.ver'])))
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ codigo: 'PUBLICO_GENERAL', precioDesde: null })
        const [tipo] = r.body.data[0].tipos
        expect(tipo).toMatchObject({ id: 7, nombre: 'General', precio: null, precioInstitucional: null, totalInscripciones: 4 })
        expect(Object.keys(tipo)).toEqual(expect.arrayContaining(['precio', 'precioInstitucional']))
    })

    it('sin «inscripciones.ver» ni «eventos.configurar» responde 403', async () => {
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(con(comision(['asistencia.marcar'])))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })

    it('las categorías de otro evento responden 403 EVENT_NOT_ASSIGNED', async () => {
        const r = await request(app).get('/api/v1/events/3/registration-categories').set(con(tesorero()))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect(m.categoriaInscripcion.findMany).not.toHaveBeenCalled()
    })

    it('el Administrador del sistema recibe todo', async () => {
        const r = await request(app).get('/api/v1/events/3/registration-categories').set(con(tokenDeRol('ADMIN')))
        expect(r.status).toBe(200)
        expect(r.body.data[0].tipos[0]).toMatchObject({ precio: 140 })
    })
})

describe('escritura de categorías y tipos', () => {
    it.each([
        ['post', '/api/v1/events/2/registration-categories'],
        ['put', '/api/v1/registration-categories/3'],
        ['delete', '/api/v1/registration-categories/3'],
        ['post', '/api/v1/registration-categories/3/types'],
        ['put', '/api/v1/registration-types/7'],
        ['delete', '/api/v1/registration-types/7'],
    ])('%s %s responde 403 al Tesorero (antes de validar el cuerpo)', async (method, ruta) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(con(tesorero())).send({})
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.categoriaInscripcion.create).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it('el Administrador del sistema pasa la guarda', async () => {
        const r = await request(app).post('/api/v1/events/2/registration-categories').set(con(tokenDeRol('ADMIN'))).send({})
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })
})

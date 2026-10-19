import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        categoriaInscripcion: { findMany: jest.fn(), findUnique: jest.fn() },
        tipoInscripcion: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { groupBy: jest.fn(), count: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
    categoriaInscripcion: { findMany: jest.Mock, findUnique: jest.Mock }
    tipoInscripcion: { findMany: jest.Mock, findFirst: jest.Mock, findUnique: jest.Mock, create: jest.Mock, update: jest.Mock }
    inscripcion: { groupBy: jest.Mock, count: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock, update: jest.Mock }
    configuracionSistema: { findUnique: jest.Mock }
}

const tipoVirtual = {
    id: 14, categoriaId: 3, codigo: 'general_virtual', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', etiqueta: 'VIRTUAL', descripcion: null,
    caracteristicas: null, precio: new Prisma.Decimal(50), precioInstitucional: new Prisma.Decimal(50), disponiblePara: 'TODOS', modalidad: 'VIRTUAL',
    activo: true, orden: 3,
}
const tipoPresencial = { ...tipoVirtual, id: 8, codigo: 'general_sin_kit', etiqueta: 'SIN KIT', precio: new Prisma.Decimal(80), precioInstitucional: new Prisma.Decimal(60), modalidad: 'PRESENCIAL', orden: 2 }
const categoria = {
    id: 3, eventoId: 2, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', descripcion: null, caracteristicas: null,
    precioDesde: null, esEstudiantil: false, orden: 1, tipos: [tipoPresencial, tipoVirtual],
}

const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const cuerpoTipo = { codigo: 'general_virtual', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', precio: 50, precioInstitucional: 50 }

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}` }))
    m.categoriaInscripcion.findMany.mockResolvedValue([categoria])
    m.categoriaInscripcion.findUnique.mockResolvedValue(categoria)
    m.tipoInscripcion.findUnique.mockResolvedValue(null)
    m.tipoInscripcion.create.mockImplementation(({ data }) => Promise.resolve({ id: 14, descripcion: null, ...data, caracteristicas: null }))
    m.tipoInscripcion.update.mockImplementation(({ data }) => Promise.resolve({ ...tipoPresencial, ...data }))
    m.inscripcion.groupBy.mockResolvedValue([])
    m.inscripcion.count.mockResolvedValue(0)
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('modalidad de asistencia de los tipos en el panel (spec 018)', () => {
    it('crea un tipo virtual con el mismo precio regular e institucional', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send({ ...cuerpoTipo, etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL' })
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', precio: 50, precioInstitucional: 50, disponiblePara: 'TODOS' })
        expect(r.body.data).toMatchObject({ codigo: 'general_virtual', modalidad: 'VIRTUAL', precio: 50, precioInstitucional: 50 })
    })

    it('sin enviarla el tipo nace PRESENCIAL', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send(cuerpoTipo)
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'PRESENCIAL' })
        expect(r.body.data.modalidad).toBe('PRESENCIAL')
    })

    it.each([
        ['post', '/api/v1/registration-categories/3/types', { ...cuerpoTipo, modalidad: 'HIBRIDA' }],
        ['post', '/api/v1/registration-categories/3/types', { ...cuerpoTipo, modalidad: 'virtual' }],
        ['post', '/api/v1/registration-categories/3/types', { ...cuerpoTipo, modalidad: null }],
        ['put', '/api/v1/registration-types/8', { modalidad: 'banco' }],
        ['put', '/api/v1/registration-types/8', { modalidad: null }],
    ])('%s %s rechaza %j (422 VALIDATION_ERROR con fields.modalidad)', async (method, ruta, cuerpo) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(admin()).send(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { modalidad: expect.any(String) } })
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it('actualizar solo la modalidad no toca los precios ni la disponibilidad', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(tipoPresencial)
        const r = await request(app).put('/api/v1/registration-types/8').set(admin()).send({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toEqual({ modalidad: 'VIRTUAL' })
        expect(r.body.data).toMatchObject({ modalidad: 'VIRTUAL', precio: 80 })
    })

    it('actualizar otros campos sin enviarla conserva la modalidad', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(tipoVirtual)
        const r = await request(app).put('/api/v1/registration-types/14').set(admin()).send({ nombre: 'PROFESIONALES VIRTUAL' })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toEqual({ nombre: 'PROFESIONALES VIRTUAL' })
    })

    it('el listado la incluye, también sin permiso de pagos (no es un precio)', async () => {
        const conPagos = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(conPagos.body.data[0].tipos.map((t: { modalidad: string }) => t.modalidad)).toEqual(['PRESENCIAL', 'VIRTUAL'])
        expect(conPagos.body.data[0].tipos[1]).toMatchObject({ modalidad: 'VIRTUAL', precio: 50, precioInstitucional: 50 })
        const comision = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })
        const sinPagos = await request(app).get('/api/v1/events/2/registration-categories').set({ Authorization: `Bearer ${comision}` })
        expect(sinPagos.body.data[0].tipos[1]).toMatchObject({ modalidad: 'VIRTUAL', precio: null, precioInstitucional: null })
    })

    it('una fila sin la columna (esquema anterior) se lee PRESENCIAL', async () => {
        const { modalidad: _omitida, ...sinColumna } = tipoPresencial
        void _omitida
        m.categoriaInscripcion.findMany.mockResolvedValue([{ ...categoria, tipos: [sinColumna] }])
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(r.body.data[0].tipos[0].modalidad).toBe('PRESENCIAL')
    })
})

describe('modalidad de asistencia en la API del sitio (spec 018)', () => {
    beforeEach(() => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }))
    })

    it('GET /site/registration-types la expone en cada tipo para que la landing separe presencial de virtual', async () => {
        const r = await request(app).get('/api/v1/site/registration-types?categoria=PUBLICO_GENERAL').set({ 'X-Api-Key': TOKEN_SITIO })
        expect(r.status).toBe(200)
        const [presencial, virtual] = r.body.data[0].tipos
        expect(presencial).toEqual(expect.objectContaining({ codigo: 'general_sin_kit', modalidad: 'PRESENCIAL' }))
        expect(virtual).toEqual(expect.objectContaining({ codigo: 'general_virtual', precio: 50, precioInstitucional: 50, disponiblePara: 'TODOS', modalidad: 'VIRTUAL' }))
        // Va dentro del tipo; la categoría no la lleva
        expect(r.body.data[0]).not.toHaveProperty('modalidad')
    })

    it('la forma LEGACY congelada (landing anterior) no lleva modalidad', async () => {
        m.evento.findFirst.mockResolvedValue({ id: 2, codigo: 'ciisic-viii-2026', esPrincipal: true, estado: 'PUBLICADO' })
        m.tipoInscripcion.findMany.mockResolvedValue([tipoVirtual])
        m.configuracionSistema.findUnique.mockResolvedValue(null)
        const r = await request(app).get('/api/v1/registration-types')
        expect(r.status).toBe(200)
        const fila = (Array.isArray(r.body) ? r.body : r.body.data)[0]
        expect(fila).toMatchObject({ id: 14, value: 'general_virtual', badge: 'VIRTUAL', precio: 50, institutionalPrice: 50 })
        expect(fila).not.toHaveProperty('modalidad')
    })
})

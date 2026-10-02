import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        categoriaInscripcion: { findMany: jest.fn(), findUnique: jest.fn() },
        tipoInscripcion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { groupBy: jest.fn(), count: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    categoriaInscripcion: { findMany: jest.Mock, findUnique: jest.Mock }
    tipoInscripcion: { findUnique: jest.Mock, create: jest.Mock, update: jest.Mock }
    inscripcion: { groupBy: jest.Mock, count: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock, update: jest.Mock }
}

const tipoSinKit = {
    id: 8, categoriaId: 3, codigo: 'general_sin_kit', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', etiqueta: 'SIN KIT', descripcion: null,
    caracteristicas: null, precio: new Prisma.Decimal(80), precioInstitucional: new Prisma.Decimal(80), disponiblePara: 'EXTERNOS', activo: true, orden: 2,
}
const categoria = {
    id: 3, eventoId: 2, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', descripcion: null, caracteristicas: null,
    precioDesde: null, esEstudiantil: false, orden: 1, tipos: [tipoSinKit],
}

const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const cuerpoTipo = { codigo: 'general_sin_kit', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', precio: 80, precioInstitucional: 80 }

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}` }))
    m.categoriaInscripcion.findMany.mockResolvedValue([categoria])
    m.categoriaInscripcion.findUnique.mockResolvedValue(categoria)
    m.tipoInscripcion.findUnique.mockResolvedValue(null)
    m.tipoInscripcion.create.mockImplementation(({ data }) => Promise.resolve({ id: 9, descripcion: null, ...data, caracteristicas: null }))
    m.tipoInscripcion.update.mockImplementation(({ data }) => Promise.resolve({ ...tipoSinKit, ...data }))
    m.inscripcion.groupBy.mockResolvedValue([])
    m.inscripcion.count.mockResolvedValue(0)
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('disponibilidad de los tipos en el panel (spec 016)', () => {
    it('crea un tipo solo para externos', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send({ ...cuerpoTipo, disponiblePara: 'EXTERNOS' })
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ disponiblePara: 'EXTERNOS' })
        expect(r.body.data).toMatchObject({ codigo: 'general_sin_kit', disponiblePara: 'EXTERNOS' })
    })

    it('sin enviarlo el tipo nace para todos', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send(cuerpoTipo)
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ disponiblePara: 'TODOS' })
    })

    it.each([
        ['post', '/api/v1/registration-categories/3/types', { ...cuerpoTipo, disponiblePara: 'SOLO_UNDC' }],
        ['put', '/api/v1/registration-types/8', { disponiblePara: null }],
    ])('%s %s rechaza un valor desconocido (422 VALIDATION_ERROR)', async (method, ruta, cuerpo) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(admin()).send(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { disponiblePara: expect.any(String) } })
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it('actualizar solo la disponibilidad no toca los precios', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(tipoSinKit)
        const r = await request(app).put('/api/v1/registration-types/8').set(admin()).send({ disponiblePara: 'INSTITUCIONAL' })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toEqual({ disponiblePara: 'INSTITUCIONAL' })
        expect(r.body.data).toMatchObject({ disponiblePara: 'INSTITUCIONAL', precio: 80 })
    })

    it('el listado del panel la incluye, también sin permiso de pagos (no es un precio)', async () => {
        const conPagos = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(conPagos.body.data[0].tipos[0]).toMatchObject({ disponiblePara: 'EXTERNOS', precioInstitucional: 80 })
        const comision = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })
        const sinPagos = await request(app).get('/api/v1/events/2/registration-categories').set({ Authorization: `Bearer ${comision}` })
        expect(sinPagos.body.data[0].tipos[0]).toMatchObject({ disponiblePara: 'EXTERNOS', precioInstitucional: null })
    })
})

describe('disponibilidad de los tipos en la API del sitio (spec 016)', () => {
    it('GET /site/registration-types la expone para que la landing oculte el tipo', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }))
        const r = await request(app).get('/api/v1/site/registration-types?categoria=PUBLICO_GENERAL').set({ 'X-Api-Key': TOKEN_SITIO })
        expect(r.status).toBe(200)
        expect(r.body.data[0].tipos[0]).toEqual(expect.objectContaining({ codigo: 'general_sin_kit', precio: 80, disponiblePara: 'EXTERNOS' }))
    })
})

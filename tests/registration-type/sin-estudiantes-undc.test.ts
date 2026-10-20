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
    excluyeEstudiantesUndc: true, activo: true, orden: 3,
}
const tipoPresencial = {
    ...tipoVirtual, id: 8, codigo: 'general_sin_kit', etiqueta: 'SIN KIT', precio: new Prisma.Decimal(80), precioInstitucional: new Prisma.Decimal(60),
    modalidad: 'PRESENCIAL', excluyeEstudiantesUndc: false, orden: 2,
}
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

describe('tipos que no admiten estudiantes UNDC en el panel (spec 020)', () => {
    it('crea un tipo virtual que excluye a los estudiantes UNDC', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin())
            .send({ ...cuerpoTipo, etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', excluyeEstudiantesUndc: true })
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', excluyeEstudiantesUndc: true, disponiblePara: 'TODOS' })
        expect(r.body.data).toMatchObject({ codigo: 'general_virtual', excluyeEstudiantesUndc: true })
    })

    it('sin enviarlo el tipo nace admitiendo estudiantes UNDC (comportamiento anterior)', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send(cuerpoTipo)
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ excluyeEstudiantesUndc: false })
        expect(r.body.data.excluyeEstudiantesUndc).toBe(false)
    })

    it.each([
        ['post', '/api/v1/registration-categories/3/types', { ...cuerpoTipo, excluyeEstudiantesUndc: 'quizás' }],
        ['put', '/api/v1/registration-types/8', { excluyeEstudiantesUndc: 'EXTERNOS' }],
        ['put', '/api/v1/registration-types/8', { excluyeEstudiantesUndc: null }],
    ])('%s %s rechaza %j (422 VALIDATION_ERROR con fields.excluyeEstudiantesUndc)', async (method, ruta, cuerpo) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(admin()).send(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { excluyeEstudiantesUndc: expect.any(String) } })
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it('actualizar solo el interruptor no toca precios, modalidad ni disponibilidad', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(tipoPresencial)
        const r = await request(app).put('/api/v1/registration-types/8').set(admin()).send({ excluyeEstudiantesUndc: true })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toEqual({ excluyeEstudiantesUndc: true })
        expect(r.body.data).toMatchObject({ excluyeEstudiantesUndc: true, precio: 80 })
    })

    it('actualizar otros campos sin enviarlo lo conserva', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(tipoVirtual)
        const r = await request(app).put('/api/v1/registration-types/14').set(admin()).send({ nombre: 'PROFESIONALES VIRTUAL' })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toEqual({ nombre: 'PROFESIONALES VIRTUAL' })
    })

    it('el listado lo incluye, también sin permiso de pagos (no es un precio)', async () => {
        const conPagos = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(conPagos.body.data[0].tipos.map((t: { excluyeEstudiantesUndc: boolean }) => t.excluyeEstudiantesUndc)).toEqual([false, true])
        const comision = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })
        const sinPagos = await request(app).get('/api/v1/events/2/registration-categories').set({ Authorization: `Bearer ${comision}` })
        expect(sinPagos.body.data[0].tipos[1]).toMatchObject({ excluyeEstudiantesUndc: true, precio: null, precioInstitucional: null })
    })

    it('una fila sin la columna (esquema anterior) se lee como «admite estudiantes»', async () => {
        const { excluyeEstudiantesUndc: _omitida, ...sinColumna } = tipoVirtual
        void _omitida
        m.categoriaInscripcion.findMany.mockResolvedValue([{ ...categoria, tipos: [sinColumna] }])
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(r.body.data[0].tipos[0].excluyeEstudiantesUndc).toBe(false)
    })
})

describe('tipos que no admiten estudiantes UNDC en la API del sitio (spec 020)', () => {
    beforeEach(() => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }))
    })

    it('GET /site/registration-types lo expone en cada tipo para que la landing lo oculte', async () => {
        const r = await request(app).get('/api/v1/site/registration-types?categoria=PUBLICO_GENERAL').set({ 'X-Api-Key': TOKEN_SITIO })
        expect(r.status).toBe(200)
        const [presencial, virtual] = r.body.data[0].tipos
        expect(presencial).toEqual(expect.objectContaining({ codigo: 'general_sin_kit', excluyeEstudiantesUndc: false }))
        expect(virtual).toEqual(expect.objectContaining({ codigo: 'general_virtual', disponiblePara: 'TODOS', modalidad: 'VIRTUAL', excluyeEstudiantesUndc: true }))
        // Va dentro del tipo; la categoría no lo lleva
        expect(r.body.data[0]).not.toHaveProperty('excluyeEstudiantesUndc')
    })

    it('la forma LEGACY congelada (landing anterior) no lo lleva', async () => {
        m.evento.findFirst.mockResolvedValue({ id: 2, codigo: 'ciisic-viii-2026', esPrincipal: true, estado: 'PUBLICADO' })
        m.tipoInscripcion.findMany.mockResolvedValue([tipoVirtual])
        m.configuracionSistema.findUnique.mockResolvedValue(null)
        const r = await request(app).get('/api/v1/registration-types')
        expect(r.status).toBe(200)
        const fila = (Array.isArray(r.body) ? r.body : r.body.data)[0]
        expect(fila).toMatchObject({ id: 14, value: 'general_virtual', badge: 'VIRTUAL' })
        expect(fila).not.toHaveProperty('excluyeEstudiantesUndc')
    })
})

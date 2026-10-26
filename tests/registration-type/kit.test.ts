import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        categoriaInscripcion: { findMany: jest.fn(), findUnique: jest.fn() },
        tipoInscripcion: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { groupBy: jest.fn(), count: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
    categoriaInscripcion: { findMany: jest.Mock, findUnique: jest.Mock }
    tipoInscripcion: { findMany: jest.Mock, findFirst: jest.Mock, findUnique: jest.Mock, create: jest.Mock, update: jest.Mock }
    inscripcion: { groupBy: jest.Mock, count: jest.Mock }
    configuracionSistema: { findUnique: jest.Mock }
}

const conKit = {
    id: 3, categoriaId: 3, codigo: 'estudiantes_con_kit', nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', descripcion: null,
    caracteristicas: null, precio: new Prisma.Decimal(120), precioInstitucional: new Prisma.Decimal(100), disponiblePara: 'TODOS', modalidad: 'PRESENCIAL',
    excluyeEstudiantesUndc: false, incluyeKit: true, activo: true, orden: 1,
}
const sinKit = { ...conKit, id: 4, codigo: 'estudiantes_sin_kit', etiqueta: 'SIN KIT', incluyeKit: false, orden: 2 }
const categoria = { id: 3, eventoId: 2, codigo: 'ESTUDIANTES', nombre: 'Estudiantes', descripcion: null, caracteristicas: null, precioDesde: null, esEstudiantil: true, orden: 1, delegacionId: null, tipos: [conKit, sinKit] }

const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const cuerpoTipo = { codigo: 'estudiantes_con_kit', nombre: 'ESTUDIANTES', precio: 120, precioInstitucional: 100 }
const datosDeUpdate = () => m.tipoInscripcion.update.mock.calls[0][0].data

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}` }))
    m.categoriaInscripcion.findMany.mockResolvedValue([categoria])
    m.categoriaInscripcion.findUnique.mockResolvedValue(categoria)
    m.tipoInscripcion.findUnique.mockResolvedValue(null)
    m.tipoInscripcion.create.mockImplementation(({ data }) => Promise.resolve({ id: 14, descripcion: null, excluyeEstudiantesUndc: false, ...data, caracteristicas: null }))
    m.tipoInscripcion.update.mockImplementation(({ data }) => Promise.resolve({ ...sinKit, ...data }))
    m.inscripcion.groupBy.mockResolvedValue([])
    m.inscripcion.count.mockResolvedValue(0)
})

describe('«Incluye kit» en los tipos de inscripción (spec 037)', () => {
    it('crea un tipo con kit', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send({ ...cuerpoTipo, etiqueta: 'CON KIT', incluyeKit: true })
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'PRESENCIAL', incluyeKit: true })
        expect(r.body.data).toMatchObject({ codigo: 'estudiantes_con_kit', incluyeKit: true })
    })

    it('sin enviarlo el tipo nace sin kit', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send(cuerpoTipo)
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ incluyeKit: false })
        expect(r.body.data.incluyeKit).toBe(false)
    })

    it('un tipo virtual se guarda sin kit aunque se pida con kit', async () => {
        const r = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send({ ...cuerpoTipo, modalidad: 'VIRTUAL', incluyeKit: true })
        expect(r.status).toBe(201)
        expect(m.tipoInscripcion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', incluyeKit: false })
        expect(r.body.data.incluyeKit).toBe(false)
    })

    it('rechaza un valor que no es booleano (422 con fields.incluyeKit)', async () => {
        const crear = await request(app).post('/api/v1/registration-categories/3/types').set(admin()).send({ ...cuerpoTipo, incluyeKit: 'quizás' })
        const editar = await request(app).put('/api/v1/registration-types/4').set(admin()).send({ incluyeKit: {} })
        for (const r of [crear, editar]) {
            expect(r.status).toBe(422)
            expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { incluyeKit: expect.any(String) } })
        }
        expect(m.tipoInscripcion.create).not.toHaveBeenCalled()
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
    })

    it('actualizar solo el kit no toca nada más', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(sinKit)
        const r = await request(app).put('/api/v1/registration-types/4').set(admin()).send({ incluyeKit: true })
        expect(r.status).toBe(200)
        expect(datosDeUpdate()).toEqual({ incluyeKit: true })
        expect(r.body.data.incluyeKit).toBe(true)
    })

    it('actualizar otros campos sin enviarlo conserva el kit (no escribe la columna)', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(conKit)
        const r = await request(app).put('/api/v1/registration-types/3').set(admin()).send({ nombre: 'ESTUDIANTES UNDC' })
        expect(r.status).toBe(200)
        expect(datosDeUpdate()).toEqual({ nombre: 'ESTUDIANTES UNDC' })
    })

    it('pasar un tipo con kit a virtual le quita el kit, aunque el cuerpo no lo mencione', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue(conKit)
        const r = await request(app).put('/api/v1/registration-types/3').set(admin()).send({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(200)
        expect(datosDeUpdate()).toEqual({ modalidad: 'VIRTUAL', incluyeKit: false })
    })

    it('a un tipo virtual no se le puede encender el kit', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue({ ...sinKit, modalidad: 'VIRTUAL' })
        const r = await request(app).put('/api/v1/registration-types/4').set(admin()).send({ incluyeKit: true })
        expect(r.status).toBe(200)
        expect(datosDeUpdate()).toEqual({ incluyeKit: false })
    })

    it('pasar de virtual a presencial no devuelve el kit por su cuenta', async () => {
        m.tipoInscripcion.findUnique.mockResolvedValue({ ...sinKit, modalidad: 'VIRTUAL' })
        const r = await request(app).put('/api/v1/registration-types/4').set(admin()).send({ modalidad: 'PRESENCIAL' })
        expect(r.status).toBe(200)
        expect(datosDeUpdate()).toEqual({ modalidad: 'PRESENCIAL' })
    })

    it('el listado del panel lo incluye, también sin permiso de pagos (no es un precio)', async () => {
        const conPagos = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(conPagos.body.data[0].tipos.map((t: { incluyeKit: boolean }) => t.incluyeKit)).toEqual([true, false])
        const comision = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })
        const sinPagos = await request(app).get('/api/v1/events/2/registration-categories').set({ Authorization: `Bearer ${comision}` })
        expect(sinPagos.body.data[0].tipos[0]).toMatchObject({ incluyeKit: true, precio: null, precioInstitucional: null })
    })

    it('una fila sin la columna (esquema anterior) se lee sin kit', async () => {
        const { incluyeKit: _omitida, ...sinColumna } = conKit
        void _omitida
        m.categoriaInscripcion.findMany.mockResolvedValue([{ ...categoria, tipos: [sinColumna] }])
        const r = await request(app).get('/api/v1/events/2/registration-categories').set(admin())
        expect(r.body.data[0].tipos[0].incluyeKit).toBe(false)
    })
})

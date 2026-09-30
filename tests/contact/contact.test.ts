import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        mensajeContacto: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
    },
}))

const m = prisma as unknown as {
    mensajeContacto: { findUnique: jest.Mock, findMany: jest.Mock, count: jest.Mock, update: jest.Mock, delete: jest.Mock }
    evento: { findUnique: jest.Mock }
}

const mensaje = (eventoId: number | null) => ({ id: 8, eventoId, nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', asunto: 'Hola', mensaje: 'Consulta', leido: false })

// TESORERO y COMISION (mensajes.ver) del evento 2. Ninguno puede eliminar: «mensajes.eliminar» no
// es elegible para la Comisión ni lo tiene el Tesorero.
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['mensajes.ver'] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}` }))
    m.mensajeContacto.findMany.mockResolvedValue([mensaje(2)])
    m.mensajeContacto.count.mockResolvedValue(1)
    m.mensajeContacto.update.mockImplementation(({ data }: { data: { leido: boolean } }) => Promise.resolve({ ...mensaje(2), ...data }))
})

describe('mensajes de contacto por evento', () => {
    it('la cuenta por evento lista los mensajes de su evento y no los de otro', async () => {
        const suyo = await request(app).get('/api/v1/events/2/contact-messages').set(con(tesorero()))
        expect(suyo.status).toBe(200)
        expect(suyo.body.data).toHaveLength(1)
        const otro = await request(app).get('/api/v1/events/3/contact-messages').set(con(tesorero()))
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it('marca como leído un mensaje de su evento', async () => {
        m.mensajeContacto.findUnique.mockResolvedValue(mensaje(2))
        const r = await request(app).patch('/api/v1/contact-messages/8').set(con(tesorero())).send({ leido: true })
        expect(r.status).toBe(200)
        expect(r.body.data.leido).toBe(true)
    })

    it('un mensaje antiguo sin evento no es de ninguna cuenta por evento', async () => {
        m.mensajeContacto.findUnique.mockResolvedValue(mensaje(null))
        for (const token of [tesorero(), comision()]) {
            const leer = await request(app).patch('/api/v1/contact-messages/8').set(con(token)).send({ leido: true })
            expect(leer.status).toBe(404)
            expect(leer.body.code).toBe('NOT_FOUND')
        }
        expect(m.mensajeContacto.update).not.toHaveBeenCalled()
    })

    it('un mensaje de otro evento responde 403', async () => {
        m.mensajeContacto.findUnique.mockResolvedValue(mensaje(3))
        const r = await request(app).patch('/api/v1/contact-messages/8').set(con(tesorero())).send({ leido: true })
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it('eliminar exige «mensajes.eliminar»', async () => {
        m.mensajeContacto.findUnique.mockResolvedValue(mensaje(2))
        for (const token of [tesorero(), comision()]) {
            const sinPermiso = await request(app).delete('/api/v1/contact-messages/8').set(con(token))
            expect(sinPermiso.status).toBe(403)
            expect(sinPermiso.body.code).toBe('FORBIDDEN')
        }
        expect(m.mensajeContacto.delete).not.toHaveBeenCalled()
        const admin = await request(app).delete('/api/v1/contact-messages/8').set(con(tokenDeRol('ADMIN')))
        expect(admin.status).toBe(200)
        expect(m.mensajeContacto.delete).toHaveBeenCalledWith({ where: { id: 8 } })
    })

    it('sin «mensajes.ver» no ve los mensajes', async () => {
        const soloAsistencia = tokenDeRol('COMISION', 41, { eventoIds: [2], permisos: ['asistencia.marcar'] })
        const r = await request(app).get('/api/v1/events/2/contact-messages').set(con(soloAsistencia))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })

    it('una cuenta global ve los mensajes sin evento', async () => {
        m.mensajeContacto.findUnique.mockResolvedValue(mensaje(null))
        const r = await request(app).patch('/api/v1/contact-messages/8').set(con(tokenDeRol('ADMIN'))).send({ leido: true })
        expect(r.status).toBe(200)
    })
})

describe('rutas legacy de contacto', () => {
    it.each([
        ['get', '/api/v1/contact'],
        ['get', '/api/v1/contact/8'],
        ['delete', '/api/v1/contact/8'],
    ])('%s %s responde 403 a una cuenta por evento', async (method, ruta) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(con(tesorero()))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })

    it('una cuenta global las usa', async () => {
        const r = await request(app).get('/api/v1/contact').set(con(tokenDeRol('ADMIN')))
        expect(r.status).toBe(200)
        expect(r.body).toHaveLength(1)
    })
})

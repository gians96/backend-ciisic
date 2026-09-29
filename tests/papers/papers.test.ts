import request from 'supertest'
import fs from 'fs'
import path from 'path'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { papersDirectory } from '../../src/api/papers/services/papers'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        ponencia: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
    },
}))

const m = prisma as unknown as {
    ponencia: { create: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock, count: jest.Mock }
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
}
const evento = { id: 1, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO', esPrincipal: true }
const autor = { firstName: 'Ana', lastName: 'Pérez', university: 'UNDC' }
const payload = { title: 'Investigación de prueba', mainAuthor: autor, coauthors: [] }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')

const enviar = (url: string, data: unknown, buffer = pdf, filename = 'paper.pdf', contentType = 'application/pdf') =>
    request(app).post(url).field('data', JSON.stringify(data)).attach('file', buffer, { filename, contentType })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.evento.findFirst.mockResolvedValue(evento)
})

describe('registro de ponencias', () => {
    it('guarda el PDF asociado al evento y restringe la descarga a administradores', async () => {
        let guardado: Record<string, unknown> = {}
        m.ponencia.create.mockImplementation(({ data }) => {
            guardado = data
            return Promise.resolve({ id: data.id, creadoEn: new Date() })
        })
        const r = await enviar('/api/v1/public/events/ciisic-viii-2026/papers', { ...payload, coauthors: [{ ...autor, university: 'Otra' }] })
        expect(r.status).toBe(201)
        expect(r.body.data.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(guardado).toMatchObject({ eventoId: 1, titulo: 'Investigación de prueba', coautores: [{ ...autor, university: 'Otra' }] })
        expect(fs.readFileSync(path.join(papersDirectory, String(guardado.archivo)))).toEqual(pdf)

        const url = `/api/v1/papers/${r.body.data.id}/file`
        expect((await request(app).get(url)).status).toBe(401)
        m.ponencia.findUnique.mockResolvedValue(guardado)
        const descarga = await request(app).get(url).set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(descarga.status).toBe(200)
        expect(descarga.headers['content-disposition']).toContain('attachment')
    })

    it('la ruta legacy usa el evento principal', async () => {
        m.ponencia.create.mockImplementation(({ data }) => Promise.resolve({ id: data.id, creadoEn: new Date() }))
        const r = await enviar('/api/v1/papers', payload)
        expect(r.status).toBe(201)
        expect(m.ponencia.create.mock.calls[0][0].data.eventoId).toBe(1)
    })

    it('rechaza archivos que no son PDF y datos incompletos', async () => {
        expect((await enviar('/api/v1/papers', payload, Buffer.from('hola'), 'paper.pdf')).body.code).toBe('INVALID_PDF')
        expect((await enviar('/api/v1/papers', { title: '' })).body.code).toBe('INVALID_PAPER')
        expect(m.ponencia.create).not.toHaveBeenCalled()
    })
})

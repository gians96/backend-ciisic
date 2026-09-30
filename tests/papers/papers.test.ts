import request from 'supertest'
import fs from 'fs'
import path from 'path'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { papersDirectory } from '../../src/api/papers/services/papers'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        ponencia: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

const m = prisma as unknown as {
    ponencia: { create: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock, count: jest.Mock }
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock }
}
const evento = { id: 1, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO', esPrincipal: true }
const autor = { firstName: 'Ana', lastName: 'Pérez', university: 'UNDC' }
const payload = { title: 'Investigación de prueba', mainAuthor: autor, coauthors: [] }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')

const enviar = (url: string, data: unknown, buffer = pdf, filename = 'paper.pdf', contentType = 'application/pdf') =>
    request(app).post(url).set('X-Api-Key', TOKEN_SITIO).field('data', JSON.stringify(data)).attach('file', buffer, { filename, contentType })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.evento.findFirst.mockResolvedValue(evento)
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
})

describe('registro de ponencias', () => {
    it('guarda el PDF asociado al evento y restringe la descarga a administradores', async () => {
        let guardado: Record<string, unknown> = {}
        m.ponencia.create.mockImplementation(({ data }) => {
            guardado = data
            return Promise.resolve({ id: data.id, creadoEn: new Date() })
        })
        const r = await enviar('/api/v1/site/papers', { ...payload, coauthors: [{ ...autor, university: 'Otra' }] })
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

describe('ponencias por evento (spec 013)', () => {
    const UUID = '3f2c1a9e-7b4d-4e21-9a6f-0c8d5e7b1a23'
    const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })

    it('la ponencia de otro evento responde 403 aunque el código venga en mayúsculas', async () => {
        // La BD compara sin distinguir mayúsculas: el resolutor debe encontrarla igual
        m.ponencia.findUnique.mockResolvedValue({ id: UUID, eventoId: 3, archivo: `${UUID}.pdf` })
        const r = await request(app).get(`/api/v1/papers/${UUID.toUpperCase()}/file`).set('Authorization', `Bearer ${tesorero()}`)
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect(m.ponencia.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: UUID.toUpperCase() } }))
    })

    it('la ponencia de su evento se descarga', async () => {
        const archivo = `${UUID}.pdf`
        fs.mkdirSync(papersDirectory, { recursive: true })
        fs.writeFileSync(path.join(papersDirectory, archivo), pdf)
        m.ponencia.findUnique.mockResolvedValue({ id: UUID, eventoId: 2, archivo })
        const r = await request(app).get(`/api/v1/papers/${UUID}/file`).set('Authorization', `Bearer ${tesorero()}`)
        expect(r.status).toBe(200)
        expect(r.headers['content-disposition']).toContain('attachment')
    })

    it('un código de recepción inválido responde 400 y no consulta la BD', async () => {
        const r = await request(app).get('/api/v1/papers/no-es-uuid/file').set('Authorization', `Bearer ${tesorero()}`)
        expect(r.status).toBe(400)
        expect(r.body.code).toBe('INVALID_ID')
        expect(m.ponencia.findUnique).not.toHaveBeenCalled()
    })

    it('la lista de otro evento responde 403 y la del suyo, 200', async () => {
        m.ponencia.count.mockResolvedValue(0)
        m.ponencia.findMany.mockResolvedValue([])
        const otro = await request(app).get('/api/v1/events/3/papers').set('Authorization', `Bearer ${tesorero()}`)
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        const suyo = await request(app).get('/api/v1/events/2/papers').set('Authorization', `Bearer ${tesorero()}`)
        expect(suyo.status).toBe(200)
    })

    it('sin «ponencias.ver» (Comisión) responde 403; la ruta legacy es solo de las cuentas globales', async () => {
        const comision = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] })
        expect((await request(app).get('/api/v1/events/2/papers').set('Authorization', `Bearer ${comision}`)).status).toBe(403)
        expect((await request(app).get(`/api/v1/papers/${UUID}/file`).set('Authorization', `Bearer ${comision}`)).status).toBe(403)
        const legacy = await request(app).get('/api/v1/papers').set('Authorization', `Bearer ${tesorero()}`)
        expect(legacy.status).toBe(403)
        expect(legacy.body.code).toBe('FORBIDDEN')
    })
})

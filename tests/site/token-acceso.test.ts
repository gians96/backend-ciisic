import type { NextFunction, Response } from 'express'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { generarTokenAcceso, hashTokenAcceso, tieneFormatoDeTokenAcceso } from '../../src/core/tokens-acceso'
import { requireTokenEvento, type SitioRequest } from '../../src/middlewares/sitio'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tokenAcceso: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        evento: { findUnique: jest.fn() },
        categoriaInscripcion: { findMany: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as {
    tokenAcceso: { findUnique: jest.Mock, findMany: jest.Mock, create: jest.Mock, update: jest.Mock }
    evento: { findUnique: jest.Mock }
    categoriaInscripcion: { findMany: jest.Mock }
    configuracionSistema: { findUnique: jest.Mock }
}
const evento = { id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }
const superAdmin = () => `Bearer ${tokenDeRol('SUPERADMIN', 5)}`

beforeEach(() => {
    jest.clearAllMocks()
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('formato y hash de los tokens de acceso', () => {
    it('genera tokens ciisic_ de 256 bits con prefijo visible y hash estable', () => {
        const a = generarTokenAcceso()
        const b = generarTokenAcceso()
        expect(tieneFormatoDeTokenAcceso(a.token)).toBe(true)
        expect(a.token).not.toBe(b.token)
        expect(a.prefijo).toBe(a.token.slice(0, 15))
        expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
        expect(hashTokenAcceso(a.token)).toBe(a.hash)
        expect(a.hash).not.toBe(b.hash)
    })
})

describe('middleware de la API del sitio', () => {
    const llamar = (headers: Record<string, string>) => request(app).get('/api/v1/site/registration-types').set(headers)

    it('exige la cabecera X-Api-Key', async () => {
        const r = await llamar({})
        expect(r.status).toBe(401)
        expect(r.body).toMatchObject({ success: false, code: 'EVENT_TOKEN_REQUIRED' })
    })

    it('rechaza sin consultar la BD un valor con formato inválido', async () => {
        const r = await llamar({ 'X-Api-Key': 'otro-token' })
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('INVALID_EVENT_TOKEN')
        expect(m.tokenAcceso.findUnique).not.toHaveBeenCalled()
    })

    it.each([
        ['inexistente', null],
        ['revocado', registroDeToken(evento, { revocadoEn: new Date('2026-01-01') })],
        ['expirado', registroDeToken(evento, { expiraEn: new Date('2020-01-01') })],
    ])('rechaza un token %s', async (_caso, registro) => {
        m.tokenAcceso.findUnique.mockResolvedValue(registro)
        const r = await llamar({ 'X-Api-Key': TOKEN_SITIO })
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('INVALID_EVENT_TOKEN')
        expect(m.tokenAcceso.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashTokenAcceso(TOKEN_SITIO) } }))
    })

    it('resuelve el evento del token y responde con sus tipos de inscripción', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
        m.categoriaInscripcion.findMany.mockResolvedValue([])
        const r = await llamar({ 'X-Api-Key': TOKEN_SITIO })
        expect(r.status).toBe(200)
        expect(m.categoriaInscripcion.findMany.mock.calls[0][0].where).toMatchObject({ eventoId: 2 })
        expect(m.tokenAcceso.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { ultimoUsoEn: expect.any(Date) } })
    })

    it('usa la IP del visitante reenviada por el BFF solo si es una IP válida', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
        const ejecutar = async (clienteIp?: string) => {
            const req = { headers: { 'x-api-key': TOKEN_SITIO, ...(clienteIp ? { 'x-client-ip': clienteIp } : {}) }, ip: '10.0.0.9' } as unknown as SitioRequest
            await requireTokenEvento(req, {} as Response, jest.fn() as NextFunction)
            return req
        }
        expect((await ejecutar('203.0.113.7')).clienteIp).toBe('203.0.113.7')
        expect((await ejecutar('2001:db8::1')).clienteIp).toBe('2001:db8::1')
        expect((await ejecutar('no-es-ip, 1.2.3.4')).clienteIp).toBe('10.0.0.9')
        expect((await ejecutar()).eventoSitio).toMatchObject({ id: 2 })
    })

    it('CORS abierto: cualquier origen puede usar X-Api-Key (lo protege el token)', async () => {
        const r = await request(app).options('/api/v1/site/event')
            .set('Origin', 'https://otra-plataforma.example')
            .set('Access-Control-Request-Method', 'GET')
            .set('Access-Control-Request-Headers', 'x-api-key')
        expect(r.status).toBe(204)
        expect(r.headers['access-control-allow-origin']).toBe('*')
        expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-api-key')
    })
})

describe('administración de tokens de acceso', () => {
    it('crea el token, guarda solo el hash y devuelve el valor una única vez', async () => {
        m.evento.findUnique.mockResolvedValue(evento)
        m.tokenAcceso.create.mockImplementation(({ data }) => Promise.resolve({
            id: 11, ...data, ultimoUsoEn: null, revocadoEn: null, creadoEn: new Date(), creadoPor: { id: 5, nombres: 'Ana', apellidos: 'Admin' },
        }))
        const r = await request(app).post('/api/v1/events/2/access-tokens').set('Authorization', superAdmin()).send({ nombre: 'Landing VIII' })
        expect(r.status).toBe(201)
        expect(r.headers['cache-control']).toBe('no-store')
        const { token, prefijo, estado } = r.body.data
        expect(tieneFormatoDeTokenAcceso(token)).toBe(true)
        expect(token.startsWith(prefijo)).toBe(true)
        expect(estado).toBe('ACTIVO')
        const guardado = m.tokenAcceso.create.mock.calls[0][0].data
        expect(guardado).toMatchObject({ eventoId: 2, nombre: 'Landing VIII', tokenHash: hashTokenAcceso(token), creadoPorId: 5 })
        expect(JSON.stringify(guardado)).not.toContain(token)
        expect(r.body.data).not.toHaveProperty('tokenHash')
    })

    it('valida que la expiración sea futura', async () => {
        const r = await request(app).post('/api/v1/events/2/access-tokens').set('Authorization', superAdmin())
            .send({ nombre: 'Landing', expiraEn: '2020-01-01T00:00:00Z' })
        expect(r.status).toBe(422)
    })

    it('lista sin exponer hashes y revoca de forma idempotente', async () => {
        const base = { id: 11, eventoId: 2, nombre: 'Landing', prefijo: 'ciisic_AbCdEfGh', tokenHash: 'x'.repeat(64), ultimoUsoEn: null, expiraEn: null, creadoEn: new Date(), creadoPor: null }
        m.evento.findUnique.mockResolvedValue(evento)
        m.tokenAcceso.findMany.mockResolvedValue([{ ...base, revocadoEn: null }])
        const lista = await request(app).get('/api/v1/events/2/access-tokens').set('Authorization', superAdmin())
        expect(lista.body.data[0]).toMatchObject({ prefijo: 'ciisic_AbCdEfGh', estado: 'ACTIVO' })
        expect(lista.body.data[0]).not.toHaveProperty('tokenHash')

        m.tokenAcceso.findUnique.mockResolvedValue({ ...base, revocadoEn: null })
        m.tokenAcceso.update.mockResolvedValue({ ...base, revocadoEn: new Date() })
        const revocado = await request(app).delete('/api/v1/access-tokens/11').set('Authorization', superAdmin())
        expect(revocado.body.data.estado).toBe('REVOCADO')

        m.tokenAcceso.update.mockClear()
        m.tokenAcceso.findUnique.mockResolvedValue({ ...base, revocadoEn: new Date() })
        const otraVez = await request(app).delete('/api/v1/access-tokens/11').set('Authorization', superAdmin())
        expect(otraVez.body.data.estado).toBe('REVOCADO')
        expect(m.tokenAcceso.update).not.toHaveBeenCalled()
    })
})

describe('acceso a la administración de tokens (spec 013)', () => {
    const rutas: ['get' | 'post' | 'delete', string][] = [
        ['get', '/api/v1/events/2/access-tokens'],
        ['post', '/api/v1/events/2/access-tokens'],
        ['delete', '/api/v1/access-tokens/11'],
    ]

    it('el Administrador del sistema crea tokens y queda como autor', async () => {
        m.evento.findUnique.mockResolvedValue(evento)
        m.tokenAcceso.create.mockImplementation(({ data }) => Promise.resolve({
            id: 12, ...data, ultimoUsoEn: null, revocadoEn: null, creadoEn: new Date(), creadoPor: { id: 2, nombres: 'Test', apellidos: 'Administrador del sistema' },
        }))
        const r = await request(app).post('/api/v1/events/2/access-tokens').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`).send({ nombre: 'Landing VIII' })
        expect(r.status).toBe(201)
        expect(m.tokenAcceso.create.mock.calls[0][0].data).toMatchObject({ eventoId: 2, creadoPorId: 2 })
    })

    // Aunque el evento sea suyo: los tokens son configuración del evento, no operación
    it.each(rutas)('%s %s responde 403 al Tesorero y a la Comisión del evento', async (metodo, ruta) => {
        const tokens = [
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] }),
        ]
        for (const token of tokens) {
            const r = await request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).send({ nombre: 'Landing' })
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        expect(m.evento.findUnique).not.toHaveBeenCalled()
        for (const mock of Object.values(m.tokenAcceso)) expect(mock).not.toHaveBeenCalled()
    })
})

describe('rutas legacy', () => {
    it('responden 410 cuando se desactivan en Sistema', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, rutasLegacyActivas: false, undcApiTimeoutMs: 8000 })
        const { reiniciarCacheConfiguracion } = await import('../../src/core/configuracion-sistema')
        reiniciarCacheConfiguracion()
        const r = await request(app).get('/api/v1/registration-types')
        expect(r.status).toBe(410)
        expect(r.body).toMatchObject({ code: 'LEGACY_ROUTE_DISABLED' })
        reiniciarCacheConfiguracion()
    })
})

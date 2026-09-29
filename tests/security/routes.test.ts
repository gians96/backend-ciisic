import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: { tokenAcceso: { findUnique: jest.fn(), update: jest.fn() } },
}))

const m = prisma as unknown as { tokenAcceso: { findUnique: jest.Mock } }
const evento = { id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }

beforeEach(() => {
    jest.clearAllMocks()
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
})

describe('seguridad de rutas administrativas', () => {
    it.each([
        ['get', '/api/v1/events'],
        ['get', '/api/v1/events/1/inscriptions'],
        ['patch', '/api/v1/inscriptions/1/status'],
        ['get', '/api/v1/inscriptions/1/voucher'],
        ['get', '/api/v1/lookup-tokens'],
        ['post', '/api/v1/lookup-tokens'],
        ['get', '/api/v1/events/1/integrations/sports-summary'],
        ['get', '/api/v1/participants'],
        ['get', '/api/v1/inscription'],
        ['get', '/api/v1/email-credentials'],
        ['post', '/api/v1/email-credentials/1/test'],
        ['get', '/api/v1/events/1/access-tokens'],
        ['post', '/api/v1/events/1/access-tokens'],
        ['delete', '/api/v1/access-tokens/1'],
        ['get', '/api/v1/settings'],
        ['put', '/api/v1/settings'],
        ['get', '/api/v1/me'],
        ['get', '/api/v1/me/inscriptions'],
    ])('%s %s exige token', async (method, path) => {
        const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
        expect(response.status).toBe(401)
        expect(response.body).toMatchObject({ success: false, code: 'MISSING_TOKEN' })
    })

    it('permite consultar la sesión a un Admin', async () => {
        const response = await request(app).get('/api/v1/auth/session').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(response.status).toBe(200)
        expect(response.body.user).toMatchObject({ rolCodigo: 'ADMIN' })
        expect(response.body.user).not.toHaveProperty('contrasenaHash')
    })

    it.each([
        ['get', '/api/v1/admin'],
        ['get', '/api/v1/email-credentials'],
        ['post', '/api/v1/events/1/access-tokens'],
        ['delete', '/api/v1/access-tokens/1'],
        ['get', '/api/v1/settings'],
        ['post', '/api/v1/settings/undc-api/test'],
    ])('solo SuperAdmin: %s %s responde 403 a un Admin', async (method, path) => {
        const response = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
            .set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(response.status).toBe(403)
        expect(response.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
    })

    it('rechaza tokens firmados con otro secreto', async () => {
        const falso = tokenDeRol('SUPERADMIN').replace(/\.[^.]+$/, '.firma-invalida')
        const response = await request(app).get('/api/v1/admin').set('Authorization', `Bearer ${falso}`)
        expect(response.status).toBe(401)
    })

    it('responde JSON 404 en rutas inexistentes', async () => {
        const response = await request(app).get('/api/v1/no-existe')
        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({ success: false, code: 'NOT_FOUND' })
    })
})

describe('seguridad de uploads', () => {
    it('rechaza contenido que no coincide con el MIME declarado', async () => {
        const response = await request(app)
            .post('/api/v1/site/inscriptions')
            .set('X-Api-Key', TOKEN_SITIO)
            .attach('voucher', Buffer.from('not-a-real-png'), { filename: 'voucher.png', contentType: 'image/png' })
        expect(response.status).toBe(422)
        expect(response.body).toMatchObject({ success: false, code: 'INVALID_FILE_CONTENT' })
    })

    it('rechaza tipos de archivo no permitidos', async () => {
        const response = await request(app)
            .post('/api/v1/inscription')
            .attach('file', Buffer.from('MZ'), { filename: 'virus.exe', contentType: 'application/octet-stream' })
        expect(response.status).toBe(422)
        expect(response.body).toMatchObject({ success: false, code: 'INVALID_FILE_TYPE' })
    })

    it('rechaza archivos que exceden el límite configurado', async () => {
        const response = await request(app)
            .post('/api/v1/site/inscriptions')
            .set('X-Api-Key', TOKEN_SITIO)
            .attach('voucher', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'voucher.png', contentType: 'image/png' })
        expect(response.status).toBe(413)
        expect(response.body).toMatchObject({ success: false, code: 'UPLOAD_LIMIT_EXCEEDED' })
    })
})

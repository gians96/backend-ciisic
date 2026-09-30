import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tokenConsulta: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
        consultaDocumento: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), create: jest.fn() },
        personaConsultada: { findUnique: jest.fn(), upsert: jest.fn() },
    },
}))

type Modelos = Record<'tokenConsulta' | 'consultaDocumento' | 'personaConsultada', Record<string, jest.Mock>>
const m = prisma as unknown as Modelos

beforeEach(() => jest.clearAllMocks())

describe('acceso a las consultas DNI del panel (spec 013)', () => {
    const rutas: ['get' | 'post' | 'put' | 'delete', string][] = [
        ['get', '/api/v1/document-lookup/dni/12345678'],
        ['get', '/api/v1/lookup-tokens'],
        ['post', '/api/v1/lookup-tokens'],
        ['get', '/api/v1/lookup-tokens/usage'],
        ['get', '/api/v1/lookup-tokens/logs'],
        ['put', '/api/v1/lookup-tokens/1'],
        ['delete', '/api/v1/lookup-tokens/1'],
        ['post', '/api/v1/lookup-tokens/1/reset'],
        ['post', '/api/v1/lookup-tokens/1/test'],
    ]

    it.each(rutas)('%s %s exige sesión', async (metodo, ruta) => {
        const r = await request(app)[metodo](ruta)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('MISSING_TOKEN')
    })

    it('el Administrador del sistema gestiona el pool de tokens', async () => {
        m.tokenConsulta.findMany.mockResolvedValue([])
        const r = await request(app).get('/api/v1/lookup-tokens').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(r.status).toBe(200)
        expect(r.body).toEqual({ success: true, data: [] })
    })

    // Aunque la Comisión tenga todos sus permisos elegibles: el pool DNI es configuración global
    it.each(rutas)('%s %s responde 403 al Tesorero y a la Comisión sin tocar la BD', async (metodo, ruta) => {
        const tokens = [
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] }),
        ]
        for (const token of tokens) {
            const r = await request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).send({})
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        for (const modelo of Object.values(m)) {
            for (const mock of Object.values(modelo)) expect(mock).not.toHaveBeenCalled()
        }
    })
})

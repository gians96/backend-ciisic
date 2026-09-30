import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

// Clasificaciones (spec 013): la lectura sigue pública; las escrituras exigen `catalogos.configurar`.
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        clasificacion: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        inscripcion: { count: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { clasificacion: Record<'findMany' | 'findUnique' | 'create' | 'update' | 'delete', Mock>, inscripcion: { count: Mock } }
const ESCRITURAS: Array<[string, string, Record<string, unknown>]> = [
    ['post', '/api/v1/classification', { nombre: 'EGRESADO' }],
    ['put', '/api/v1/classification/3', { nombre: 'EGRESADO' }],
    ['delete', '/api/v1/classification/3', {}],
]
const llamar = (method: string, path: string, auth?: string) => {
    const r = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
    return auth ? r.set('Authorization', `Bearer ${auth}`) : r
}

beforeEach(() => {
    jest.clearAllMocks()
    m.clasificacion.findMany.mockResolvedValue([{ id: 1, nombre: 'ESTUDIANTE - I CICLO' }])
    m.clasificacion.findUnique.mockResolvedValue({ id: 3, nombre: 'ESTUDIANTE - III CICLO' })
    m.clasificacion.create.mockImplementation(async ({ data }) => ({ id: 11, ...data }))
    m.clasificacion.update.mockImplementation(async ({ data }) => ({ id: 3, ...data }))
    m.clasificacion.delete.mockResolvedValue({})
    m.inscripcion.count.mockResolvedValue(0)
})

describe('clasificaciones', () => {
    it('la lista sigue siendo pública', async () => {
        const r = await request(app).get('/api/v1/classification')
        expect(r.status).toBe(200)
        expect(r.body).toEqual([{ id: 1, nombre: 'ESTUDIANTE - I CICLO' }])
    })

    it.each(ESCRITURAS)('%s %s: el Administrador del sistema puede', async (method, path, cuerpo) => {
        const r = await llamar(method, path, tokenDeRol('ADMIN')).send(cuerpo)
        expect(r.status).toBeLessThan(300)
    })

    it.each(ESCRITURAS)('%s %s: Tesorero y Comisión reciben 403 (antes de validar el cuerpo); sin token, 401', async (method, path) => {
        for (const token of [tokenDeRol('TESORERO', 30, { eventoIds: [2] }), tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] })]) {
            const r = await llamar(method, path, token).send({})
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect((await llamar(method, path)).status).toBe(401)
        expect(m.clasificacion.create).not.toHaveBeenCalled()
        expect(m.clasificacion.update).not.toHaveBeenCalled()
        expect(m.clasificacion.delete).not.toHaveBeenCalled()
    })
})

import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: { participante: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } },
}))

const m = (prisma as unknown as { participante: Record<string, jest.Mock> }).participante

function participante(cambios: Record<string, unknown> = {}) {
    return {
        id: 7, tipoDocumentoId: 1, numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '999888777',
        googleSub: null, googleVinculadoEn: null, creadoEn: new Date(), actualizadoEn: new Date(), ...cambios,
    }
}

beforeEach(() => jest.clearAllMocks())

describe('acceso a los participantes (spec 013)', () => {
    const rutas: ['get' | 'post' | 'put', string][] = [
        ['get', '/api/v1/participants'],
        ['post', '/api/v1/participants'],
        ['get', '/api/v1/participants/7'],
        ['put', '/api/v1/participants/7'],
    ]

    it.each(rutas)('%s %s exige sesión', async (metodo, ruta) => {
        const r = await request(app)[metodo](ruta)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('MISSING_TOKEN')
    })

    it('el Administrador del sistema los lista y los edita', async () => {
        const admin = `Bearer ${tokenDeRol('ADMIN')}`
        m.count.mockResolvedValue(1)
        m.findMany.mockResolvedValue([participante()])
        const lista = await request(app).get('/api/v1/participants').set('Authorization', admin)
        expect(lista.status).toBe(200)
        expect(lista.body.data[0]).toMatchObject({ id: 7, numeroDocumento: '12345678' })

        m.findUnique.mockResolvedValue(participante())
        m.update.mockImplementation(({ data }) => Promise.resolve(participante(data)))
        const editado = await request(app).put('/api/v1/participants/7').set('Authorization', admin).send({ celular: '987654321' })
        expect(editado.status).toBe(200)
        expect(editado.body.data.celular).toBe('987654321')
    })

    // Son personas de todos los eventos: una cuenta por evento no las ve aunque tenga todos sus permisos
    it.each(rutas)('%s %s responde 403 al Tesorero y a la Comisión sin tocar la BD', async (metodo, ruta) => {
        const tokens = [
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] }),
        ]
        for (const token of tokens) {
            // Un cuerpo inválido confirma que la guarda va antes de la validación (403, no 422)
            const r = await request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).send({ correo: 'no-es-correo' })
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        for (const mock of Object.values(m)) expect(mock).not.toHaveBeenCalled()
    })
})

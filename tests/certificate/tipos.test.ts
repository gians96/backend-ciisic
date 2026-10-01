import request from 'supertest'
import { Prisma } from '@prisma/client'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tipoCertificado: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { tipoCertificado: Record<'findMany' | 'findUnique' | 'create' | 'update', Mock> }

const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const OWNER = () => `Bearer ${tokenDeRol('SUPERADMIN')}`
const TESORERO = () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}`
const COMISION = (permisos: string[]) => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })}`

const TIPOS = [
    { id: 1, codigo: 'PARTICIPANTE', nombre: 'Participante', textoImpreso: 'PARTICIPANTE', activo: true, orden: 1 },
    { id: 2, codigo: 'ORGANIZADOR', nombre: 'Organizador', textoImpreso: 'ORGANIZADOR', activo: true, orden: 2 },
    { id: 3, codigo: 'PONENTE', nombre: 'Ponente', textoImpreso: 'PONENTE', activo: false, orden: 3 },
]

beforeEach(() => {
    jest.clearAllMocks()
    m.tipoCertificado.findMany.mockResolvedValue(TIPOS)
    m.tipoCertificado.findUnique.mockImplementation(({ where }) => Promise.resolve(TIPOS.find((t) => t.id === where.id || t.codigo === where.codigo) ?? null))
    m.tipoCertificado.create.mockImplementation(({ data }) => Promise.resolve({ id: 10, ...data }))
    m.tipoCertificado.update.mockImplementation(({ where, data }) => Promise.resolve({ ...TIPOS.find((t) => t.id === where.id), ...data }))
})

describe('GET /v1/certificate-types', () => {
    it('exige sesión de staff y certificados.ver o certificados.gestionar', async () => {
        expect((await request(app).get('/api/v1/certificate-types')).status).toBe(401)
        const sinPermiso = await request(app).get('/api/v1/certificate-types').set('Authorization', COMISION(['asistencia.marcar']))
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body.code).toBe('FORBIDDEN')
        expect(m.tipoCertificado.findMany).not.toHaveBeenCalled()
    })

    it('el Tesorero (certificados.ver) y la Comisión con certificados.ver leen el catálogo ordenado', async () => {
        for (const token of [TESORERO(), COMISION(['certificados.ver']), ADMIN()]) {
            const r = await request(app).get('/api/v1/certificate-types').set('Authorization', token)
            expect(r.status).toBe(200)
            expect(r.body.data).toEqual(TIPOS)
        }
        expect(m.tipoCertificado.findMany).toHaveBeenLastCalledWith({ where: {}, orderBy: [{ orden: 'asc' }, { id: 'asc' }] })
    })

    it('filtra por activo y rechaza un filtro inválido', async () => {
        await request(app).get('/api/v1/certificate-types?activo=true').set('Authorization', ADMIN())
        expect(m.tipoCertificado.findMany.mock.calls[0][0].where).toEqual({ activo: true })
        const malo = await request(app).get('/api/v1/certificate-types?activo=si').set('Authorization', ADMIN())
        expect(malo.status).toBe(400)
        expect(malo.body.code).toBe('INVALID_FILTER')
    })
})

describe('POST /v1/certificate-types', () => {
    it('solo certificados.gestionar (ni el Tesorero ni la Comisión con todos sus permisos elegibles)', async () => {
        for (const token of [TESORERO(), COMISION([...PERMISOS_ELEGIBLES_COMISION])]) {
            const r = await request(app).post('/api/v1/certificate-types').set('Authorization', token).send({ codigo: 'JURADO', nombre: 'Jurado' })
            expect(r.status).toBe(403)
        }
        expect(m.tipoCertificado.create).not.toHaveBeenCalled()
    })

    it('crea con el código en mayúsculas; sin texto impreso usa el nombre en mayúsculas', async () => {
        const r = await request(app).post('/api/v1/certificate-types').set('Authorization', ADMIN()).send({ codigo: ' jurado_calificador ', nombre: 'Jurado calificador', orden: 4 })
        expect(r.status).toBe(201)
        expect(m.tipoCertificado.create).toHaveBeenCalledWith({ data: { codigo: 'JURADO_CALIFICADOR', nombre: 'Jurado calificador', textoImpreso: 'JURADO CALIFICADOR', activo: true, orden: 4 } })
        expect(r.body.data).toEqual({ id: 10, codigo: 'JURADO_CALIFICADOR', nombre: 'Jurado calificador', textoImpreso: 'JURADO CALIFICADOR', activo: true, orden: 4 })
    })

    it.each([
        ['empieza con número', '1JURADO'],
        ['muy corto', 'J'],
        ['con guion', 'JURADO-X'],
        ['muy largo', `J${'X'.repeat(40)}`],
    ])('valida el formato del código (%s)', async (_caso, codigo) => {
        const r = await request(app).post('/api/v1/certificate-types').set('Authorization', OWNER()).send({ codigo, nombre: 'Jurado' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(Object.keys(r.body.fields)).toEqual(['codigo'])
    })

    it('código repetido → 409 DUPLICATE_RECORD', async () => {
        m.tipoCertificado.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
        const r = await request(app).post('/api/v1/certificate-types').set('Authorization', ADMIN()).send({ codigo: 'PONENTE', nombre: 'Ponente' })
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ code: 'DUPLICATE_RECORD', message: expect.stringContaining('PONENTE') })
    })
})

describe('PUT /v1/certificate-types/:id', () => {
    it('edita nombre, texto impreso, orden y activo (desactivar en vez de borrar)', async () => {
        const r = await request(app).put('/api/v1/certificate-types/3').set('Authorization', ADMIN()).send({ codigo: 'ponente', textoImpreso: 'PONENTE MAGISTRAL', activo: true })
        expect(r.status).toBe(200)
        expect(m.tipoCertificado.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { textoImpreso: 'PONENTE MAGISTRAL', activo: true } })
        expect(r.body.data).toMatchObject({ id: 3, codigo: 'PONENTE', textoImpreso: 'PONENTE MAGISTRAL', activo: true })
    })

    it('el código no se edita', async () => {
        const r = await request(app).put('/api/v1/certificate-types/1').set('Authorization', ADMIN()).send({ codigo: 'ASISTENTE' })
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'CERTIFICATE_TYPE_CODE_LOCKED', fields: { codigo: expect.any(String) } })
        expect(m.tipoCertificado.update).not.toHaveBeenCalled()
    })

    it('404 si no existe; sin cambios no escribe', async () => {
        const r = await request(app).put('/api/v1/certificate-types/99').set('Authorization', ADMIN()).send({ nombre: 'Otro' })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('CERTIFICATE_TYPE_NOT_FOUND')
        const igual = await request(app).put('/api/v1/certificate-types/1').set('Authorization', ADMIN()).send({})
        expect(igual.status).toBe(200)
        expect(m.tipoCertificado.update).not.toHaveBeenCalled()
    })

    it('la Comisión con certificados.operar no edita tipos', async () => {
        const r = await request(app).put('/api/v1/certificate-types/1').set('Authorization', COMISION(['certificados.operar'])).send({ activo: false })
        expect(r.status).toBe(403)
    })

    it('no hay DELETE de tipos', async () => {
        const r = await request(app).delete('/api/v1/certificate-types/1').set('Authorization', OWNER())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('NOT_FOUND')
    })
})

import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { MAXIMO_TECNOLOGIAS, tecnologiasDe } from '../../src/api/inscription/services/credencial-publica'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

/**
 * Credencial 3D por código (spec 038): `GET /v1/site/credential/:codigo` da lo que se imprime en la credencial
 * y las tecnologías elegidas; `POST …/technologies` las guarda. Solo inscripciones aprobadas del evento del token.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        inscripcion: { findFirst: jest.fn(), updateMany: jest.fn() },
    },
}))

const m = prisma as unknown as {
    tokenAcceso: { findUnique: jest.Mock, update: jest.Mock }
    inscripcion: { findFirst: jest.Mock, updateMany: jest.Mock }
}
const evento = { id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO' }
const CODIGO = 'K7Q2M9X4TB'

const fila = (cambios: Record<string, unknown> = {}) => ({
    codigoCredencial: CODIGO,
    tecnologiasCredencial: ['vue', 'vite'],
    participante: { nombres: 'Ana María', apellidos: 'Pérez López' },
    tipoInscripcion: { nombre: 'General', etiqueta: 'CON KIT' },
    clasificacion: null,
    evento: { nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' },
    ...cambios,
})

const leer = (codigo = CODIGO) => request(app).get(`/api/v1/site/credential/${codigo}`).set('X-Api-Key', TOKEN_SITIO)
const guardar = (cuerpo: unknown, codigo = CODIGO) => request(app).post(`/api/v1/site/credential/${codigo}/technologies`).set('X-Api-Key', TOKEN_SITIO).send(cuerpo as object)

beforeEach(() => {
    jest.clearAllMocks()
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('tecnologiasDe', () => {
    it('lee la columna JSON con tolerancia: ids válidos, sin repetir y hasta el máximo', () => {
        expect(tecnologiasDe(null)).toEqual([])
        expect(tecnologiasDe('vue')).toEqual([])
        expect(tecnologiasDe(['vue', 'vue', 'node-js', 3, 'MAYUS', '', 'a b', null])).toEqual(['vue', 'node-js'])
        expect(tecnologiasDe(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(MAXIMO_TECNOLOGIAS)
    })
})

describe('GET /v1/site/credential/:codigo', () => {
    it('exige el token del evento', async () => {
        const r = await request(app).get(`/api/v1/site/credential/${CODIGO}`)
        expect(r.status).toBe(401)
        expect(m.inscripcion.findFirst).not.toHaveBeenCalled()
    })

    it('responde lo que se imprime y las tecnologías, sin datos sensibles y sin caché', async () => {
        m.inscripcion.findFirst.mockResolvedValue(fila())
        const r = await leer()
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body).toEqual({
            success: true,
            data: {
                nombres: 'Ana María',
                apellidos: 'Pérez López',
                codigo: CODIGO,
                clasificacion: null,
                tipo: { nombre: 'General', etiqueta: 'CON KIT' },
                tecnologias: ['vue', 'vite'],
                evento: { nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' },
            },
        })
        expect(JSON.stringify(r.body)).not.toMatch(/documento|correo|celular|monto|operacion/i)
    })

    it('busca el código exacto, del evento del token y solo aprobadas', async () => {
        m.inscripcion.findFirst.mockResolvedValue(fila())
        await leer()
        expect(m.inscripcion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { codigoCredencial: CODIGO, eventoId: 2, estado: { codigo: 'APROBADO' } },
        }))
    })

    it('un código inexistente, de otro evento o sin aprobar responde 404 CREDENTIAL_NOT_FOUND', async () => {
        m.inscripcion.findFirst.mockResolvedValue(null)
        const r = await leer()
        expect(r.status).toBe(404)
        expect(r.body).toMatchObject({ success: false, code: 'CREDENTIAL_NOT_FOUND' })
    })

    it.each(['abc', 'k7q2m9x4tb', 'K7Q2M9X4T', 'K7Q2M9X4TBB', 'K7Q2M9X4T-'])('un código mal formado (%s) responde 422 INVALID_CODE sin consultar la BD', async (codigo) => {
        const r = await leer(codigo)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('INVALID_CODE')
        expect(m.inscripcion.findFirst).not.toHaveBeenCalled()
    })

    it('con tipo y clasificación vacíos devuelve null; una columna dañada no rompe la respuesta', async () => {
        m.inscripcion.findFirst.mockResolvedValue(fila({ tipoInscripcion: null, clasificacion: { nombre: 'Estudiante UNDC' }, tecnologiasCredencial: { raro: true } }))
        const r = await leer()
        expect(r.body.data).toMatchObject({ tipo: null, clasificacion: 'Estudiante UNDC', tecnologias: [] })
    })
})

describe('POST /v1/site/credential/:codigo/technologies', () => {
    it('guarda las tecnologías, en el orden elegido, solo en una inscripción aprobada del evento', async () => {
        m.inscripcion.updateMany.mockResolvedValue({ count: 1 })
        const r = await guardar({ tecnologias: ['nuxt', 'vue', 'node-js'] })
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body).toEqual({ success: true, data: { tecnologias: ['nuxt', 'vue', 'node-js'] } })
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({
            where: { codigoCredencial: CODIGO, eventoId: 2, estado: { codigo: 'APROBADO' } },
            data: { tecnologiasCredencial: ['nuxt', 'vue', 'node-js'] },
        })
    })

    it('una lista vacía las borra', async () => {
        m.inscripcion.updateMany.mockResolvedValue({ count: 1 })
        const r = await guardar({ tecnologias: [] })
        expect(r.status).toBe(200)
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { tecnologiasCredencial: [] } }))
    })

    it('sin inscripción aprobada con ese código responde 404', async () => {
        m.inscripcion.updateMany.mockResolvedValue({ count: 0 })
        const r = await guardar({ tecnologias: ['vue'] })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('CREDENTIAL_NOT_FOUND')
    })

    it.each([
        ['sin el campo', {}],
        ['no es una lista', { tecnologias: 'vue' }],
        ['ids con forma inválida', { tecnologias: ['Vue'] }],
        ['ids con símbolos', { tecnologias: ['<script>'] }],
        ['repetidas', { tecnologias: ['vue', 'vue'] }],
        ['demasiadas', { tecnologias: Array.from({ length: MAXIMO_TECNOLOGIAS + 1 }, (_, i) => `t${i}`) }],
    ])('rechaza con 422 VALIDATION_ERROR (%s) sin tocar la BD', async (_caso, cuerpo) => {
        const r = await guardar(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('un código mal formado responde 422 INVALID_CODE y exige el token del evento', async () => {
        const mal = await guardar({ tecnologias: ['vue'] }, 'abc')
        expect(mal.status).toBe(422)
        expect(mal.body.code).toBe('INVALID_CODE')
        const sinToken = await request(app).post(`/api/v1/site/credential/${CODIGO}/technologies`).send({ tecnologias: ['vue'] })
        expect(sinToken.status).toBe(401)
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })
})

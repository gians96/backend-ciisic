import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { limiteVerificacionCertificado, topeDeFallos } from '../../src/middlewares/rate-limit'
import { verificarCertificado } from '../../src/api/certificate/services/verificacion'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        certificado: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as { certificado: { findUnique: jest.Mock } }

const CODIGO = 'CIISIC-2026-000123-7KQ2XM'
const evento = { nombre: 'VIII Congreso Internacional de Ingeniería de Sistemas', fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z') }
const fila = (cambios: Record<string, unknown> = {}) => ({
    codigo: CODIGO,
    estado: 'FIRMADO',
    nombreImpreso: 'ANA MARÍA PÉREZ QUISPE',
    fechaEmision: new Date('2026-10-31T00:00:00Z'),
    horas: 40,
    firmadoEn: new Date('2026-11-03T15:20:00Z'),
    anuladoEn: null,
    tipo: { nombre: 'Participante' },
    evento,
    ...cambios,
})
const verificar = (codigo: string) => request(app).get(`/api/v1/public/certificates/${encodeURIComponent(codigo)}`)

beforeEach(() => {
    jest.clearAllMocks()
    m.certificado.findUnique.mockResolvedValue(fila())
})

describe('GET /v1/public/certificates/:codigo', () => {
    it('es pública: responde un FIRMADO como VALIDO solo con los datos impresos', async () => {
        const r = await verificar(CODIGO)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body).toEqual({
            success: true,
            data: {
                codigo: CODIGO,
                estado: 'VALIDO',
                titular: 'ANA MARÍA PÉREZ QUISPE',
                tipo: 'Participante',
                evento: { nombre: evento.nombre, fechaInicio: '2026-10-26', fechaFin: '2026-10-30' },
                fechaEmision: '2026-10-31',
                horas: 40,
                firmadoEn: '2026-11-03T15:20:00.000Z',
            },
        })
        // Solo pide a la BD lo que publica: nunca el documento, el correo, el motivo ni los archivos
        const { where, select } = m.certificado.findUnique.mock.calls[0][0]
        expect(where).toEqual({ codigo: CODIGO })
        expect(Object.keys(select).sort()).toEqual(['anuladoEn', 'codigo', 'estado', 'evento', 'fechaEmision', 'firmadoEn', 'horas', 'nombreImpreso', 'tipo'])
        expect(JSON.stringify(r.body)).not.toMatch(/documento|correo|archivo|motivo/i)
    })

    it('normaliza lo escrito (minúsculas, espacios, O→0 e I/L→1) antes de buscar', async () => {
        await verificar('  ciisic-2026-000123-7kq2xm ')
        expect(m.certificado.findUnique.mock.calls[0][0].where).toEqual({ codigo: CODIGO })
        m.certificado.findUnique.mockClear()
        await verificar('CIISIC-2026-000123-OKQIXL')
        expect(m.certificado.findUnique.mock.calls[0][0].where).toEqual({ codigo: 'CIISIC-2026-000123-0KQ1X1' })
    })

    it('un ANULADO responde ANULADO con la fecha, sin el motivo', async () => {
        const anuladoEn = new Date('2026-11-10T12:00:00Z')
        m.certificado.findUnique.mockResolvedValue(fila({ estado: 'ANULADO', anuladoEn }))
        const r = await verificar(CODIGO)
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ codigo: CODIGO, estado: 'ANULADO', anuladoEn: anuladoEn.toISOString(), titular: 'ANA MARÍA PÉREZ QUISPE' })
        expect(r.body.data).not.toHaveProperty('motivoAnulacion')
    })

    it.each(['PENDIENTE', 'PREPARADO', 'EN_FIRMA'])('un certificado %s responde 404 igual que uno inexistente', async (estado) => {
        m.certificado.findUnique.mockResolvedValue(fila({ estado }))
        const r = await verificar(CODIGO)
        m.certificado.findUnique.mockResolvedValue(null)
        const inexistente = await verificar(CODIGO)
        expect(r.status).toBe(404)
        expect(r.body).toEqual(inexistente.body)
        expect(r.body).toMatchObject({ success: false, code: 'CERTIFICATE_NOT_FOUND' })
    })

    it.each([
        'no-es-un-codigo',
        'CIISIC-2026-000123',
        'CIISIC-26-000123-7KQ2XM',
        'CIISIC-2026-000123-7KQ2XU',
        'C-2026-000123-7KQ2XM',
        `${'A'.repeat(21)}-2026-000123-7KQ2XM`,
        `${CODIGO}' OR '1'='1`,
        'x'.repeat(200),
    ])('un código con otro formato (%s) responde 404 sin consultar la BD', async (codigo) => {
        const r = await verificar(codigo)
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('CERTIFICATE_NOT_FOUND')
        expect(m.certificado.findUnique).not.toHaveBeenCalled()
    })

    it('no abre otras rutas bajo /v1/public', async () => {
        const r = await request(app).get('/api/v1/public/certificates')
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('NOT_FOUND')
        expect(m.certificado.findUnique).not.toHaveBeenCalled()
    })
})

describe('límites de la verificación', () => {
    it('el tope global solo cuenta códigos inexistentes: pasado el tope, esos responden 429 y los reales siguen respondiendo', async () => {
        let t = 1_000_000
        const tope = topeDeFallos(60_000, 3, () => t)
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        m.certificado.findUnique.mockResolvedValue(null)
        const intentos: unknown[] = []
        for (let i = 0; i < 5; i++) intentos.push(await verificarCertificado(CODIGO, tope).catch((e: { status: number }) => e.status))
        expect(intentos).toEqual([404, 404, 404, 429, 429])
        // Un FIRMADO real responde aunque el tope esté agotado
        m.certificado.findUnique.mockResolvedValue(fila())
        expect(await verificarCertificado(CODIGO, tope)).toMatchObject({ estado: 'VALIDO' })
        // Un formato inválido no consulta la BD ni cuenta
        await expect(verificarCertificado('basura', tope)).rejects.toMatchObject({ status: 404 })
        expect(avisos).toHaveBeenCalledWith('Tope global de verificaciones fallidas alcanzado')
        // La ventana siguiente vuelve a empezar
        t += 60_000
        m.certificado.findUnique.mockResolvedValue(null)
        await expect(verificarCertificado(CODIGO, tope)).rejects.toMatchObject({ status: 404 })
        avisos.mockRestore()
    })

    it('el 429 trae el código estándar y Retry-After', async () => {
        const tope = topeDeFallos(60_000, 0, () => 5_000)
        m.certificado.findUnique.mockResolvedValue(fila({ estado: 'PENDIENTE' }))
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const error = await verificarCertificado(CODIGO, tope).catch((e: unknown) => e)
        expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', reintentarEnSegundos: 60 })
        avisos.mockRestore()
    })

    it('la ruta lleva el límite por IP (el tope global de fallos va en el servicio)', () => {
        const router = require('../../src/api/certificate/routes/public-certificate').default as { stack: { route: { stack: { handle: unknown }[] } }[] }
        expect(router.stack[0].route.stack[0].handle).toBe(limiteVerificacionCertificado)
        expect(router.stack[0].route.stack).toHaveLength(2)
    })
})

import fs from 'fs'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { directorioCertificados } from '../../src/core/almacenamiento'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn() },
        certificado: { findMany: jest.fn(), findFirst: jest.fn() },
    },
}))

const m = prisma as unknown as {
    participante: { findUnique: jest.Mock }
    certificado: { findMany: jest.Mock, findFirst: jest.Mock }
}

const EVENTO = 2
const CODIGO = 'CIISIC-2026-000123-7KQ2XM'
const ARCHIVO = `${CODIGO}-0123456789abcdef.pdf`
const sesion = () => `Bearer ${tokenDeParticipante(50, 'ana@gmail.com')}`
const evento = { codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z') }
const fila = (cambios: Record<string, unknown> = {}) => ({
    id: 7,
    codigo: CODIGO,
    codigoImpreso: CODIGO,
    fechaEmision: new Date('2026-10-31T00:00:00Z'),
    horas: 40,
    detalle: 'Asistió a las cinco jornadas',
    firmadoEn: new Date('2026-11-03T15:20:00Z'),
    urlVerificacion: `https://admin-ciisic.episundc.pe/verificar/${CODIGO}`,
    evento,
    tipo: { codigo: 'PARTICIPANTE', nombre: 'Participante' },
    ...cambios,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue({ correo: 'ana@gmail.com' })
    m.certificado.findMany.mockResolvedValue([])
    m.certificado.findFirst.mockResolvedValue(null)
    fs.rmSync(directorioCertificados(EVENTO, 'firmados'), { recursive: true, force: true })
})

describe('GET /v1/me/certificates', () => {
    it('lista solo los FIRMADOS propios, sin documento ni archivos', async () => {
        m.certificado.findMany.mockResolvedValue([fila(), fila({ id: 8, codigoImpreso: null, horas: null, detalle: null })])
        const r = await request(app).get('/api/v1/me/certificates').set('Authorization', sesion())
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('private, no-store')
        const consulta = m.certificado.findMany.mock.calls[0][0]
        expect(consulta.where).toEqual({ participanteId: 50, estado: 'FIRMADO' })
        expect(Object.keys(consulta.select)).not.toEqual(expect.arrayContaining(['archivoFirmado']))
        expect(r.body.data[0]).toEqual({
            id: 7,
            codigoImpreso: CODIGO,
            evento: { codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', fechaInicio: '2026-10-26', fechaFin: '2026-10-30' },
            tipo: { codigo: 'PARTICIPANTE', nombre: 'Participante' },
            fechaEmision: '2026-10-31',
            horas: 40,
            detalle: 'Asistió a las cinco jornadas',
            firmadoEn: '2026-11-03T15:20:00.000Z',
            urlVerificacion: `https://admin-ciisic.episundc.pe/verificar/${CODIGO}`,
        })
        // Sin código impreso (no debería pasar en un firmado) se muestra el código propio
        expect(r.body.data[1]).toMatchObject({ id: 8, codigoImpreso: CODIGO, horas: null, detalle: null })
        expect(JSON.stringify(r.body)).not.toMatch(/archivo|documento|hash|motivo/i)
    })

    it('sin sesión → 401; con una sesión de staff → 403', async () => {
        expect((await request(app).get('/api/v1/me/certificates')).status).toBe(401)
        const staff = await request(app).get('/api/v1/me/certificates').set('Authorization', `Bearer ${tokenDeRol('SUPERADMIN')}`)
        expect(staff.status).toBe(403)
        expect(m.certificado.findMany).not.toHaveBeenCalled()
    })
})

describe('GET /v1/me/certificates/:id/file', () => {
    function guardarFirmado(contenido = '%PDF-1.7 firmado') {
        const ruta = path.join(directorioCertificados(EVENTO, 'firmados'), ARCHIVO)
        fs.mkdirSync(path.dirname(ruta), { recursive: true })
        fs.writeFileSync(ruta, contenido)
        return ruta
    }

    it('descarga el firmado propio', async () => {
        guardarFirmado()
        m.certificado.findFirst.mockResolvedValue({ eventoId: EVENTO, codigo: CODIGO, codigoImpreso: CODIGO, archivoFirmado: ARCHIVO })
        const r = await request(app).get('/api/v1/me/certificates/7/file').set('Authorization', sesion()).buffer(true)
        expect(r.status).toBe(200)
        expect(m.certificado.findFirst.mock.calls[0][0].where).toEqual({ id: 7, participanteId: 50, estado: 'FIRMADO' })
        expect(r.headers['content-type']).toBe('application/pdf')
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.headers['content-disposition']).toBe(`attachment; filename="certificado-${CODIGO}.pdf"`)
        expect(Buffer.from(r.body).toString()).toBe('%PDF-1.7 firmado')
    })

    it('ajeno, no firmado o anulado → 404 (la consulta exige dueño y FIRMADO)', async () => {
        guardarFirmado()
        const r = await request(app).get('/api/v1/me/certificates/9/file').set('Authorization', sesion())
        expect(r.status).toBe(404)
        expect(r.body).toMatchObject({ success: false, code: 'CERTIFICATE_NOT_FOUND' })
        expect(m.certificado.findFirst.mock.calls[0][0].where).toEqual({ id: 9, participanteId: 50, estado: 'FIRMADO' })
    })

    it('sin el archivo en disco o con un nombre que no es del servidor → 404', async () => {
        m.certificado.findFirst.mockResolvedValue({ eventoId: EVENTO, codigo: CODIGO, codigoImpreso: CODIGO, archivoFirmado: ARCHIVO })
        expect((await request(app).get('/api/v1/me/certificates/7/file').set('Authorization', sesion())).status).toBe(404)

        guardarFirmado()
        for (const archivoFirmado of [null, '../../../etc/passwd', `${CODIGO}.pdf`]) {
            m.certificado.findFirst.mockResolvedValueOnce({ eventoId: EVENTO, codigo: CODIGO, codigoImpreso: CODIGO, archivoFirmado })
            const r = await request(app).get('/api/v1/me/certificates/7/file').set('Authorization', sesion())
            expect({ archivoFirmado, status: r.status }).toEqual({ archivoFirmado, status: 404 })
        }
    })

    it('el nombre de descarga solo lleva caracteres seguros del código impreso', async () => {
        guardarFirmado()
        m.certificado.findFirst.mockResolvedValue({ eventoId: EVENTO, codigo: CODIGO, codigoImpreso: 'UNDC/2026 "001"', archivoFirmado: ARCHIVO })
        const r = await request(app).get('/api/v1/me/certificates/7/file').set('Authorization', sesion())
        expect(r.headers['content-disposition']).toBe('attachment; filename="certificado-UNDC_2026_001_.pdf"')
    })

    it('id inválido → 400 sin consultar; staff → 403', async () => {
        const invalido = await request(app).get('/api/v1/me/certificates/abc/file').set('Authorization', sesion())
        expect(invalido.status).toBe(400)
        const staff = await request(app).get('/api/v1/me/certificates/7/file').set('Authorization', `Bearer ${tokenDeRol('SUPERADMIN')}`)
        expect(staff.status).toBe(403)
        expect(m.certificado.findFirst).not.toHaveBeenCalled()
    })
})

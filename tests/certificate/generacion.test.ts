import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { PDFDocument } from 'pdf-lib'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { DIRECTORIO_PLANTILLAS_CERTIFICADO, directorioCertificados, nuevoNombrePlantilla } from '../../src/core/almacenamiento'
import { sha256 } from '../../src/api/certificate/pdf/firmas'
import { camposDe } from '../../src/api/certificate/services/generacion'
import { tokenDeRol } from '../helpers/tokens'
import { disenoDePrueba } from '../helpers/pdf'

/**
 * Generación en tandas (spec 015): síncrona, hasta 10, idempotente y reanudable; congela el código
 * impreso y la URL de verificación; optimista ante otra solicitud; archivos por `eventoId`.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
        certificado: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { evento: { findUnique: Mock }, configuracionSistema: { findUnique: Mock }, certificado: Record<'findMany' | 'updateMany' | 'count', Mock> }

const EVENTO = 2
const OTRO_EVENTO = 3
const URL_PANEL = 'https://admin-ciisic.episundc.pe'

interface Fila {
    id: number
    eventoId: number
    estado: string
    codigo: string
    codigoImpreso: string | null
    codigoExterno: string | null
    urlVerificacion: string | null
    generacion: string | null
    archivoGenerado: string | null
    hashGenerado?: string | null
    bytesGenerado?: number | null
    generadoEn?: Date | null
    plantillaVersion?: number | null
    descargadoParaFirmarEn?: Date | null
    nombreImpreso: string
    tipoDocumento: string
    numeroDocumento: string
    detalle: string | null
    horas: number | null
    fechaEmision: Date
    actualizadoEn: Date
    tipo: { textoImpreso: string }
    plantilla: { id: number, archivoDiseno: string, campos: unknown, version: number } | null
}

let filas: Map<number, Fila>
let archivoDiseno: string
let config: Record<string, unknown>

const CAMPOS = [
    { id: 'nombre', tipo: 'NOMBRE', pagina: 1, x: 120, y: 320, ancho: 600, alineacion: 'CENTRO', tamano: 30, capitalizacion: 'MAYUSCULAS' },
    { id: 'tipo', tipo: 'TIPO', pagina: 1, x: 420, y: 280, alineacion: 'CENTRO' },
    { id: 'codigo', tipo: 'CODIGO', pagina: 1, x: 60, y: 50, tamano: 9 },
    { id: 'qr', tipo: 'QR', pagina: 1, x: 700, y: 40, lado: 90 },
]

function crear(id: number, cambios: Partial<Fila> = {}): Fila {
    const codigo = `CIISIC-2026-${String(id).padStart(6, '0')}-7KQ2X${'ABCDEFGHJK'[id % 10]}`
    const fila: Fila = {
        id, eventoId: EVENTO, estado: 'PENDIENTE', codigo, codigoImpreso: null, codigoExterno: null, urlVerificacion: null, generacion: null,
        archivoGenerado: null, nombreImpreso: 'María José Ñahuinlla Güemes', tipoDocumento: 'dni', numeroDocumento: '12345678', detalle: null,
        horas: 20, fechaEmision: new Date('2026-10-31T00:00:00.000Z'), actualizadoEn: new Date('2026-11-01T10:00:00.000Z'),
        tipo: { textoImpreso: 'PARTICIPANTE' }, plantilla: { id: 4, archivoDiseno, campos: CAMPOS, version: 3 }, ...cambios,
    }
    filas.set(id, fila)
    return fila
}

function cumple(fila: Fila, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([campo, valor]) => {
        const actual = (fila as unknown as Record<string, unknown>)[campo]
        if (valor instanceof Date) return actual instanceof Date && actual.getTime() === valor.getTime()
        if (valor && typeof valor === 'object') {
            const v = valor as { in?: unknown[], gt?: number }
            if (v.in) return v.in.includes(actual)
            if (v.gt !== undefined) return (actual as number) > v.gt
        }
        return actual === valor
    })
}

const generados = (eventoId = EVENTO) => {
    const dir = directorioCertificados(eventoId, 'generados')
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).sort() : []
}

beforeAll(async () => {
    archivoDiseno = nuevoNombrePlantilla()
    fs.mkdirSync(DIRECTORIO_PLANTILLAS_CERTIFICADO, { recursive: true })
    fs.writeFileSync(path.join(DIRECTORIO_PLANTILLAS_CERTIFICADO, archivoDiseno), await disenoDePrueba())
})

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    filas = new Map()
    fs.rmSync(directorioCertificados(EVENTO, 'generados'), { recursive: true, force: true })
    config = { urlPanel: URL_PANEL, rutasLegacyActivas: true, certificadosProveedor: 'LOCAL', certificadosPrefijo: 'CIISIC', certificadosProveedorConfirmado: true }
    m.configuracionSistema.findUnique.mockImplementation(async () => config)
    m.evento.findUnique.mockImplementation(async ({ where }) => ([EVENTO, OTRO_EVENTO].includes(where.id)
        ? { id: where.id, nombre: 'VIII Congreso Internacional de Ingeniería de Sistemas', nombreCorto: 'VIII CIISIC 2026', codigo: 'ciisic-viii-2026' }
        : null))
    m.certificado.findMany.mockImplementation(async ({ where, take }) => {
        const lista = [...filas.values()].filter((f) => cumple(f, where)).sort((a, b) => a.id - b.id)
        return (take ? lista.slice(0, take) : lista).map((f) => ({ ...f }))
    })
    m.certificado.updateMany.mockImplementation(async ({ where, data }) => {
        const fila = filas.get(where.id)
        if (!fila || !cumple(fila, where)) return { count: 0 }
        Object.assign(fila, data, { actualizadoEn: new Date(fila.actualizadoEn.getTime() + 1000) })
        return { count: 1 }
    })
    m.certificado.count.mockImplementation(async ({ where }) => [...filas.values()].filter((f) => cumple(f, where)).length)
})

const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const generar = (body: Record<string, unknown>, auth = ADMIN(), eventoId = EVENTO) =>
    request(app).post(`/api/v1/events/${eventoId}/certificates/generate`).set('Authorization', auth).send(body)

describe('POST /v1/events/:eventId/certificates/generate', () => {
    it('genera los PENDIENTE: PREPARADO, archivo <código>-<generación>.pdf en la carpeta del evento, Subject e integridad', async () => {
        crear(1)
        crear(2, { detalle: 'Ponencia', horas: null })
        const r = await generar({ ids: [1, 2] })
        expect(r.status).toBe(200)
        expect(r.body.data.procesados.map((p: { id: number, resultado: string }) => [p.id, p.resultado])).toEqual([[1, 'GENERADO'], [2, 'GENERADO']])
        expect(r.body.data.restantes).toBe(0)
        const fila = filas.get(1) as Fila
        expect(fila).toMatchObject({
            estado: 'PREPARADO', codigoImpreso: fila.codigo, urlVerificacion: `${URL_PANEL}/verificar/${fila.codigo}`, plantillaVersion: 3, descargadoParaFirmarEn: null,
        })
        expect(fila.generacion).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
        expect(fila.archivoGenerado).toBe(`${fila.codigo}-${fila.generacion}.pdf`)
        expect(generados()).toEqual([filas.get(1)?.archivoGenerado, filas.get(2)?.archivoGenerado].sort())
        const bytes = fs.readFileSync(path.join(directorioCertificados(EVENTO, 'generados'), fila.archivoGenerado as string))
        expect(sha256(bytes)).toBe(fila.hashGenerado)
        expect(bytes.byteLength).toBe(fila.bytesGenerado)
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
        expect(pdf.getSubject()).toBe(`ciisic:${fila.codigo}:${fila.generacion}`)
        expect(pdf.getTitle()).toBe(`Certificado ${fila.codigo}`)
        // Sin restos de escrituras a medias
        expect(fs.readdirSync(directorioCertificados(EVENTO, 'generados')).filter((f) => !f.endsWith('.pdf'))).toEqual([])
    })

    it('es idempotente: lo que no está PENDIENTE se omite y lo de otro evento se informa como inexistente', async () => {
        crear(1, { estado: 'PREPARADO', generacion: 'AAAAAAAA', archivoGenerado: 'x.pdf' })
        crear(2, { estado: 'FIRMADO' })
        crear(3, { eventoId: OTRO_EVENTO })
        const r = await generar({ ids: [1, 2, 3, 2] })
        expect(r.body.data.procesados).toEqual([
            expect.objectContaining({ id: 1, resultado: 'OMITIDO', estado: 'PREPARADO' }),
            expect.objectContaining({ id: 2, resultado: 'OMITIDO', estado: 'FIRMADO' }),
            expect.objectContaining({ id: 3, resultado: 'ERROR', codigoError: 'CERTIFICATE_NOT_FOUND' }),
        ])
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        expect(generados()).toEqual([])
    })

    it('sin URL del panel → 422 VERIFICATION_URL_NOT_CONFIGURED y nada generado', async () => {
        config.urlPanel = null
        crear(1)
        const r = await generar({ ids: [1] })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VERIFICATION_URL_NOT_CONFIGURED')
        expect(generados()).toEqual([])
        expect(filas.get(1)?.estado).toBe('PENDIENTE')
    })

    it('proveedor UNDC (pendiente) → 501 CERTIFICATE_PROVIDER_PENDING', async () => {
        config.certificadosProveedor = 'UNDC'
        crear(1)
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const r = await generar({ pendientes: true })
        aviso.mockRestore()
        expect(r.status).toBe(501)
        expect(r.body.code).toBe('CERTIFICATE_PROVIDER_PENDING')
        expect(generados()).toEqual([])
    })

    it('regenerar tras una edición conserva la URL y el código impreso congelados y borra el archivo anterior', async () => {
        crear(1)
        await generar({ ids: [1] })
        const primero = { ...(filas.get(1) as Fila) }
        // Edición: vuelve a PENDIENTE (la URL del panel cambió entre tanto)
        Object.assign(filas.get(1) as Fila, { estado: 'PENDIENTE', generacion: null, hashGenerado: null, bytesGenerado: null, nombreImpreso: 'María José Ñahuinlla', actualizadoEn: new Date('2026-11-05T00:00:00Z') })
        config.urlPanel = 'https://otro-panel.example.pe'
        reiniciarCacheConfiguracion()
        const r = await generar({ ids: [1] })
        expect(r.body.data.procesados[0].resultado).toBe('GENERADO')
        const segundo = filas.get(1) as Fila
        expect(segundo.urlVerificacion).toBe(primero.urlVerificacion)
        expect(segundo.codigoImpreso).toBe(primero.codigoImpreso)
        expect(segundo.generacion).not.toBe(primero.generacion)
        expect(generados()).toEqual([segundo.archivoGenerado])
    }, 20_000)

    it('carrera optimista: si otra solicitud cambió la fila, el resultado es OMITIDO y el archivo nuevo se borra', async () => {
        crear(1)
        m.certificado.updateMany.mockResolvedValueOnce({ count: 0 })
        const r = await generar({ ids: [1] })
        expect(r.body.data.procesados[0]).toMatchObject({ resultado: 'OMITIDO', codigoError: 'CERTIFICATE_CHANGED' })
        expect(m.certificado.updateMany.mock.calls[0][0].where).toEqual({ id: 1, estado: 'PENDIENTE', generacion: null, actualizadoEn: new Date('2026-11-01T10:00:00.000Z') })
        expect(generados()).toEqual([])
    })

    it('errores por certificado: sin plantilla o sin el PDF de diseño (los demás se generan)', async () => {
        crear(1, { plantilla: null })
        crear(2, { plantilla: { id: 9, archivoDiseno: nuevoNombrePlantilla(), campos: CAMPOS, version: 1 } })
        crear(3)
        const r = await generar({ ids: [1, 2, 3] })
        expect(r.body.data.procesados.map((p: { resultado: string, codigoError: string | null }) => [p.resultado, p.codigoError]))
            .toEqual([['ERROR', 'TEMPLATE_REQUIRED'], ['ERROR', 'TEMPLATE_FILE_MISSING'], ['GENERADO', null]])
        expect(r.body.data.restantes).toBe(2)
    })

    it('pendientes: tandas de 10 por id con cursor (los que fallan no se repiten en bucle)', async () => {
        for (let id = 1; id <= 12; id++) crear(id, id === 2 ? { plantilla: null } : {})
        const primera = await generar({ pendientes: true })
        expect(primera.body.data.procesados).toHaveLength(10)
        expect(primera.body.data).toMatchObject({ ultimoId: 10, hayMas: true, restantes: 3 })
        const segunda = await generar({ pendientes: true, despuesDeId: 10 })
        expect(segunda.body.data.procesados.map((p: { id: number }) => p.id)).toEqual([11, 12])
        expect(segunda.body.data).toMatchObject({ ultimoId: 12, hayMas: false, restantes: 1 })
        const tercera = await generar({ pendientes: true, despuesDeId: 12 })
        expect(tercera.body.data).toMatchObject({ procesados: [], ultimoId: 12, hayMas: false, restantes: 1 })
    }, 30_000) // genera 11 PDF reales: con la suite completa en paralelo pasaba de los 5 s por defecto

    it('valida la solicitud: hasta 10 ids, ids o pendientes (solo uno)', async () => {
        expect((await generar({ ids: Array.from({ length: 11 }, (_, i) => i + 1) })).status).toBe(422)
        expect((await generar({ ids: [1], pendientes: true })).status).toBe(422)
        expect((await generar({})).status).toBe(422)
        expect(m.certificado.findMany).not.toHaveBeenCalled()
    })

    it('permisos: la Comisión con operar genera en su evento; con ver o en otro evento, 403; el Tesorero, 403', async () => {
        crear(1)
        const operar = `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [EVENTO], permisos: ['certificados.operar'] })}`
        expect((await generar({ ids: [1] }, operar)).status).toBe(200)
        const otro = await generar({ ids: [1] }, operar, OTRO_EVENTO)
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        const ver = `Bearer ${tokenDeRol('COMISION', 41, { eventoIds: [EVENTO], permisos: ['certificados.ver'] })}`
        expect((await generar({ ids: [1] }, ver)).status).toBe(403)
        expect((await generar({ ids: [1] }, `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [EVENTO] })}`)).status).toBe(403)
    })
})

describe('camposDe', () => {
    it('descarta lo que no tiene la forma mínima de un campo', () => {
        expect(camposDe(null)).toEqual([])
        expect(camposDe({ tipo: 'NOMBRE' })).toEqual([])
        expect(camposDe([{ tipo: 'NOMBRE', pagina: 1, x: 1, y: 2 }, { tipo: 'OTRO', pagina: 1, x: 1, y: 2 }, { tipo: 'QR', pagina: '1', x: 1, y: 2 }, 'x']))
            .toEqual([{ tipo: 'NOMBRE', pagina: 1, x: 1, y: 2 }])
    })
})

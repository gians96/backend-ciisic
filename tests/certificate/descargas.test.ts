import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { directorioCertificados } from '../../src/core/almacenamiento'
import { leerOpcionesZip, prepararZip } from '../../src/api/certificate/services/descargas'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Descargas de certificados (spec 015): individual (para firmar o firmado) y ZIP en flujo con
 * `manifiesto.csv`. Para firmar exige `certificados.operar` y el proveedor del código confirmado.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
        certificado: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { evento: { findUnique: Mock }, configuracionSistema: { findUnique: Mock }, certificado: Record<'findUnique' | 'findMany' | 'count' | 'updateMany', Mock> }

const EVENTO = 2
const OTRO_EVENTO = 3

interface Fila {
    id: number
    eventoId: number
    numero: number
    estado: string
    codigo: string
    codigoImpreso: string | null
    archivoGenerado: string | null
    archivoFirmado: string | null
    descargadoParaFirmarEn: Date | null
    nombreImpreso: string
    tipoDocumento: string
    numeroDocumento: string
    detalle: string | null
    horas: number | null
    fechaEmision: Date
    firmasDetectadas: number
    tipo: { codigo: string }
    plantilla: { nombre: string, firmasRequeridas: number } | null
}

let filas: Map<number, Fila>
let confirmado: boolean

const codigoDe = (id: number) => `CIISIC-2026-${String(id).padStart(6, '0')}-7KQ2X${'ABCDEFGHJK'[id % 10]}`

/** Crea la fila y sus archivos en disco: el generado si se generó y el firmado si tiene firmas. */
function crear(id: number, estado: string, cambios: Partial<Fila> = {}, opciones: { enDisco?: boolean } = {}): Fila {
    const codigo = codigoDe(id)
    const generado = estado !== 'PENDIENTE' ? `${codigo}-GENERAC${id % 10}.pdf` : null
    const firmado = estado === 'EN_FIRMA' || estado === 'FIRMADO' ? `${codigo}-${String(id).padStart(16, '0')}.pdf` : null
    const fila: Fila = {
        id, eventoId: EVENTO, numero: id, estado, codigo, codigoImpreso: codigo, archivoGenerado: generado, archivoFirmado: firmado,
        descargadoParaFirmarEn: null, nombreImpreso: `Persona ${id}`, tipoDocumento: 'dni', numeroDocumento: `1234${String(id).padStart(4, '0')}`,
        detalle: null, horas: 20, fechaEmision: new Date('2026-10-31T00:00:00.000Z'), firmasDetectadas: firmado ? 1 : 0,
        tipo: { codigo: 'PARTICIPANTE' }, plantilla: { nombre: 'Diseño general', firmasRequeridas: estado === 'EN_FIRMA' ? 2 : 1 }, ...cambios,
    }
    filas.set(id, fila)
    if (opciones.enDisco ?? true) {
        if (fila.archivoGenerado) escribir(fila.eventoId, 'generados', fila.archivoGenerado, `%PDF generado ${id}`)
        if (fila.archivoFirmado) escribir(fila.eventoId, 'firmados', fila.archivoFirmado, `%PDF firmado ${id}`)
    }
    return fila
}

function escribir(eventoId: number, carpeta: 'generados' | 'firmados', nombre: string, contenido: string) {
    const dir = directorioCertificados(eventoId, carpeta)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, nombre), contenido)
}

function cumple(fila: Fila, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([campo, valor]) => {
        if (campo === 'tipo') return fila.tipo.codigo === (valor as { codigo: string }).codigo
        const actual = (fila as unknown as Record<string, unknown>)[campo]
        if (valor && typeof valor === 'object' && 'in' in valor) return (valor as { in: unknown[] }).in.includes(actual)
        if (valor && typeof valor === 'object' && 'gt' in valor) return (actual as number) > (valor as { gt: number }).gt
        return actual === valor
    })
}

/** Lector mínimo de ZIP (directorio central; sin compresión o deflate). */
function leerZip(zip: Buffer): Map<string, Buffer> {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const total = zip.readUInt16LE(eocd + 10)
    let p = zip.readUInt32LE(eocd + 16)
    const entradas = new Map<string, Buffer>()
    for (let i = 0; i < total; i++) {
        const metodo = zip.readUInt16LE(p + 10)
        const comprimido = zip.readUInt32LE(p + 20)
        const [n, e, c] = [zip.readUInt16LE(p + 28), zip.readUInt16LE(p + 30), zip.readUInt16LE(p + 32)]
        const local = zip.readUInt32LE(p + 42)
        const nombre = zip.toString('utf8', p + 46, p + 46 + n)
        const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
        const datos = zip.subarray(inicio, inicio + comprimido)
        entradas.set(nombre, metodo === 8 ? zlib.inflateRawSync(datos) : Buffer.from(datos))
        p += 46 + n + e + c
    }
    return entradas
}

const binario = ((res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void) => {
    const partes: Buffer[] = []
    res.on('data', (parte: Buffer) => partes.push(Buffer.from(parte)))
    res.on('end', () => callback(null, Buffer.concat(partes)))
}) as unknown as Parameters<request.Test['parse']>[0]

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    filas = new Map()
    confirmado = true
    for (const eventoId of [EVENTO, OTRO_EVENTO]) {
        for (const carpeta of ['generados', 'firmados'] as const) fs.rmSync(directorioCertificados(eventoId, carpeta), { recursive: true, force: true })
    }
    m.configuracionSistema.findUnique.mockImplementation(async () => ({ urlPanel: 'https://admin.example.pe', rutasLegacyActivas: true, certificadosProveedor: 'LOCAL', certificadosPrefijo: 'CIISIC', certificadosProveedorConfirmado: confirmado }))
    m.evento.findUnique.mockImplementation(async ({ where }) => ([EVENTO, OTRO_EVENTO].includes(where.id) ? { id: where.id, codigo: 'ciisic-viii-2026' } : null))
    m.certificado.findUnique.mockImplementation(async ({ where }) => {
        const fila = filas.get(where.id)
        return fila ? { ...fila } : null
    })
    m.certificado.count.mockImplementation(async ({ where }) => [...filas.values()].filter((f) => cumple(f, where)).length)
    m.certificado.findMany.mockImplementation(async ({ where, skip, take }) => [...filas.values()]
        .filter((f) => cumple(f, where)).sort((a, b) => a.numero - b.numero).slice(skip ?? 0, (skip ?? 0) + (take ?? Infinity)).map((f) => ({ ...f })))
    m.certificado.updateMany.mockImplementation(async ({ where, data }) => {
        let count = 0
        for (const fila of filas.values()) {
            const ids = where.id?.in ?? [where.id]
            if (ids.includes(fila.id) && fila.descargadoParaFirmarEn === where.descargadoParaFirmarEn) {
                Object.assign(fila, data)
                count++
            }
        }
        return { count }
    })
})

const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const COMISION = (permisos: string[], id = 40) => `Bearer ${tokenDeRol('COMISION', id, { eventoIds: [EVENTO], permisos })}`
const OPERAR = () => COMISION(['certificados.operar'])
const VER = () => COMISION(['certificados.ver'], 41)

const archivo = (id: number, version: string, auth = ADMIN()) =>
    request(app).get(`/api/v1/certificates/${id}/file?version=${version}`).set('Authorization', auth).buffer(true).parse(binario)
const zip = (query: string, auth = OPERAR(), eventoId = EVENTO) =>
    request(app).get(`/api/v1/events/${eventoId}/certificates/zip?${query}`).set('Authorization', auth).buffer(true).parse(binario)
const json = (r: request.Response) => JSON.parse(Buffer.from(r.body as Buffer).toString('utf8'))

// ─── Individual ──────────────────────────────────────────────────────────────

describe('GET /v1/certificates/:id/file', () => {
    it('generado: entrega el PDF como <código>.pdf y marca la primera descarga para firmar', async () => {
        crear(1, 'PREPARADO')
        const r = await archivo(1, 'generado', OPERAR())
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('application/pdf')
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.headers['content-disposition']).toBe(`attachment; filename="${codigoDe(1)}.pdf"`)
        expect(Buffer.from(r.body).toString()).toBe('%PDF generado 1')
        expect(m.certificado.updateMany).toHaveBeenCalledWith({ where: { id: 1, descargadoParaFirmarEn: null }, data: { descargadoParaFirmarEn: expect.any(Date) } })
        expect(filas.get(1)?.descargadoParaFirmarEn).toBeInstanceOf(Date)
    })

    it('generado sin el proveedor confirmado → 409 PROVIDER_NOT_CONFIRMED (y no se marca)', async () => {
        confirmado = false
        crear(1, 'PREPARADO')
        const r = await archivo(1, 'generado')
        expect(r.status).toBe(409)
        expect(json(r).code).toBe('PROVIDER_NOT_CONFIRMED')
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })

    it('generado exige certificados.operar: con solo «ver» → 403', async () => {
        crear(1, 'PREPARADO')
        const r = await archivo(1, 'generado', VER())
        expect(r.status).toBe(403)
        expect(json(r).code).toBe('FORBIDDEN')
        // Solo la guarda leyó el evento del certificado: el archivo ni se buscó
        expect(m.certificado.findUnique).toHaveBeenCalledTimes(1)
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })

    it('EN_FIRMA: para firmar se entrega el firmado parcial (el siguiente firmante firma sobre él)', async () => {
        crear(2, 'EN_FIRMA')
        const r = await archivo(2, 'generado')
        expect(Buffer.from(r.body).toString()).toBe('%PDF firmado 2')
    })

    it.each([
        ['PENDIENTE', 'generado'], ['FIRMADO', 'generado'], ['ANULADO', 'generado'], ['PREPARADO', 'firmado'], ['EN_FIRMA', 'firmado'],
    ])('%s con version=%s → 404 CERTIFICATE_FILE_NOT_FOUND', async (estado, version) => {
        crear(3, estado)
        const r = await archivo(3, version)
        expect(r.status).toBe(404)
        expect(json(r).code).toBe('CERTIFICATE_FILE_NOT_FOUND')
    })

    it('firmado: basta «ver» y no depende del proveedor; el archivo que falta en disco → 404', async () => {
        confirmado = false
        crear(4, 'FIRMADO')
        const r = await archivo(4, 'firmado', VER())
        expect(r.status).toBe(200)
        expect(Buffer.from(r.body).toString()).toBe('%PDF firmado 4')
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        crear(5, 'FIRMADO', {}, { enDisco: false })
        expect((await archivo(5, 'firmado')).status).toBe(404)
    })

    it('otro evento → 403 EVENT_NOT_ASSIGNED; versión desconocida → 422', async () => {
        crear(6, 'FIRMADO', { eventoId: OTRO_EVENTO })
        const r = await archivo(6, 'firmado', VER())
        expect(r.status).toBe(403)
        expect(json(r).code).toBe('EVENT_NOT_ASSIGNED')
        crear(7, 'FIRMADO')
        expect((await archivo(7, 'original')).status).toBe(422)
    })
})

// ─── ZIP ─────────────────────────────────────────────────────────────────────

describe('GET /v1/events/:eventId/certificates/zip', () => {
    it('para-firmar: <código>.pdf de PREPARADO y EN_FIRMA + manifiesto.csv sin documento para la Comisión; marca la descarga', async () => {
        crear(1, 'PREPARADO', { nombreImpreso: '=HYPERLINK("http://x")' })
        crear(2, 'EN_FIRMA')
        crear(3, 'PENDIENTE')
        crear(4, 'FIRMADO')
        const r = await zip('version=para-firmar')
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('application/zip')
        expect(r.headers['content-disposition']).toBe('attachment; filename="certificados-ciisic-viii-2026-para-firmar.zip"')
        expect(r.headers['x-zip-total']).toBe('2')
        const entradas = leerZip(r.body)
        expect([...entradas.keys()].sort()).toEqual([`${codigoDe(1)}.pdf`, `${codigoDe(2)}.pdf`, 'manifiesto.csv'])
        expect(entradas.get(`${codigoDe(1)}.pdf`)?.toString()).toBe('%PDF generado 1')
        expect(entradas.get(`${codigoDe(2)}.pdf`)?.toString()).toBe('%PDF firmado 2')
        const manifiesto = (entradas.get('manifiesto.csv') as Buffer).toString('utf8')
        expect(manifiesto.startsWith('﻿Archivo;Código;')).toBe(true)
        expect(manifiesto).not.toContain('documento')
        expect(manifiesto).not.toContain('12340001')
        // Contra inyección de fórmulas
        expect(manifiesto).toContain('"\'=HYPERLINK(""http://x"")"')
        expect(filas.get(1)?.descargadoParaFirmarEn).toBeInstanceOf(Date)
        expect(filas.get(2)?.descargadoParaFirmarEn).toBeInstanceOf(Date)
        expect(filas.get(3)?.descargadoParaFirmarEn).toBeNull()
    })

    it('con certificados.gestionar el manifiesto lleva el documento', async () => {
        crear(1, 'PREPARADO')
        const r = await zip('version=para-firmar', ADMIN())
        const manifiesto = (leerZip(r.body).get('manifiesto.csv') as Buffer).toString('utf8')
        expect(manifiesto).toContain('N° documento')
        expect(manifiesto).toContain('12340001')
    })

    it('para-firmar sin el proveedor confirmado → 409 PROVIDER_NOT_CONFIRMED', async () => {
        confirmado = false
        crear(1, 'PREPARADO')
        const r = await zip('version=para-firmar')
        expect(r.status).toBe(409)
        expect(json(r).code).toBe('PROVIDER_NOT_CONFIRMED')
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })

    it('firmados: solo FIRMADO (sin marcar nada) y sin depender del proveedor', async () => {
        confirmado = false
        crear(1, 'PREPARADO')
        crear(2, 'EN_FIRMA')
        crear(3, 'FIRMADO')
        const r = await zip('version=firmados')
        expect(r.status).toBe(200)
        expect([...leerZip(r.body).keys()].sort()).toEqual([`${codigoDe(3)}.pdf`, 'manifiesto.csv'])
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })

    it('por partes con cursor (despuesDe = último número): no se salta ninguno aunque otros cambien entre partes', async () => {
        for (const id of [1, 2, 3, 4, 5]) crear(id, 'PREPARADO')
        const p1 = await zip('version=para-firmar&porParte=2')
        expect(p1.status).toBe(200)
        expect(p1.headers['content-disposition']).toBe('attachment; filename="certificados-ciisic-viii-2026-para-firmar-1-a-2.zip"')
        const cabeceras = (r: request.Response) => ['total', 'certificados', 'archivos', 'desde', 'hasta', 'restantes', 'siguiente', 'hay-mas'].map((k) => r.headers[`x-zip-${k}`])
        expect(cabeceras(p1)).toEqual(['5', '2', '2', '1', '2', '3', '2', 'true'])
        expect([...leerZip(p1.body).keys()].sort()).toEqual([`${codigoDe(1)}.pdf`, `${codigoDe(2)}.pdf`, 'manifiesto.csv'])

        // Entre la parte 1 y la 2 se firman los de la parte 1 (salen del filtro): con skip se saltaban el 3 y el 4
        ;(filas.get(1) as Fila).estado = 'FIRMADO'
        ;(filas.get(2) as Fila).estado = 'FIRMADO'
        const p2 = await zip(`version=para-firmar&porParte=2&despuesDe=${p1.headers['x-zip-siguiente']}`)
        expect([...leerZip(p2.body).keys()].sort()).toEqual([`${codigoDe(3)}.pdf`, `${codigoDe(4)}.pdf`, 'manifiesto.csv'])
        expect(cabeceras(p2)).toEqual(['3', '2', '2', '3', '4', '1', '4', 'true'])
        const p3 = await zip(`version=para-firmar&porParte=2&despuesDe=${p2.headers['x-zip-siguiente']}`)
        expect([...leerZip(p3.body).keys()].sort()).toEqual([`${codigoDe(5)}.pdf`, 'manifiesto.csv'])
        expect(cabeceras(p3)).toEqual(['3', '1', '1', '5', '5', '0', '', 'false'])
        const fuera = await zip('version=para-firmar&porParte=2&despuesDe=5')
        expect(fuera.status).toBe(422)
        expect(json(fuera).code).toBe('NOTHING_TO_DOWNLOAD')
    })

    it('filtra por tipo e ids; el archivo que falta en disco se señala en el manifiesto y no va en el ZIP', async () => {
        crear(1, 'FIRMADO')
        crear(2, 'FIRMADO', {}, { enDisco: false })
        crear(3, 'FIRMADO', { tipo: { codigo: 'PONENTE' } })
        const r = await zip('version=firmados&tipo=participante&ids=1,2,3')
        expect(m.certificado.findMany.mock.calls[0][0].where).toEqual({ eventoId: EVENTO, estado: { in: ['FIRMADO'] }, tipo: { codigo: 'PARTICIPANTE' }, id: { in: [1, 2, 3] }, numero: { gt: 0 } })
        const entradas = leerZip(r.body)
        expect([...entradas.keys()].sort()).toEqual([`${codigoDe(1)}.pdf`, 'manifiesto.csv'])
        const lineas = (entradas.get('manifiesto.csv') as Buffer).toString('utf8').trim().split('\r\n')
        expect(lineas).toHaveLength(3)
        expect(lineas[2]).toMatch(/^;CIISIC-2026-000002-.*El archivo no está en el servidor/)
    })

    it('sin nada que descargar → 422 NOTHING_TO_DOWNLOAD; consulta inválida → 422 VALIDATION_ERROR', async () => {
        crear(1, 'PENDIENTE')
        const nada = await zip('version=para-firmar')
        expect(nada.status).toBe(422)
        expect(json(nada).code).toBe('NOTHING_TO_DOWNLOAD')
        for (const [query, campo] of [['version=todo', 'version'], ['version=firmados&porParte=501', 'porParte'], ['version=firmados&despuesDe=-1', 'despuesDe'], ['version=para-firmar&estado=FIRMADO', 'estado'], ['version=firmados&ids=1,x', 'ids']]) {
            const r = await zip(query)
            expect(r.status).toBe(422)
            expect(json(r).fields).toHaveProperty(campo)
        }
    })

    it('un archivo que otra petición borra a mitad del ZIP corta el flujo con error (sin tumbar el proceso)', async () => {
        crear(1, 'FIRMADO')
        const preparado = await prepararZip(EVENTO, leerOpcionesZip({ version: 'firmados' }), false)
        fs.rmSync(path.join(directorioCertificados(EVENTO, 'firmados'), filas.get(1)?.archivoFirmado as string))
        const leer = new Promise<void>((resolve, reject) => {
            preparado.salida.on('data', () => undefined)
            preparado.salida.on('end', () => resolve())
            preparado.salida.on('error', reject)
        })
        await expect(leer).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('exige certificados.operar en el evento: «ver» → 403; otro evento → 403 EVENT_NOT_ASSIGNED', async () => {
        crear(1, 'FIRMADO')
        expect((await zip('version=firmados', VER())).status).toBe(403)
        const otro = await zip('version=firmados', OPERAR(), OTRO_EVENTO)
        expect(otro.status).toBe(403)
        expect(json(otro).code).toBe('EVENT_NOT_ASSIGNED')
    })
})

import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { PDFDocument, PDFName } from 'pdf-lib'
import type { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { directorioCertificados, directorioFirmadosReemplazados } from '../../src/core/almacenamiento'
import { limitarConcurrencia } from '../../src/core/concurrencia'
import { HttpError } from '../../src/core/http-error'
import { sha256 } from '../../src/api/certificate/pdf/firmas'
import { subjectDeCertificado } from '../../src/api/certificate/pdf/tipos'
import { crearTurnoCargaFirmados, limiteContenido } from '../../src/api/certificate/upload-firmados'
import { tokenDeRol } from '../helpers/tokens'
import { agregarObjetos, disenoDePrueba, firmarPdf, reescribir } from '../helpers/pdf'
import { nuevoFirmante } from '../helpers/firma'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        certificado: { findUnique: jest.fn(), updateMany: jest.fn() },
        evento: { findUnique: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as {
    certificado: { findUnique: jest.Mock, updateMany: jest.Mock }
    evento: { findUnique: jest.Mock }
    configuracionSistema: { findUnique: jest.Mock }
}

// ─── Certificados simulados (en memoria, con el `updateMany` condicionado real) ──

interface Fila {
    id: number
    eventoId: number
    codigo: string
    codigoExterno: string | null
    estado: string
    generacion: string | null
    hashGenerado: string | null
    bytesGenerado: number | null
    archivoGenerado: string | null
    archivoFirmado: string | null
    hashFirmado: string | null
    bytesFirmado: number | null
    firmantes: unknown
    firmasDetectadas: number
    coincidencia: string | null
    motivoForzado: string | null
    firmadoEn: Date | null
    firmadoCargadoPorId: number | null
    claveVigente: string | null
    anuladoEn: Date | null
    motivoAnulacion: string | null
    anuladoPorId: number | null
    editadoPorId: number | null
    plantilla: { firmasRequeridas: number } | null
}

const filas = new Map<number, Fila>()
/** PDF generado vigente de cada certificado. */
const generados = new Map<number, Uint8Array>()

const EVENTO = 2
const C = {
    1: 'CIISIC-2026-000001-7KQ2XM',
    2: 'CIISIC-2026-000002-9ZZ3PQ',
    3: 'CIISIC-2026-000003-AB12CD',
    4: 'CIISIC-2026-000004-EF34GH',
    5: 'CIISIC-2026-000005-JK56MN',
    6: 'CIISIC-2026-000006-PQ78RS',
    7: 'CIISIC-2026-000007-TV90WX',
    8: 'CIISIC-2026-000008-YZ12AB',
} as const

async function pdfGenerado(codigo: string, generacion: string): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await disenoDePrueba(), { updateMetadata: false })
    doc.setSubject(subjectDeCertificado(codigo, generacion))
    doc.setTitle(`Certificado ${codigo}`)
    return doc.save({ useObjectStreams: false })
}

async function crear(id: keyof typeof C, cambios: Partial<Fila> = {}, opciones: { generar?: boolean } = {}): Promise<Fila> {
    const codigo = C[id]
    const generacion = `GEN0000${id}`
    const generar = opciones.generar ?? true
    const bytes = generar ? await pdfGenerado(codigo, generacion) : null
    if (bytes) generados.set(id, bytes)
    const fila: Fila = {
        id, eventoId: EVENTO, codigo, codigoExterno: null, estado: generar ? 'PREPARADO' : 'PENDIENTE',
        generacion: generar ? generacion : null, hashGenerado: bytes ? sha256(bytes) : null, bytesGenerado: bytes?.byteLength ?? null,
        archivoGenerado: generar ? `${codigo}-${generacion}.pdf` : null, archivoFirmado: null, hashFirmado: null, bytesFirmado: null, firmantes: null, firmasDetectadas: 0,
        coincidencia: null, motivoForzado: null, firmadoEn: null, firmadoCargadoPorId: null, claveVigente: `${EVENTO}:${id}:1:-`,
        anuladoEn: null, motivoAnulacion: null, anuladoPorId: null, editadoPorId: null, plantilla: { firmasRequeridas: 1 }, ...cambios,
    }
    filas.set(id, fila)
    return fila
}

/** Deja el certificado FIRMADO (o EN_FIRMA) con un archivo real en disco. */
async function yaFirmado(id: keyof typeof C, firmado: Uint8Array, firmas = 1, estado = 'FIRMADO'): Promise<string> {
    const archivo = `${C[id]}-${'a'.repeat(16)}.pdf`
    const ruta = path.join(directorioCertificados(EVENTO, 'firmados'), archivo)
    fs.mkdirSync(path.dirname(ruta), { recursive: true })
    fs.writeFileSync(ruta, firmado)
    Object.assign(filas.get(id) as Fila, {
        estado, archivoFirmado: archivo, hashFirmado: sha256(firmado), bytesFirmado: firmado.byteLength, firmasDetectadas: firmas, coincidencia: 'PREFIJO',
        firmadoEn: estado === 'FIRMADO' ? new Date() : null,
    })
    return ruta
}

/** Ruta del firmado anterior ya archivado (`firmados/reemplazados/`). */
const archivado = (ruta: string) => path.join(directorioFirmadosReemplazados(EVENTO), path.basename(ruta))

function cumple(fila: Fila, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([campo, valor]) => {
        const actual = (fila as unknown as Record<string, unknown>)[campo]
        if (valor && typeof valor === 'object' && 'not' in valor) return actual !== (valor as { not: unknown }).not
        return actual === valor
    })
}

beforeEach(() => {
    jest.clearAllMocks()
    filas.clear()
    generados.clear()
    fs.rmSync(path.join(directorioCertificados(EVENTO, 'firmados')), { recursive: true, force: true })
    m.evento.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => (where.id === EVENTO || where.id === 3 ? { id: where.id } : null))
    m.configuracionSistema.findUnique.mockResolvedValue(null)
    m.certificado.findUnique.mockImplementation(async ({ where }: { where: { id?: number, codigo?: string, codigoExterno?: string } }) => {
        const fila = [...filas.values()].find((f) => (where.id !== undefined ? f.id === where.id : where.codigo !== undefined ? f.codigo === where.codigo : f.codigoExterno === where.codigoExterno))
        return fila ? { ...fila } : null
    })
    m.certificado.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>, data: Partial<Fila> }) => {
        const fila = filas.get(where.id as number)
        if (!fila || !cumple(fila, where)) return { count: 0 }
        Object.assign(fila, data)
        return { count: 1 }
    })
})

const firmados = () => {
    const dir = directorioCertificados(EVENTO, 'firmados')
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort() : []
}
const reemplazados = () => {
    const dir = directorioFirmadosReemplazados(EVENTO)
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}
const comision = (permisos = ['certificados.operar'], eventoIds = [EVENTO]) => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds, permisos })}`
const admin = () => `Bearer ${tokenDeRol('ADMIN')}`
const subir = (auth: string, archivos: [Uint8Array | Buffer, string, string?][], campos: Record<string, string> = {}, eventoId = EVENTO) => {
    let r = request(app).post(`/api/v1/events/${eventoId}/certificates/signed`).set('Authorization', auth)
    for (const [k, v] of Object.entries(campos)) r = r.field(k, v)
    for (const [bytes, nombre, tipo] of archivos) r = r.attach('files', Buffer.from(bytes), { filename: nombre, contentType: tipo ?? 'application/pdf' })
    return r
}
const reemplazar = (auth: string, id: number, bytes: Uint8Array | Buffer, campos: Record<string, string> = {}, nombre = 'firmado.pdf', tipo = 'application/pdf') => {
    let r = request(app).put(`/api/v1/certificates/${id}/signed`).set('Authorization', auth)
    for (const [k, v] of Object.entries(campos)) r = r.field(k, v)
    return r.attach('file', Buffer.from(bytes), { filename: nombre, contentType: tipo })
}

describe('carga de firmados por tandas', () => {
    it('empareja por el código del nombre y reporta cada archivo sin cortar la tanda', async () => {
        await crear(1)
        await crear(2)
        await crear(3)
        await crear(4, { eventoId: 3 })
        await crear(5, { estado: 'ANULADO', claveVigente: null })
        await crear(6)
        await yaFirmado(6, await firmarPdf(generados.get(6) as Uint8Array))
        const firmado1 = await firmarPdf(generados.get(1) as Uint8Array)

        const r = await subir(comision(), [
            [firmado1, `${C[1]}_firmado.pdf`],
            [generados.get(2) as Uint8Array, `${C[2]} [R].pdf`],
            [await firmarPdf(generados.get(3) as Uint8Array), `cert_${C[2].toLowerCase()}-signed.pdf`, 'application/octet-stream'],
            [await firmarPdf(await disenoDePrueba()), 'CIISIC-2026-000099-ZZZZZZ.pdf'],
            [await firmarPdf(generados.get(4) as Uint8Array), `${C[4]}.pdf`],
            [await firmarPdf(generados.get(5) as Uint8Array), `${C[5]}.pdf`],
            [Buffer.from('notas'), 'notas.txt', 'text/plain'],
            [Buffer.from('no es un pdf'), `${C[3]}.pdf`],
            [firmado1, `${C[1]} (1).pdf`],
            [await firmarPdf(generados.get(6) as Uint8Array, { firmas: 2 }), `${C[6]}.pdf`],
        ])
        expect(r.status).toBe(200)
        expect(r.body.data.resumen).toEqual({
            firmados: 1, parciales: 0, sinFirma: 1, noCoincide: 1, noEncontrados: 1, otroEvento: 1, anulados: 1, yaFirmados: 1, duplicados: 1, invalidos: 2,
        })
        const porArchivo = Object.fromEntries(r.body.data.detalle.map((d: { archivo: string }) => [d.archivo, d]))
        expect(porArchivo[`${C[1]}_firmado.pdf`]).toEqual({
            archivo: `${C[1]}_firmado.pdf`, resultado: 'FIRMADO', certificadoId: 1, codigo: C[1], estado: 'FIRMADO', firmas: 1, firmasRequeridas: 1,
            coincidencia: 'PREFIJO', codigoError: null, mensaje: 'Firmado (1 de 1 firmas).',
        })
        expect(porArchivo[`${C[2]} [R].pdf`]).toMatchObject({ resultado: 'SIN_FIRMA', codigoError: 'SIGNATURE_NOT_FOUND', firmas: 0 })
        expect(porArchivo[`cert_${C[2].toLowerCase()}-signed.pdf`]).toMatchObject({ resultado: 'NO_COINCIDE', codigoError: 'SIGNED_MISMATCH', certificadoId: 2 })
        expect(porArchivo['CIISIC-2026-000099-ZZZZZZ.pdf']).toMatchObject({ resultado: 'NO_ENCONTRADO', certificadoId: null })
        // De otro evento: no se revela su id ni su estado
        expect(porArchivo[`${C[4]}.pdf`]).toMatchObject({ resultado: 'OTRO_EVENTO', certificadoId: null, estado: null })
        expect(porArchivo[`${C[5]}.pdf`]).toMatchObject({ resultado: 'ANULADO' })
        expect(porArchivo['notas.txt']).toMatchObject({ resultado: 'INVALIDO', codigoError: 'INVALID_FILE_TYPE' })
        expect(porArchivo[`${C[3]}.pdf`]).toMatchObject({ resultado: 'INVALIDO', codigoError: 'INVALID_PDF' })
        expect(porArchivo[`${C[1]} (1).pdf`]).toMatchObject({ resultado: 'DUPLICADO', certificadoId: 1 })
        expect(porArchivo[`${C[6]}.pdf`]).toMatchObject({ resultado: 'YA_FIRMADO' })

        // Solo se guardó el firmado del 1 (más el que ya tenía el 6), con nombre del servidor
        const fila = filas.get(1) as Fila
        expect(fila).toMatchObject({
            estado: 'FIRMADO', firmasDetectadas: 1, coincidencia: 'PREFIJO', firmadoCargadoPorId: 40, hashFirmado: sha256(firmado1), bytesFirmado: firmado1.byteLength,
            firmantes: [expect.objectContaining({ nombre: 'Autoridad de Prueba UNDC' })],
        })
        expect(fila.archivoFirmado).toMatch(new RegExp(`^${C[1]}-[0-9a-f]{16}\\.pdf$`))
        expect(fila.firmadoEn).toBeInstanceOf(Date)
        expect(firmados()).toEqual([fila.archivoFirmado, filas.get(6)?.archivoFirmado].sort())
        expect(fs.readFileSync(path.join(directorioCertificados(EVENTO, 'firmados'), fila.archivoFirmado as string)).equals(Buffer.from(firmado1))).toBe(true)
        expect(filas.get(2)?.estado).toBe('PREPARADO')
        expect(filas.get(3)?.estado).toBe('PREPARADO')
    })

    it('es idempotente: volver a subir el mismo archivo no cambia nada', async () => {
        await crear(1)
        const firmado = await firmarPdf(generados.get(1) as Uint8Array)
        expect((await subir(comision(), [[firmado, `${C[1]}.pdf`]])).body.data.resumen.firmados).toBe(1)
        const archivo = filas.get(1)?.archivoFirmado
        m.certificado.updateMany.mockClear()
        const otra = await subir(comision(), [[firmado, `${C[1]}.pdf`]])
        expect(otra.body.data.detalle[0]).toMatchObject({ resultado: 'YA_FIRMADO', mensaje: 'Este archivo ya estaba cargado.' })
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        expect(filas.get(1)?.archivoFirmado).toBe(archivo)
        expect(firmados()).toEqual([archivo])
    })

    it('con 3 firmas requeridas: 2 → EN_FIRMA; uno con menos firmas no lo pisa; la tercera sobre el parcial → FIRMADO', async () => {
        await crear(7, { plantilla: { firmasRequeridas: 3 } })
        // Dos firmas más un sello de tiempo del documento (que no cuenta)
        const parcial = await firmarPdf(generados.get(7) as Uint8Array, { firmas: 2, sello: true })
        const r1 = await subir(comision(), [[parcial, `${C[7]}.pdf`]])
        expect(r1.body.data.detalle[0]).toMatchObject({ resultado: 'PARCIAL', estado: 'EN_FIRMA', firmas: 2, firmasRequeridas: 3 })
        expect(r1.body.data.resumen.parciales).toBe(1)
        expect(filas.get(7)).toMatchObject({ estado: 'EN_FIRMA', firmadoEn: null, firmasDetectadas: 2 })
        const archivoParcial = filas.get(7)?.archivoFirmado

        m.certificado.updateMany.mockClear()
        const menos = await subir(comision(), [[await firmarPdf(generados.get(7) as Uint8Array), `${C[7]}.pdf`]])
        expect(menos.body.data.detalle[0]).toMatchObject({ resultado: 'PARCIAL', firmas: 2, mensaje: expect.stringContaining('Se conserva el archivo cargado antes (2 firmas)') })
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        expect(filas.get(7)?.archivoFirmado).toBe(archivoParcial)

        const completo = await firmarPdf(parcial)
        const r2 = await subir(comision(), [[completo, `${C[7]}_firmado.pdf`]])
        expect(r2.body.data.detalle[0]).toMatchObject({ resultado: 'FIRMADO', estado: 'FIRMADO', firmas: 3, coincidencia: 'PREFIJO' })
        expect(filas.get(7)?.firmadoEn).toBeInstanceOf(Date)
        expect(firmados()).toEqual([filas.get(7)?.archivoFirmado])
        // El parcial no se borra: queda en firmados/reemplazados
        expect(reemplazados()).toEqual([archivoParcial])
    })

    it('dos firmantes que firmaron en paralelo no se pisan: se conserva el primero (tanda y PUT)', async () => {
        await crear(7, { plantilla: { firmasRequeridas: 2 } })
        const deA = await firmarPdf(generados.get(7) as Uint8Array, { firmante: nuevoFirmante('Firmante A') })
        const deB = await firmarPdf(generados.get(7) as Uint8Array, { firmante: nuevoFirmante('Firmante B') })
        expect((await subir(comision(), [[deA, `${C[7]}.pdf`]])).body.data.detalle[0]).toMatchObject({ resultado: 'PARCIAL', estado: 'EN_FIRMA', firmas: 1 })
        const archivoA = filas.get(7)?.archivoFirmado
        const enParalelo = await subir(comision(), [[deB, `${C[7]}.pdf`]])
        expect(enParalelo.body.data.detalle[0]).toMatchObject({ resultado: 'PARCIAL', mensaje: expect.stringContaining('no continúa sus firmas') })
        const put = await reemplazar(comision(), 7, deB)
        expect(put.status).toBe(409)
        expect(put.body.code).toBe('SIGNATURES_NOT_EXTENDED')
        expect(filas.get(7)).toMatchObject({ archivoFirmado: archivoA, firmasDetectadas: 1, firmantes: [expect.objectContaining({ nombre: 'Firmante A' })] })
        // B firma sobre el de A: continúa sus firmas → FIRMADO
        const ambos = await firmarPdf(deA, { firmante: nuevoFirmante('Firmante B') })
        expect((await reemplazar(comision(), 7, ambos)).body.data).toMatchObject({ estado: 'FIRMADO', firmasDetectadas: 2 })
        expect(filas.get(7)?.firmantes).toEqual([expect.objectContaining({ nombre: 'Firmante A' }), expect.objectContaining({ nombre: 'Firmante B' })])
    })

    it('si bajan las firmas requeridas, volver a subir el mismo parcial lo deja FIRMADO (tanda y PUT)', async () => {
        await crear(7, { plantilla: { firmasRequeridas: 2 } })
        const parcial = await firmarPdf(generados.get(7) as Uint8Array)
        await subir(comision(), [[parcial, `${C[7]}.pdf`]])
        expect(filas.get(7)).toMatchObject({ estado: 'EN_FIRMA', firmasDetectadas: 1 })
        ;(filas.get(7) as Fila).plantilla = { firmasRequeridas: 1 }
        const r = await subir(comision(), [[parcial, `${C[7]}.pdf`]])
        expect(r.body.data.detalle[0]).toMatchObject({ resultado: 'FIRMADO', estado: 'FIRMADO', mensaje: expect.stringContaining('ahora alcanza') })
        expect(filas.get(7)?.firmadoEn).toBeInstanceOf(Date)

        await crear(6, { plantilla: { firmasRequeridas: 2 } })
        const otro = await firmarPdf(generados.get(6) as Uint8Array)
        await reemplazar(comision(), 6, otro)
        ;(filas.get(6) as Fila).plantilla = { firmasRequeridas: 1 }
        expect((await reemplazar(comision(), 6, otro)).body.data).toMatchObject({ estado: 'FIRMADO', firmasDetectadas: 1 })
    })

    it('firmas que no verifican, contenido activo o cambios después de generado no se aceptan', async () => {
        await crear(1)
        await crear(2)
        const doc = await PDFDocument.load(generados.get(2) as Uint8Array, { updateMetadata: false })
        const siguiente = doc.context.largestObjectNumber + 1
        const conScript = await agregarObjetos(generados.get(2) as Uint8Array, [[siguiente, '<< /S /JavaScript /JS (app.alert(1)) >>']])
        const r = await subir(comision(), [
            [await firmarPdf(generados.get(1) as Uint8Array, { falsa: true }), `${C[1]}.pdf`],
            [await firmarPdf(conScript), `${C[2]}.pdf`],
        ])
        const porArchivo = Object.fromEntries(r.body.data.detalle.map((d: { archivo: string }) => [d.archivo, d]))
        expect(porArchivo[`${C[1]}.pdf`]).toMatchObject({ resultado: 'INVALIDO', codigoError: 'SIGNATURE_INVALID', certificadoId: 1 })
        expect(porArchivo[`${C[2]}.pdf`]).toMatchObject({ resultado: 'INVALIDO', codigoError: 'PDF_ACTIVE_CONTENT' })
        expect(filas.get(1)?.estado).toBe('PREPARADO')
        expect(filas.get(2)?.estado).toBe('PREPARADO')
        expect(firmados()).toEqual([])
    })

    it('un PDF reescrito por la herramienta no se acepta solo (SIGNED_REWRITTEN); el de una generación anterior no coincide', async () => {
        await crear(1)
        const reescrito = await firmarPdf(await reescribir(generados.get(1) as Uint8Array))
        const r = await subir(comision(), [[reescrito, `${C[1]}.pdf`]])
        expect(r.body.data.detalle[0]).toMatchObject({ resultado: 'NO_COINCIDE', coincidencia: 'METADATOS', codigoError: 'SIGNED_REWRITTEN', firmas: 1 })
        expect(filas.get(1)?.estado).toBe('PREPARADO')
        // Solo quien gestiona, uno por uno y con motivo
        expect((await reemplazar(comision(), 1, reescrito)).body.code).toBe('SIGNED_REWRITTEN')
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const forzado = await reemplazar(admin(), 1, reescrito, { forzar: 'true', motivo: 'FirmaPerú reescribió el archivo' })
        expect(forzado.body.data).toMatchObject({ estado: 'FIRMADO', coincidencia: 'METADATOS' })
        expect(filas.get(1)).toMatchObject({ coincidencia: 'METADATOS', motivoForzado: 'FirmaPerú reescribió el archivo' })
        expect(avisos).toHaveBeenCalledWith('Firmado forzado (METADATOS): certificado 1 por la cuenta 2')
        avisos.mockRestore()

        await crear(2)
        const anterior = await firmarPdf(await pdfGenerado(C[2], 'GENVIEJO'))
        const r2 = await subir(comision(), [[anterior, `${C[2]}.pdf`]])
        expect(r2.body.data.detalle[0]).toMatchObject({ resultado: 'NO_COINCIDE', codigoError: 'SIGNED_MISMATCH' })
        expect(filas.get(2)?.estado).toBe('PREPARADO')
    })

    it('sin código en el nombre, empareja por el Subject del PDF; un PENDIENTE no tiene con qué comparar', async () => {
        await crear(1)
        const r = await subir(comision(), [[await firmarPdf(generados.get(1) as Uint8Array), 'documento firmado digitalmente.pdf']])
        expect(r.body.data.detalle[0]).toMatchObject({ resultado: 'FIRMADO', certificadoId: 1, codigo: C[1] })

        await crear(8, {}, { generar: false })
        const ajeno = await firmarPdf(await pdfGenerado(C[8], 'GENVIEJO'))
        const r2 = await subir(comision(), [[ajeno, `${C[8]}.pdf`]])
        expect(r2.body.data.detalle[0]).toMatchObject({ resultado: 'NO_COINCIDE', codigoError: 'CERTIFICATE_NOT_GENERATED' })
    })

    it('un FIRMADO solo se reemplaza con «reemplazar», por quien gestiona y por un archivo completo; el anterior se archiva', async () => {
        await crear(6)
        const anterior = await yaFirmado(6, await firmarPdf(generados.get(6) as Uint8Array))
        const nuevo = await firmarPdf(generados.get(6) as Uint8Array, { firmas: 2 })
        expect((await subir(comision(), [[nuevo, `${C[6]}.pdf`]])).body.data.detalle[0]).toMatchObject({ resultado: 'YA_FIRMADO' })
        // La Comisión (operar) no reemplaza un firmado: sería borrar el verdadero
        const sinPermiso = await subir(comision(), [[nuevo, `${C[6]}.pdf`]], { reemplazar: 'true' })
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body.code).toBe('FORBIDDEN')
        expect(filas.get(6)?.archivoFirmado).toBe(path.basename(anterior))
        const r = await subir(admin(), [[nuevo, `${C[6]}.pdf`]], { reemplazar: 'true' })
        expect(r.body.data.detalle[0]).toMatchObject({ resultado: 'FIRMADO', firmas: 2 })
        expect(fs.existsSync(anterior)).toBe(false)
        expect(fs.existsSync(archivado(anterior))).toBe(true)
        expect(firmados()).toEqual([filas.get(6)?.archivoFirmado])
    })

    it('si el certificado cambió en medio (regenerado), no se acepta y el archivo nuevo se borra', async () => {
        await crear(1)
        m.certificado.updateMany.mockResolvedValueOnce({ count: 0 })
        const r = await subir(comision(), [[await firmarPdf(generados.get(1) as Uint8Array), `${C[1]}.pdf`]])
        expect(r.body.data.detalle[0]).toMatchObject({ resultado: 'NO_COINCIDE', codigoError: 'CERTIFICATE_CHANGED' })
        expect(firmados()).toEqual([])
    })

    it('exige archivos y un evento existente', async () => {
        const vacia = await request(app).post(`/api/v1/events/${EVENTO}/certificates/signed`).set('Authorization', admin()).field('reemplazar', 'false')
        expect(vacia.status).toBe(422)
        expect(vacia.body.code).toBe('FILE_REQUIRED')
        const r = await subir(admin(), [[Buffer.from('%PDF-1.7\n%%EOF'), `${C[1]}.pdf`]], {}, 99)
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('EVENT_NOT_FOUND')
    })
})

describe('límites de la subida', () => {
    function probar(headers: Record<string, string>, maximo = 100) {
        const next = jest.fn()
        const res = { setHeader: jest.fn() }
        limiteContenido(maximo)({ headers } as unknown as Request, res as unknown as Response, next)
        return { error: next.mock.calls[0][0] as { status?: number, code?: string } | undefined, res }
    }

    it('Content-Length obligatorio (411) y acotado (413)', () => {
        expect(probar({}).error).toMatchObject({ status: 411, code: 'LENGTH_REQUIRED' })
        expect(probar({ 'transfer-encoding': 'chunked' }).error).toMatchObject({ status: 411 })
        expect(probar({ 'content-length': '12abc' }).error).toMatchObject({ status: 411 })
        const grande = probar({ 'content-length': '101' })
        expect(grande.error).toMatchObject({ status: 413, code: 'UPLOAD_LIMIT_EXCEEDED' })
        expect(grande.res.setHeader).toHaveBeenCalledWith('Connection', 'close')
        expect(probar({ 'content-length': '100' }).error).toBeUndefined()
    })

    it('la ruta corta antes de leer el cuerpo si declara más de 25 MB', async () => {
        const r = await request(app).post(`/api/v1/events/${EVENTO}/certificates/signed`).set('Authorization', admin())
            .set('Content-Type', 'multipart/form-data; boundary=x').set('Content-Length', String(25 * 1024 * 1024 + 1)).send('')
        expect(r.status).toBe(413)
        expect(r.body.code).toBe('UPLOAD_LIMIT_EXCEEDED')
    })

    it('un archivo de más de 10 MB → 413; más de 10 archivos → 400', async () => {
        const grande = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20)
        const r = await subir(admin(), [[grande, `${C[1]}.pdf`]])
        expect(r.status).toBe(413)
        const once = Array.from({ length: 11 }, (_, i): [Buffer, string] => [Buffer.from('%PDF-1.7'), `f${i}.pdf`])
        expect((await subir(admin(), once)).status).toBe(400)
    })
})

describe('permisos de firmados y anulación', () => {
    it('sin certificados.operar en el evento → 403; con otro evento asignado → EVENT_NOT_ASSIGNED', async () => {
        await crear(1)
        const pdf = await firmarPdf(generados.get(1) as Uint8Array)
        expect((await subir(comision(['certificados.ver']), [[pdf, `${C[1]}.pdf`]])).status).toBe(403)
        expect((await subir(`Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [EVENTO] })}`, [[pdf, `${C[1]}.pdf`]])).status).toBe(403)
        const otro = await subir(comision(['certificados.operar'], [3]), [[pdf, `${C[1]}.pdf`]])
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        // Por id: el certificado es del evento 2 y la cuenta solo tiene el 3
        const porId = await reemplazar(comision(['certificados.operar'], [3]), 1, pdf)
        expect(porId.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect(filas.get(1)?.estado).toBe('PREPARADO')
    })

    it('la Comisión con operar no fuerza, no quita firmados ni anula', async () => {
        await crear(1)
        const ajeno = await firmarPdf(await pdfGenerado(C[2], 'GENVIEJO'))
        const forzar = await reemplazar(comision(), 1, ajeno, { forzar: 'true', motivo: 'El firmante renombró el archivo' })
        expect(forzar.status).toBe(403)
        expect(forzar.body.code).toBe('FORBIDDEN')
        expect((await request(app).delete('/api/v1/certificates/1/signed').set('Authorization', comision())).status).toBe(403)
        expect((await request(app).post('/api/v1/certificates/1/annul').set('Authorization', comision()).send({ motivo: 'Error en el nombre' })).status).toBe(403)
        expect(filas.get(1)).toMatchObject({ estado: 'PREPARADO', archivoFirmado: null })
    })
})

describe('PUT /v1/certificates/:id/signed', () => {
    it('acepta el firmado del certificado sin mirar el nombre', async () => {
        await crear(1)
        const r = await reemplazar(comision(), 1, await firmarPdf(generados.get(1) as Uint8Array), {}, 'cualquier-nombre.pdf')
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ id: 1, codigo: C[1], estado: 'FIRMADO', firmasDetectadas: 1, firmasRequeridas: 1, coincidencia: 'PREFIJO' })
        expect(filas.get(1)?.firmadoCargadoPorId).toBe(40)
    })

    it('rechaza lo que no corresponde', async () => {
        await crear(1)
        await crear(5, { estado: 'ANULADO', claveVigente: null })
        await crear(8, {}, { generar: false })
        const firmado = await firmarPdf(generados.get(1) as Uint8Array)
        const casos: [number, Uint8Array | Buffer, Record<string, string>, number, string][] = [
            [99, firmado, {}, 404, 'CERTIFICATE_NOT_FOUND'],
            [5, firmado, {}, 409, 'CERTIFICATE_ANNULLED'],
            [8, firmado, {}, 409, 'CERTIFICATE_NOT_GENERATED'],
            [1, generados.get(1) as Uint8Array, {}, 422, 'SIGNATURE_NOT_FOUND'],
            [1, await firmarPdf(await pdfGenerado(C[2], 'GENVIEJO')), {}, 422, 'SIGNED_MISMATCH'],
            [1, Buffer.from('no es un pdf'), {}, 422, 'INVALID_PDF'],
            [1, firmado, { forzar: 'true' }, 422, 'VALIDATION_ERROR'],
        ]
        for (const [id, bytes, campos, status, code] of casos) {
            const r = await reemplazar(admin(), id, bytes, campos)
            expect({ id, code: r.body.code, status: r.status }).toEqual({ id, code, status })
        }
        const txt = await reemplazar(admin(), 1, Buffer.from('hola'), {}, 'notas.txt', 'text/plain')
        expect(txt.body.code).toBe('INVALID_FILE_TYPE')
        expect(filas.get(1)?.estado).toBe('PREPARADO')

        await yaFirmado(1, firmado)
        const yaEsta = await reemplazar(admin(), 1, await firmarPdf(generados.get(1) as Uint8Array, { firmas: 2 }))
        expect(yaEsta.body.code).toBe('CERTIFICATE_ALREADY_SIGNED')
    })

    it('forzar (gestionar + motivo) acepta un archivo que no coincide y queda registrado', async () => {
        await crear(1)
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const ajeno = await firmarPdf(await reescribir(await pdfGenerado(C[1], 'OTRAGEN1')))
        const r = await reemplazar(admin(), 1, ajeno, { forzar: 'true', motivo: 'La herramienta cambió los metadatos' })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ estado: 'FIRMADO', coincidencia: 'FORZADO' })
        expect(filas.get(1)).toMatchObject({ coincidencia: 'FORZADO', motivoForzado: 'La herramienta cambió los metadatos', firmadoCargadoPorId: 2 })
        expect(avisos).toHaveBeenCalledWith('Firmado forzado (FORZADO): certificado 1 por la cuenta 2')
        avisos.mockRestore()

        // Si coincide, forzar no hace falta: se guarda la coincidencia real y no el motivo
        await crear(2)
        const r2 = await reemplazar(admin(), 2, await firmarPdf(generados.get(2) as Uint8Array), { forzar: 'true', motivo: 'Por si acaso' })
        expect(filas.get(2)).toMatchObject({ coincidencia: 'PREFIJO', motivoForzado: null })
        expect(r2.body.data.coincidencia).toBe('PREFIJO')
    })

    it('reemplaza un FIRMADO solo con «reemplazar», por quien gestiona y nunca por uno incompleto', async () => {
        await crear(7, { plantilla: { firmasRequeridas: 2 } })
        const anterior = await yaFirmado(7, await firmarPdf(generados.get(7) as Uint8Array, { firmas: 2 }), 2)
        const sinPermiso = await reemplazar(comision(), 7, await firmarPdf(generados.get(7) as Uint8Array, { firmas: 3 }), { reemplazar: 'true' })
        expect(sinPermiso.status).toBe(403)
        const incompleto = await reemplazar(admin(), 7, await firmarPdf(generados.get(7) as Uint8Array), { reemplazar: 'true' })
        expect(incompleto.body.code).toBe('SIGNATURES_INCOMPLETE')
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const r = await reemplazar(admin(), 7, await firmarPdf(generados.get(7) as Uint8Array, { firmas: 3 }), { reemplazar: 'true' })
        expect(r.body.data).toMatchObject({ estado: 'FIRMADO', firmasDetectadas: 3 })
        expect(avisos).toHaveBeenCalledWith('Firmado reemplazado: certificado 7 por la cuenta 2')
        avisos.mockRestore()
        expect(fs.existsSync(anterior)).toBe(false)
        expect(fs.existsSync(archivado(anterior))).toBe(true)
    })

    it('un parcial (EN_FIRMA) no se reemplaza por una copia con menos o las mismas firmas que no lo continúa', async () => {
        await crear(7, { plantilla: { firmasRequeridas: 3 } })
        const dos = await firmarPdf(generados.get(7) as Uint8Array, { firmas: 2 })
        await yaFirmado(7, dos, 2, 'EN_FIRMA')
        const vieja = await reemplazar(comision(), 7, await firmarPdf(generados.get(7) as Uint8Array))
        expect(vieja.status).toBe(409)
        expect(vieja.body.code).toBe('SIGNATURES_NOT_EXTENDED')
        expect(filas.get(7)).toMatchObject({ estado: 'EN_FIRMA', firmasDetectadas: 2, hashFirmado: sha256(dos) })
    })

    it('forzar con cambios después de generado (SIGNED_MODIFIED) queda FORZADO; con firma inválida, nunca', async () => {
        await crear(1)
        const doc = await PDFDocument.load(generados.get(1) as Uint8Array, { updateMetadata: false })
        const pagina = doc.getPages()[0]
        pagina.node.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 50, 50]))
        const crop = await agregarObjetos(generados.get(1) as Uint8Array, [[pagina.ref.objectNumber, pagina.node.toString()]])
        const modificado = await firmarPdf(crop)
        expect((await reemplazar(admin(), 1, modificado)).body.code).toBe('SIGNED_MODIFIED')
        expect((await reemplazar(admin(), 1, await firmarPdf(generados.get(1) as Uint8Array, { falsa: true }), { forzar: 'true', motivo: 'Lo pide el decano' })).body.code).toBe('SIGNATURE_INVALID')
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const r = await reemplazar(admin(), 1, modificado, { forzar: 'true', motivo: 'Recorte revisado a mano' })
        expect(r.body.data).toMatchObject({ estado: 'FIRMADO', coincidencia: 'FORZADO' })
        avisos.mockRestore()
    })
})

describe('turno de las cargas de firmados', () => {
    const peticion = () => {
        const res = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, setHeader: jest.fn() })
        return { req: { destroyed: false } as unknown as Request, res }
    }

    it('con los turnos ocupados y la cola llena → 503 SIGNED_UPLOAD_BUSY sin leer el cuerpo; al terminar se libera', async () => {
        const turno = crearTurnoCargaFirmados(limitarConcurrencia(1, 0, () => new HttpError(503, 'SIGNED_UPLOAD_BUSY', 'ocupado')))
        const a = peticion()
        const nextA = jest.fn()
        turno(a.req, a.res as unknown as Response, nextA)
        await new Promise((r) => setImmediate(r))
        expect(nextA).toHaveBeenCalledWith()

        const b = peticion()
        const nextB = jest.fn()
        turno(b.req, b.res as unknown as Response, nextB)
        await new Promise((r) => setImmediate(r))
        expect(nextB.mock.calls[0][0]).toMatchObject({ status: 503, code: 'SIGNED_UPLOAD_BUSY' })
        expect(b.res.setHeader).toHaveBeenCalledWith('Connection', 'close')

        a.res.emit('finish')
        await new Promise((r) => setImmediate(r))
        const c = peticion()
        const nextC = jest.fn()
        turno(c.req, c.res as unknown as Response, nextC)
        await new Promise((r) => setImmediate(r))
        expect(nextC).toHaveBeenCalledWith()
    })
})

describe('quitar firmado y anular', () => {
    it('DELETE /signed vuelve a PREPARADO y archiva el archivo (no lo borra); sin firmado → 409', async () => {
        await crear(1)
        const ruta = await yaFirmado(1, await firmarPdf(generados.get(1) as Uint8Array))
        const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
        const r = await request(app).delete('/api/v1/certificates/1/signed').set('Authorization', admin())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ id: 1, codigo: C[1], estado: 'PREPARADO' })
        expect(filas.get(1)).toMatchObject({ estado: 'PREPARADO', archivoFirmado: null, hashFirmado: null, bytesFirmado: null, firmantes: Prisma.DbNull, firmasDetectadas: 0, coincidencia: null, firmadoEn: null, editadoPorId: 2 })
        expect(fs.existsSync(ruta)).toBe(false)
        const otra = await request(app).delete('/api/v1/certificates/1/signed').set('Authorization', admin())
        expect(otra.status).toBe(409)
        expect(otra.body.code).toBe('CERTIFICATE_NOT_SIGNED')
        info.mockRestore()
    })

    it('anular exige motivo, libera la clave vigente y no se repite', async () => {
        await crear(1)
        const ruta = await yaFirmado(1, await firmarPdf(generados.get(1) as Uint8Array))
        const sinMotivo = await request(app).post('/api/v1/certificates/1/annul').set('Authorization', admin()).send({})
        expect(sinMotivo.status).toBe(422)
        expect(sinMotivo.body.fields).toHaveProperty('motivo')

        const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
        const r = await request(app).post('/api/v1/certificates/1/annul').set('Authorization', admin()).send({ motivo: '  Nombre mal escrito  ' })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ id: 1, codigo: C[1], estado: 'ANULADO', motivoAnulacion: 'Nombre mal escrito' })
        expect(filas.get(1)).toMatchObject({ estado: 'ANULADO', claveVigente: null, motivoAnulacion: 'Nombre mal escrito', anuladoPorId: 2 })
        expect(filas.get(1)?.anuladoEn).toBeInstanceOf(Date)
        // Los archivos se conservan (la verificación pública lo muestra ANULADO, sin documento)
        expect(fs.existsSync(ruta)).toBe(true)

        const otra = await request(app).post('/api/v1/certificates/1/annul').set('Authorization', admin()).send({ motivo: 'Otra vez' })
        expect(otra.status).toBe(409)
        expect(otra.body.code).toBe('CERTIFICATE_ALREADY_ANNULLED')
        expect((await request(app).post('/api/v1/certificates/99/annul').set('Authorization', admin()).send({ motivo: 'No existe' })).status).toBe(404)
        // Anulado: no se le puede subir ni quitar el firmado
        expect((await request(app).delete('/api/v1/certificates/1/signed').set('Authorization', admin())).body.code).toBe('CERTIFICATE_ANNULLED')
        info.mockRestore()
    })
})

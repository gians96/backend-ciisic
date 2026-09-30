import { randomUUID } from 'crypto'
import { access, mkdir, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { prisma } from '../../../database/prisma'
import { DIRECTORIO_QR, REGEX_ARCHIVO_QR } from '../../../core/almacenamiento'
import { notFound, unprocessable } from '../../../core/http-error'

type TipoImagen = 'png' | 'jpg' | 'webp'

const TIPO_POR_MIME: Record<string, TipoImagen> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MIME_POR_TIPO: Record<TipoImagen, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const noExiste = () => notFound('QR_NOT_FOUND', 'La imagen del QR no existe.')

/** Tipo real de la imagen según sus primeros bytes (no según el nombre ni el MIME declarado). */
export function tipoDeImagen(bytes: Buffer): TipoImagen | null {
    if (bytes.subarray(0, 8).equals(FIRMA_PNG)) return 'png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
    return null
}

/** Guarda la imagen (ya acotada por multer) con un nombre nuevo si su contenido es el declarado. */
export async function guardarQr(archivo: { buffer: Buffer, mimetype: string }) {
    const tipo = tipoDeImagen(archivo.buffer)
    if (!tipo || tipo !== TIPO_POR_MIME[archivo.mimetype]) {
        throw unprocessable('INVALID_FILE_CONTENT', 'El contenido del archivo no es una imagen PNG, JPG o WebP válida.')
    }
    const nombre = `qr-${randomUUID()}.${tipo}`
    await mkdir(DIRECTORIO_QR, { recursive: true })
    await writeFile(path.join(DIRECTORIO_QR, nombre), archivo.buffer, { flag: 'wx' })
    return { archivo: nombre }
}

/** Ruta en disco de un QR subido; 404 si el nombre no tiene el formato del servidor o no existe. */
export async function rutaQr(archivo: string): Promise<string> {
    if (!REGEX_ARCHIVO_QR.test(archivo)) throw noExiste()
    const ruta = path.join(DIRECTORIO_QR, archivo)
    try {
        await access(ruta)
    } catch {
        throw noExiste()
    }
    return ruta
}

export function mimeDeQr(ruta: string): string {
    return MIME_POR_TIPO[path.extname(ruta).slice(1) as TipoImagen] ?? 'application/octet-stream'
}

/** QR subidos que usa un `datosPago` (`billeteras[].qrArchivo`). */
export function qrsDe(datosPago: unknown): Set<string> {
    const billeteras = (datosPago as { billeteras?: unknown } | null)?.billeteras
    const archivos = (Array.isArray(billeteras) ? billeteras : []).map((b) => (b as { qrArchivo?: unknown } | null)?.qrArchivo)
    return new Set(archivos.filter((a): a is string => typeof a === 'string' && REGEX_ARCHIVO_QR.test(a)))
}

/** La landing solo puede pedir los QR que usa su evento. */
export async function rutaQrDelEvento(datosPago: unknown, archivo: string): Promise<string> {
    if (!qrsDe(datosPago).has(archivo)) throw noExiste()
    return rutaQr(archivo)
}

/** Antes de guardar los datos de pago: cada QR referenciado debe haberse subido y seguir en disco. */
export async function verificarQrs(datosPago: unknown): Promise<void> {
    for (const archivo of qrsDe(datosPago)) {
        try {
            await rutaQr(archivo)
        } catch {
            throw unprocessable('QR_NOT_FOUND', 'Una imagen de QR ya no existe en el servidor. Vuelve a subirla.', { 'datosPago.billeteras': 'Vuelve a subir la imagen del QR' })
        }
    }
}

/**
 * Borra los QR que un evento dejó de usar, salvo que otro evento los siga usando (al copiar un
 * evento se comparten). Se llama después de guardar y nunca hace fallar esa operación.
 */
export async function limpiarQrs(antes: Set<string>, despues: Set<string>): Promise<void> {
    const candidatos = [...antes].filter((archivo) => !despues.has(archivo))
    if (!candidatos.length) return
    try {
        const enUso = new Set<string>()
        for (const { datosPago } of await prisma.evento.findMany({ select: { datosPago: true } })) {
            for (const archivo of qrsDe(datosPago)) enUso.add(archivo)
        }
        await Promise.all(candidatos.filter((archivo) => !enUso.has(archivo))
            .map((archivo) => unlink(path.join(DIRECTORIO_QR, archivo)).catch(() => undefined)))
    } catch (error) {
        console.error('No se pudieron limpiar las imágenes QR:', (error as Error).message)
    }
}

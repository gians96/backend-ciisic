import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { TipoFoto } from './imagenes'

/** Tamaño máximo de un voucher (5 MB). */
export const MAX_BYTES_VOUCHER = 5 * 1024 * 1024

/**
 * Carpeta de archivos subidos (vouchers, credenciales PDF, ponencias): `<cwd>/uploads`, que en
 * Docker es el volumen `/app/uploads`. Solo las pruebas pueden apuntarla a un temporal.
 */
export const DIRECTORIO_UPLOADS = path.resolve(
    process.env.NODE_ENV === 'test' && process.env.CIISIC_UPLOADS_PRUEBAS
        ? process.env.CIISIC_UPLOADS_PRUEBAS
        : path.join(process.cwd(), 'uploads'),
)

/** Imágenes QR de las billeteras de pago (Yape, Plin…). */
export const DIRECTORIO_QR = path.join(DIRECTORIO_UPLOADS, 'qr')

/** Tamaño máximo de una imagen QR (2 MB). */
export const MAX_BYTES_QR = 2 * 1024 * 1024

/** Nombre de un QR subido, siempre generado por el servidor: `qr-<uuid>.<png|jpg|webp>`. */
export const REGEX_ARCHIVO_QR = /^qr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/

/** Fotos del fotocheck de los participantes (spec 014), ya sin metadatos. */
export const DIRECTORIO_FOTOS = path.join(DIRECTORIO_UPLOADS, 'fotos')

/** Tamaño máximo de una foto del fotocheck (2 MB). */
export const MAX_BYTES_FOTO = 2 * 1024 * 1024

/** Nombre de una foto, siempre generado por el servidor: `foto-<uuid>.<png|jpg>`. */
export const REGEX_ARCHIVO_FOTO = /^foto-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/

export function nuevoNombreFoto(tipo: TipoFoto): string {
    return `foto-${randomUUID()}.${tipo}`
}

/** Ruta en disco de una foto guardada, o `null` si el nombre no tiene el formato del servidor. */
export function rutaFoto(archivo: string | null | undefined): string | null {
    return archivo && REGEX_ARCHIVO_FOTO.test(archivo) ? path.join(DIRECTORIO_FOTOS, archivo) : null
}

/**
 * Lee a memoria un archivo que otra petición puede borrar en cualquier momento (los PDF de credencial
 * al cambiar la foto, la foto al reemplazarla). Se llama sin esperas entre obtener la ruta y leerla:
 * así nadie lo borra en medio (con `res.sendFile` la lectura es asíncrona y podía fallar con ENOENT).
 * Si aun así ya no está, lanza `noEncontrado()`.
 */
export function leerArchivoServido(ruta: string, noEncontrado: () => Error): Buffer {
    try {
        return fs.readFileSync(ruta)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw noEncontrado()
        throw error
    }
}

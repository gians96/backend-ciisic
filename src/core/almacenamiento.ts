import { randomBytes, randomUUID } from 'crypto'
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

// ─── Certificados (spec 015) ────────────────────────────────────────────────

/**
 * Archivos de certificados: `certificados/plantillas/plantilla-<uuid>.pdf` (diseños) y, por evento,
 * `certificados/<eventoId>/generados/<código>-<generación>.pdf` y
 * `certificados/<eventoId>/firmados/<código>-<16 hex>.pdf`. La carpeta va por id del evento (su
 * código es editable) y la BD guarda solo el nombre del archivo, siempre generado por el servidor.
 * Los firmados no se pueden reponer: respaldar `uploads/certificados` tras cada carga.
 */
export const DIRECTORIO_CERTIFICADOS = path.join(DIRECTORIO_UPLOADS, 'certificados')

/** Diseños PDF de las plantillas de todos los eventos. */
export const DIRECTORIO_PLANTILLAS_CERTIFICADO = path.join(DIRECTORIO_CERTIFICADOS, 'plantillas')

/** Tamaño máximo del PDF de diseño de una plantilla (5 MB). */
export const MAX_BYTES_PLANTILLA = 5 * 1024 * 1024

/** Tamaño máximo de un PDF firmado (10 MB). */
export const MAX_BYTES_PDF_FIRMADO = 10 * 1024 * 1024

/** Tamaño máximo de una solicitud de carga de firmados (`Content-Length`, 25 MB). */
export const MAX_BYTES_CARGA_FIRMADOS = 25 * 1024 * 1024

/** Archivos por solicitud de carga de firmados. */
export const MAX_ARCHIVOS_CARGA_FIRMADOS = 10

/** Nombre del diseño de una plantilla: `plantilla-<uuid>.pdf`. */
export const REGEX_ARCHIVO_PLANTILLA = /^plantilla-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/

/** Código del certificado (`<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>`, Crockford) dentro de un nombre de archivo. */
const CODIGO_EN_ARCHIVO = /[A-Z0-9]{2,20}-\d{4}-\d{6}-[0-9A-HJKMNP-TV-Z]{6}/.source

/** Generado: `<código>-<generación>.pdf` (generación: 8 caracteres Crockford). */
export const REGEX_ARCHIVO_GENERADO = new RegExp(`^${CODIGO_EN_ARCHIVO}-[0-9A-HJKMNP-TV-Z]{8}${/\.pdf$/.source}`)

/** Firmado: `<código>-<16 hex>.pdf`. */
export const REGEX_ARCHIVO_FIRMADO = new RegExp(`^${CODIGO_EN_ARCHIVO}-[0-9a-f]{16}${/\.pdf$/.source}`)

export type CarpetaCertificados = 'generados' | 'firmados'

export function nuevoNombrePlantilla(): string {
    return `plantilla-${randomUUID()}.pdf`
}

/** Ruta en disco del diseño de una plantilla, o `null` si el nombre no tiene el formato del servidor. */
export function rutaPlantilla(archivo: string | null | undefined): string | null {
    return archivo && REGEX_ARCHIVO_PLANTILLA.test(archivo) ? path.join(DIRECTORIO_PLANTILLAS_CERTIFICADO, archivo) : null
}

/** Carpeta de generados o firmados de un evento. Lanza si `eventoId` no es un entero positivo. */
export function directorioCertificados(eventoId: number, carpeta: CarpetaCertificados): string {
    if (!Number.isSafeInteger(eventoId) || eventoId < 1) throw new Error(`eventoId inválido para la carpeta de certificados: ${eventoId}`)
    return path.join(DIRECTORIO_CERTIFICADOS, String(eventoId), carpeta)
}

/** `<código>-<generación>.pdf`. Lanza si el código o la generación no tienen el formato del servidor. */
export function nombreArchivoGenerado(codigo: string, generacion: string): string {
    const nombre = `${codigo}-${generacion}.pdf`
    if (!REGEX_ARCHIVO_GENERADO.test(nombre)) throw new Error('Código o generación con formato inválido para el archivo generado')
    return nombre
}

/** `<código>-<16 hex aleatorios>.pdf`: cada carga de un firmado tiene su propio nombre. */
export function nuevoNombreFirmado(codigo: string): string {
    const nombre = `${codigo}-${randomBytes(8).toString('hex')}.pdf`
    if (!REGEX_ARCHIVO_FIRMADO.test(nombre)) throw new Error('Código con formato inválido para el archivo firmado')
    return nombre
}

/** Ruta en disco de un generado del evento, o `null` si el nombre no tiene el formato del servidor. */
export function rutaCertificadoGenerado(eventoId: number, archivo: string | null | undefined): string | null {
    return archivo && REGEX_ARCHIVO_GENERADO.test(archivo) ? path.join(directorioCertificados(eventoId, 'generados'), archivo) : null
}

/** Ruta en disco de un firmado del evento, o `null` si el nombre no tiene el formato del servidor. */
export function rutaCertificadoFirmado(eventoId: number, archivo: string | null | undefined): string | null {
    return archivo && REGEX_ARCHIVO_FIRMADO.test(archivo) ? path.join(directorioCertificados(eventoId, 'firmados'), archivo) : null
}

/** Carpeta de los firmados reemplazados o quitados de un evento (no se borran: no se pueden reponer). */
export function directorioFirmadosReemplazados(eventoId: number): string {
    return path.join(directorioCertificados(eventoId, 'firmados'), 'reemplazados')
}

/**
 * Mueve un firmado a `firmados/reemplazados/` (mismo nombre, que ya es único) en vez de borrarlo.
 * Devuelve la ruta nueva, o `null` si el nombre no es del servidor o el archivo ya no está.
 */
export async function archivarFirmado(eventoId: number, archivo: string | null | undefined): Promise<string | null> {
    const origen = rutaCertificadoFirmado(eventoId, archivo)
    if (!origen || !archivo) return null
    const destino = path.join(directorioFirmadosReemplazados(eventoId), archivo)
    await fs.promises.mkdir(path.dirname(destino), { recursive: true })
    try {
        await fs.promises.rename(origen, destino)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
    return destino
}

/**
 * Escritura atómica: escribe un temporal en la misma carpeta (`<ruta>.<hex>.tmp`, creado con `wx`),
 * lo lleva a disco (`fsync`) y lo renombra. Quien lee nunca ve un archivo a medias; si algo falla,
 * borra el temporal y propaga el error. Crea la carpeta si falta.
 */
export async function escribirArchivoAtomico(ruta: string, datos: Uint8Array): Promise<void> {
    await fs.promises.mkdir(path.dirname(ruta), { recursive: true })
    const temporal = `${ruta}.${randomBytes(6).toString('hex')}.tmp`
    try {
        const archivo = await fs.promises.open(temporal, 'wx')
        try {
            await archivo.writeFile(datos)
            await archivo.sync()
        } finally {
            await archivo.close()
        }
        await fs.promises.rename(temporal, ruta)
    } catch (error) {
        await fs.promises.rm(temporal, { force: true }).catch(() => undefined)
        throw error
    }
}

/** Borra un archivo si existe (sin error si ya no está). `null` no hace nada. */
export async function borrarArchivo(ruta: string | null | undefined): Promise<void> {
    if (!ruta) return
    await fs.promises.rm(ruta, { force: true })
}

import path from 'path'

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

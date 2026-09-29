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

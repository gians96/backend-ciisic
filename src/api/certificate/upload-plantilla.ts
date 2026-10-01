import multer from 'multer'
import path from 'path'
import { MAX_BYTES_PLANTILLA } from '../../core/almacenamiento'
import { HttpError } from '../../core/http-error'

/** Tipos declarados que se aceptan con extensión `.pdf`; el contenido se revisa después (firma y pdf-lib). */
const TIPOS_PDF = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream'])

/** multer 2 lo admite aunque sus tipos aún no lo declaren. */
type OpcionesMulter = multer.Options & { defParamCharset?: string }

/**
 * PDF de diseño de una plantilla de certificado (spec 015): en memoria y acotado, un archivo `file`
 * de hasta 5 MB (413 `UPLOAD_LIMIT_EXCEEDED`) y pocos campos de texto (`nombre`, `horasPorDefecto`,
 * `firmasRequeridas`, `campos` en JSON). Nada se escribe en disco hasta validar el PDF.
 */
export const plantillaUpload = multer({
    storage: multer.memoryStorage(),
    // Nombres de archivo con tildes (el navegador los envía en UTF-8)
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_BYTES_PLANTILLA, files: 1, fields: 4, fieldSize: 64 * 1024, parts: 5 },
    fileFilter: (_req, file, callback) => {
        if (!TIPOS_PDF.has(file.mimetype) || path.extname(file.originalname).toLowerCase() !== '.pdf') {
            callback(new HttpError(422, 'INVALID_PDF', 'Sube el diseño del certificado en PDF.'))
            return
        }
        callback(null, true)
    },
} as OpcionesMulter)

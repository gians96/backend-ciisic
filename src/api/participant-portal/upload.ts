import multer from 'multer'
import { MAX_BYTES_FOTO } from '../../core/almacenamiento'
import { HttpError } from '../../core/http-error'

/** Tipos declarados que se aceptan; el tipo real se revisa por la firma de bytes antes de guardar. */
const TIPOS_FOTO = new Set(['image/png', 'image/jpeg'])

/**
 * Foto del fotocheck (spec 014): en memoria y acotada, un archivo `file` de hasta 2 MB y un único
 * campo `consentimiento`. Nada se escribe en disco hasta revisar el contenido y quitar los metadatos.
 */
export const fotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES_FOTO, files: 1, fields: 1, parts: 2, fieldSize: 16 },
    fileFilter: (_req, file, callback) => {
        if (!TIPOS_FOTO.has(file.mimetype)) {
            callback(new HttpError(422, 'INVALID_FILE_TYPE', 'Sube una foto en formato JPG o PNG.'))
            return
        }
        callback(null, true)
    },
})

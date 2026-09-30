import multer from 'multer'
import path from 'path'
import { MAX_BYTES_QR } from '../../core/almacenamiento'

const TIPOS = new Set(['image/png', 'image/jpeg', 'image/webp'])
const EXTENSIONES = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp'])

// En memoria y acotada: el contenido se revisa antes de escribir nada en disco
export const qrUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES_QR, files: 1, fields: 0, parts: 1 },
    fileFilter: (_req, file, callback) => {
        if (!TIPOS.has(file.mimetype) || !EXTENSIONES.has(path.extname(file.originalname).toLowerCase())) {
            callback(Object.assign(new Error('Sube una imagen PNG, JPG o WebP.'), { statusCode: 422, code: 'INVALID_FILE_TYPE' }))
            return
        }
        callback(null, true)
    },
})

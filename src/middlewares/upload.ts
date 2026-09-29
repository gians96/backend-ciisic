import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { env } from '../../config/env'
import { HttpError } from '../core/http-error'
import type { NextFunction, Request, Response } from 'express'

// Directorio raíz de archivos subidos (volumen persistente en producción)
export const uploadsDir = path.resolve(process.cwd(), env.UPLOADS_DIR)
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
        cb(null, uploadsDir)
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        cb(null, `voucher-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`)
    },
})

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])

export const upload = multer({
    storage,
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase()
        if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
            cb(new HttpError(422, 'INVALID_FILE_TYPE', 'Archivo no permitido. Use PDF, JPEG, PNG o WebP.'))
            return
        }
        cb(null, true)
    },
})

export function removeUploadedFile(file?: { path?: string }): void {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path)
}

/** Ruta absoluta de un archivo guardado en `uploads`, sin permitir salir del directorio. */
export function uploadedFilePath(filename: string): string {
    return path.join(uploadsDir, path.basename(filename))
}

const MIME_POR_EXTENSION: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

export function mimeDeArchivo(filename: string): string {
    return MIME_POR_EXTENSION[path.extname(filename).toLowerCase()] || 'application/octet-stream'
}

export function validateUploadedFileContent(req: Request, res: Response, next: NextFunction): void {
    if (!req.file) return next()
    const bytes = Buffer.alloc(12)
    const descriptor = fs.openSync(req.file.path, 'r')
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0)
    fs.closeSync(descriptor)
    const header = bytes.subarray(0, length)
    const signatures: Record<string, boolean> = {
        'application/pdf': header.subarray(0, 4).toString() === '%PDF',
        'image/jpeg': header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
        'image/png': header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        'image/webp': header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP',
    }
    if (!signatures[req.file.mimetype]) {
        removeUploadedFile(req.file)
        res.status(422).json({ success: false, code: 'INVALID_FILE_CONTENT', message: 'El contenido del archivo no coincide con su formato' })
        return
    }
    next()
}

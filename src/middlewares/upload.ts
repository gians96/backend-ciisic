import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { DIRECTORIO_UPLOADS, MAX_BYTES_VOUCHER } from '../core/almacenamiento'
import { HttpError } from '../core/http-error'
import type { NextFunction, Request, Response } from 'express'

// Directorio raíz de archivos subidos (volumen persistente en producción)
export const uploadsDir = DIRECTORIO_UPLOADS
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

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
        cb(new HttpError(422, 'INVALID_FILE_TYPE', 'Archivo no permitido. Use PDF, JPEG, PNG o WebP.'))
        return
    }
    cb(null, true)
}

export const upload = multer({
    storage,
    limits: { fileSize: MAX_BYTES_VOUCHER, files: 1 },
    fileFilter,
})

/** Máximo de vouchers en una sola petición de una delegación (spec 023). */
export const MAX_VOUCHERS_POR_ENVIO = 6

/** Varios vouchers (campo `vouchers`): una delegación puede pagar en varias partes (spec 023). */
export const uploadVarios = multer({
    storage,
    limits: { fileSize: MAX_BYTES_VOUCHER, files: MAX_VOUCHERS_POR_ENVIO },
    fileFilter,
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

/** Si los primeros bytes del archivo guardado corresponden a su tipo declarado. */
function firmaValida(file: { path: string, mimetype: string }): boolean {
    const bytes = Buffer.alloc(12)
    const descriptor = fs.openSync(file.path, 'r')
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0)
    fs.closeSync(descriptor)
    const header = bytes.subarray(0, length)
    const signatures: Record<string, boolean> = {
        'application/pdf': header.subarray(0, 4).toString() === '%PDF',
        'image/jpeg': header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
        'image/png': header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        'image/webp': header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP',
    }
    return Boolean(signatures[file.mimetype])
}

export function validateUploadedFileContent(req: Request, res: Response, next: NextFunction): void {
    if (!req.file) return next()
    if (!firmaValida(req.file)) {
        removeUploadedFile(req.file)
        res.status(422).json({ success: false, code: 'INVALID_FILE_CONTENT', message: 'El contenido del archivo no coincide con su formato' })
        return
    }
    next()
}

/** Archivos que dejó `uploadVarios` en `req.files` (vacío si no hubo). */
export function archivosSubidos(req: Request): Express.Multer.File[] {
    return Array.isArray(req.files) ? req.files : []
}

/** Borra del disco todos los archivos de `req.files` (cuando la petición falla). */
export function removeUploadedFiles(req: Request): void {
    for (const file of archivosSubidos(req)) removeUploadedFile(file)
}

/** Igual que `validateUploadedFileContent` para varios archivos: si uno no coincide, se borran todos. */
export function validateUploadedFilesContent(req: Request, res: Response, next: NextFunction): void {
    const archivos = archivosSubidos(req)
    if (archivos.every(firmaValida)) return next()
    removeUploadedFiles(req)
    res.status(422).json({ success: false, code: 'INVALID_FILE_CONTENT', message: 'El contenido del archivo no coincide con su formato' })
}

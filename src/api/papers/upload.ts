import multer from 'multer'
import path from 'path'

export const PAPER_MAX_BYTES = 5 * 1024 * 1024

// Validate the bounded in-memory upload before writing anything to disk.
export const paperUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PAPER_MAX_BYTES, files: 1, fields: 1, fieldSize: 16 * 1024, parts: 2 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'application/pdf' || path.extname(file.originalname).toLowerCase() !== '.pdf') {
      callback(Object.assign(new Error('Solo se permiten archivos PDF.'), { statusCode: 422, code: 'INVALID_PDF' }))
      return
    }
    callback(null, true)
  },
})

export function hasPdfSignature(buffer: Buffer): boolean {
  return /^%PDF-\d\.\d/.test(buffer.subarray(0, 8).toString('ascii')) && buffer.subarray(-1024).includes(Buffer.from('%%EOF'))
}

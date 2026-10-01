import multer from 'multer'
import path from 'path'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { MAX_ARCHIVOS_CARGA_FIRMADOS, MAX_BYTES_CARGA_FIRMADOS, MAX_BYTES_PDF_FIRMADO } from '../../core/almacenamiento'
import { HttpError } from '../../core/http-error'
import { limitarConcurrencia, type Limitador } from '../../core/concurrencia'

/**
 * Subida de certificados firmados (spec 015). Todo en memoria y acotado: nada se escribe en disco
 * hasta emparejar el archivo con su certificado y comprobar que es el generado (firmados.ts).
 *
 * - Antes de multer, `limiteContenido` exige `Content-Length` (411 sin él o con
 *   `Transfer-Encoding`) y lo acota (413): el cuerpo nunca supera lo declarado.
 * - El tipo declarado no basta (un ZIP abierto en el navegador manda `application/octet-stream`):
 *   se acepta la extensión `.pdf` con un tipo PDF o genérico, y el servicio revisa la firma de bytes.
 * - Nombres en UTF-8 (`defParamCharset`): el código del certificado se busca en el nombre.
 * - `turnoCargaFirmados` (antes de multer): como mucho 2 cargas a la vez en todo el proceso y 4 en
 *   espera; con la cola llena, 503 `SIGNED_UPLOAD_BUSY`. Los cuerpos en espera no se leen.
 */
const TIPOS_ACEPTADOS = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', ''])

function esPdfDeclarado(file: Express.Multer.File): boolean {
    return path.extname(file.originalname).toLowerCase() === '.pdf' && TIPOS_ACEPTADOS.has(file.mimetype ?? '')
}

/**
 * Opciones de multer con `defParamCharset` (multer 2 lo admite; sus tipos aún no lo declaran):
 * sin él, un nombre con tildes llegaría como latin1.
 */
function enUtf8(opciones: multer.Options): multer.Options {
    const conCharset: multer.Options & { defParamCharset: string } = { ...opciones, defParamCharset: 'utf8' }
    return conCharset
}

/** Petición de carga por tandas: los archivos que no son PDF se omiten y se informan en el reporte. */
export interface CargaFirmadosRequest extends Request {
    archivosRechazados?: string[]
}

/**
 * Carga por tandas (`files[]`, ≤10 archivos de ≤10 MB y el campo `reemplazar`). Un archivo que no
 * es PDF no corta la tanda: queda en `req.archivosRechazados` y sale como INVALIDO en el reporte.
 */
export const firmadosUpload = multer(enUtf8({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_BYTES_PDF_FIRMADO,
        files: MAX_ARCHIVOS_CARGA_FIRMADOS,
        fields: 1,
        fieldSize: 16,
        parts: MAX_ARCHIVOS_CARGA_FIRMADOS + 1,
    },
    fileFilter: (req, file, callback) => {
        if (!esPdfDeclarado(file)) {
            const carga = req as CargaFirmadosRequest
            carga.archivosRechazados = [...(carga.archivosRechazados ?? []), file.originalname]
            callback(null, false)
            return
        }
        callback(null, true)
    },
}))

/** Reemplazo individual (`file` y los campos `reemplazar`, `forzar` y `motivo`). */
export const firmadoUpload = multer(enUtf8({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES_PDF_FIRMADO, files: 1, fields: 3, fieldSize: 2048, parts: 4 },
    fileFilter: (_req, file, callback) => {
        if (!esPdfDeclarado(file)) {
            callback(new HttpError(422, 'INVALID_FILE_TYPE', 'Sube el certificado firmado en PDF.'))
            return
        }
        callback(null, true)
    },
}))

/** Margen para los separadores y campos del multipart de un solo archivo. */
const MARGEN_MULTIPART = 64 * 1024

/** Tope del `Content-Length` del reemplazo individual. */
export const MAX_BYTES_REEMPLAZO_FIRMADO = MAX_BYTES_PDF_FIRMADO + MARGEN_MULTIPART

/**
 * Exige `Content-Length` y lo acota antes de leer el cuerpo: 411 `LENGTH_REQUIRED` sin él (o con
 * `Transfer-Encoding`, cuyo tamaño no se conoce de antemano) y 413 `UPLOAD_LIMIT_EXCEEDED` si supera
 * `maximo`. Se cierra la conexión para no leer un cuerpo que se va a descartar.
 */
export function limiteContenido(maximo: number = MAX_BYTES_CARGA_FIRMADOS): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const declarado = req.headers['content-length']
        const longitud = Number(declarado)
        if (req.headers['transfer-encoding'] || declarado === undefined || !/^\d+$/.test(declarado) || !Number.isSafeInteger(longitud)) {
            res.setHeader('Connection', 'close')
            next(new HttpError(411, 'LENGTH_REQUIRED', 'La subida debe indicar su tamaño (Content-Length).'))
            return
        }
        if (longitud > maximo) {
            res.setHeader('Connection', 'close')
            const mb = Math.floor(maximo / (1024 * 1024))
            next(new HttpError(413, 'UPLOAD_LIMIT_EXCEEDED', `La subida supera el límite de ${mb} MB. Envía menos archivos por tanda.`))
            return
        }
        next()
    }
}

/** Cargas de firmados a la vez y en espera (cada una puede traer 25 MB y analizar 10 PDF). */
export const MAX_CARGAS_FIRMADOS = 2
export const MAX_CARGAS_EN_ESPERA = 4

const cargaOcupada = () => new HttpError(503, 'SIGNED_UPLOAD_BUSY', 'Hay otras cargas de firmados en curso. Intenta nuevamente en unos segundos.', undefined, 5)

/** Semáforo de las cargas de firmados (se puede reemplazar en las pruebas). */
export function crearTurnoCargaFirmados(limitador: Limitador = limitarConcurrencia(MAX_CARGAS_FIRMADOS, MAX_CARGAS_EN_ESPERA, cargaOcupada)): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        limitador(() => new Promise<void>((resolve) => {
            // Una petición que se cortó mientras esperaba no ocupa el turno
            if (req.destroyed || res.destroyed || res.writableEnded) {
                resolve()
                return
            }
            res.once('finish', resolve)
            res.once('close', resolve)
            next()
        })).catch((error: unknown) => {
            // Rechazada antes de leer el cuerpo: se cierra la conexión para no leerlo
            res.setHeader('Connection', 'close')
            next(error)
        })
    }
}

export const turnoCargaFirmados = crearTurnoCargaFirmados()

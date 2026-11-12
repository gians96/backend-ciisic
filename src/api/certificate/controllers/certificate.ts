import type { Request, Response } from 'express'
import type { Actor } from '../../../core/actor'
import { idParam, unprocessable } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import { esLibroXlsx } from '../../../middlewares/upload'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId } from '../../event/services/public-event'
import * as certificados from '../services/certificados'
import { enviarCertificados, probarEnvio } from '../services/envio'
import { importarCertificados } from '../services/importacion'
import { leerExcelCertificados } from '../services/lector-excel'
import type { EnviarCertificadosInput } from '../validation'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de certificados sin guarda de permisos')
    return actor
}

const eventoDe = (req: Request) => idParam(req.params.eventId, 'eventId')

/** Datos de personas: nunca en cachés. */
function sinCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
}

function filtrosDe(query: Request['query']): certificados.FiltrosCertificados {
    const errores: Record<string, string> = {}
    const { situacion, q, sinInscripcion } = query
    let elegida: certificados.Situacion | undefined
    if (situacion !== undefined && situacion !== '') {
        if (typeof situacion === 'string' && (certificados.SITUACIONES as readonly string[]).includes(situacion)) elegida = situacion as certificados.Situacion
        else errores.situacion = `Debe ser ${certificados.SITUACIONES.join(', ')}`
    }
    if (q !== undefined && typeof q !== 'string') errores.q = 'Debe ser texto'
    if (sinInscripcion !== undefined && sinInscripcion !== '' && sinInscripcion !== 'true' && sinInscripcion !== 'false') errores.sinInscripcion = 'Debe ser true o false'
    if (Object.keys(errores).length) throw unprocessable('VALIDATION_ERROR', 'Los filtros no son válidos', errores)
    return {
        situacion: elegida,
        q: typeof q === 'string' ? q.trim().slice(0, 100) || undefined : undefined,
        sinInscripcion: sinInscripcion === 'true',
    }
}

/** `GET /v1/events/:eventId/certificates` — una página con su situación y los totales del evento en `meta.resumen`. */
export async function list(req: Request, res: Response) {
    const { data, meta } = await certificados.listarCertificados(eventoDe(req), filtrosDe(req.query), parsePagination(req.query, 20, 100))
    sinCache(res)
    res.json({ success: true, data, meta })
}

/** `GET …/certificates/ids` — todos los ids con los filtros dados, para elegirlos y enviar por tandas. */
export async function ids(req: Request, res: Response) {
    const lista = await certificados.idsCertificados(eventoDe(req), filtrosDe(req.query))
    sinCache(res)
    res.json({ success: true, data: lista, meta: { total: lista.length } })
}

/** `GET …/certificates/pending-inscriptions` — inscritos que pagaron y no tienen certificado. */
export async function pendingInscriptions(req: Request, res: Response) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) || undefined : undefined
    const { data, meta } = await certificados.listarPagadosSinCertificado(eventoDe(req), q, parsePagination(req.query, 20, 100))
    sinCache(res)
    res.json({ success: true, data, meta })
}

/** `POST …/certificates/import?simular=true` — Excel `.xlsx` (campo `file`). */
export async function importExcel(req: Request, res: Response) {
    const evento = await obtenerEventoPorId(eventoDe(req))
    if (!req.file) throw unprocessable('VALIDATION_ERROR', 'Adjunta el Excel de certificados.', { file: 'Requerido' })
    if (!esLibroXlsx(req.file.buffer)) throw unprocessable('INVALID_FILE_CONTENT', 'El contenido del archivo no coincide con un Excel (.xlsx).')
    const simular = req.query.simular === 'true'
    const filas = await leerExcelCertificados(req.file.buffer)
    const resultado = await importarCertificados(evento.id, filas, { aplicar: !simular, actorId: actorDe(req).id })
    sinCache(res)
    res.status(simular ? 200 : 201).json({ success: true, data: resultado })
}

/** `POST …/certificates/files` — varios PDF firmados (campo `files`), emparejados por el código del nombre. */
export async function uploadFiles(req: Request, res: Response) {
    const archivos = Array.isArray(req.files) ? req.files : []
    if (!archivos.length) throw unprocessable('VALIDATION_ERROR', 'Adjunta al menos un PDF.', { files: 'Requerido' })
    const reemplazar = req.body?.reemplazar === 'true' || req.body?.reemplazar === true
    const resultado = await certificados.subirArchivos(
        eventoDe(req),
        archivos.map((archivo) => ({ nombreOriginal: archivo.originalname, contenido: archivo.buffer })),
        { reemplazar, actorId: actorDe(req).id },
    )
    res.json({ success: true, data: resultado })
}

/** `GET …/certificates/:id` */
export async function detail(req: Request, res: Response) {
    const data = await certificados.detalleCertificado(eventoDe(req), idParam(req.params.id))
    sinCache(res)
    res.json({ success: true, data })
}

/** `PUT …/certificates/:id/file` — el PDF de un certificado elegido a mano (campo `file`). */
export async function uploadFile(req: Request, res: Response) {
    if (!req.file) throw unprocessable('VALIDATION_ERROR', 'Adjunta el PDF firmado.', { file: 'Requerido' })
    const data = await certificados.subirArchivoDe(eventoDe(req), idParam(req.params.id), { nombreOriginal: req.file.originalname, contenido: req.file.buffer }, actorDe(req).id)
    res.json({ success: true, data })
}

/** `GET …/certificates/:id/file` — el PDF guardado, para verlo en el navegador. */
export async function file(req: Request, res: Response) {
    const { contenido, nombre } = await certificados.archivoDe(eventoDe(req), idParam(req.params.id))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`)
    res.send(contenido)
}

/** `POST …/certificates/:id/annul` — `{ motivo }`. */
export async function annul(req: Request, res: Response) {
    const data = await certificados.anularCertificado(eventoDe(req), idParam(req.params.id), String(req.body.motivo), actorDe(req).id)
    res.json({ success: true, data })
}

/** `POST …/certificates/send` — `{ ids, reenviar }`: correo con el PDF y los enlaces. */
export async function send(req: Request, res: Response) {
    const data = await enviarCertificados(eventoDe(req), req.body as EnviarCertificadosInput, actorDe(req).id)
    res.json({ success: true, data })
}

/** `POST …/certificates/:id/test` — `{ correo }`: el mismo correo a una dirección de prueba. */
export async function test(req: Request, res: Response) {
    const data = await probarEnvio(eventoDe(req), idParam(req.params.id), String(req.body.correo), actorDe(req).id)
    res.json({ success: true, data })
}

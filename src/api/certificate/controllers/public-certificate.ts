import type { Request, Response } from 'express'
import { idParam, notFound } from '../../../core/http-error'
import { contentDisposition } from '../../advisory/exports/reporte'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as publico from '../services/publico'

/**
 * Rutas **sin sesión** de los certificados (spec 015): consulta por DNI (en el cuerpo, nunca en la URL: no debe
 * quedar en los registros de acceso) y el certificado por su código. Respuestas `no-store` y `noindex`.
 */
function privado(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
}

function enviarPdf(res: Response, contenido: Buffer, nombre: string, descargar: boolean) {
    privado(res)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', descargar ? contentDisposition(nombre) : `inline; filename="${nombre}"`)
    res.send(contenido)
}

/** `POST /v1/public/certificates/lookup` — `{ documento }` → los certificados listos de esa persona (todos los eventos). */
export async function lookup(req: Request, res: Response) {
    const documento: unknown = req.body?.documento
    const data = await publico.certificadosDelDocumento(typeof documento === 'string' || typeof documento === 'number' ? documento : '')
    privado(res)
    res.json({ success: true, data })
}

/** `GET /v1/public/certificates/:codigo` — datos del certificado (sin documento). */
export async function show(req: Request, res: Response) {
    const data = await publico.certificadoPorCodigo(String(req.params.codigo))
    privado(res)
    res.json({ success: true, data })
}

/** `GET /v1/public/certificates/:codigo/file?descargar=true` — el PDF firmado. */
export async function file(req: Request, res: Response) {
    const { contenido, nombre } = await publico.archivoPorCodigo(String(req.params.codigo))
    enviarPdf(res, contenido, nombre, req.query.descargar === 'true')
}

// ─── Portal del inscrito ────────────────────────────────────────────────────

function participanteId(req: AuthenticatedRequest): number {
    const id = req.participante?.id
    if (!id) throw notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')
    return id
}

/** `GET /v1/me/certificates` */
export async function mine(req: AuthenticatedRequest, res: Response) {
    const data = await publico.certificadosDelParticipante(participanteId(req))
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({ success: true, data })
}

/** `GET /v1/me/certificates/:id/file` */
export async function mineFile(req: AuthenticatedRequest, res: Response) {
    const { contenido, nombre } = await publico.archivoDelParticipante(participanteId(req), idParam(req.params.id))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', contentDisposition(nombre))
    res.send(contenido)
}

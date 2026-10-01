import type { Request, Response } from 'express'
import { idParam, unprocessable } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { catalogoFuentes } from '../pdf/fuentes'
import * as service from '../services/plantillas'

function archivoDe(req: Request): service.ArchivoSubido {
    if (!req.file) throw unprocessable('FILE_REQUIRED', 'Adjunta el PDF de diseño del certificado.', { file: 'Adjunta el PDF de diseño' })
    return req.file
}

/** Fuentes que el editor ofrece para cada campo (`GET /v1/certificate-fonts`). */
export async function fonts(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.json({ success: true, data: catalogoFuentes() })
}

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarPlantillas(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: AuthenticatedRequest, res: Response) {
    const eventoId = idParam(req.params.eventId, 'eventId')
    res.status(201).json({ success: true, data: await service.crearPlantilla(eventoId, archivoDe(req), req.body ?? {}, req.actor?.id) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await service.obtenerPlantilla(idParam(req.params.id)) })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.actualizarPlantilla(idParam(req.params.id), req.body, req.actor?.id) })
}

export async function remove(req: AuthenticatedRequest, res: Response) {
    await service.eliminarPlantilla(idParam(req.params.id), req.actor?.id)
    res.json({ success: true, data: null })
}

/** PDF de diseño (el editor lo dibuja con pdf.js). Se reemplaza sin cambiar de URL: no se guarda en caché. */
export async function design(req: Request, res: Response) {
    const id = idParam(req.params.id)
    const { bytes, plantilla } = await service.disenoDePlantilla(id)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="plantilla-${id}-v${plantilla.version}.pdf"`)
    res.send(bytes)
}

export async function replaceDesign(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.reemplazarDiseno(idParam(req.params.id), archivoDe(req), req.actor?.id) })
}

/**
 * Vista previa: `application/pdf`; los avisos del estampado van en `X-Avisos`
 * (`encodeURIComponent(JSON)`, el panel lo lee con `decodeURIComponent`) y su total en `X-Avisos-Total`.
 */
export async function preview(req: Request, res: Response) {
    const id = idParam(req.params.id)
    const { bytes, avisos } = await service.vistaPrevia(id, req.body)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="vista-previa-plantilla-${id}.pdf"`)
    res.setHeader('X-Avisos', service.encabezadoAvisos(avisos))
    res.setHeader('X-Avisos-Total', String(avisos.length))
    res.send(Buffer.from(bytes))
}

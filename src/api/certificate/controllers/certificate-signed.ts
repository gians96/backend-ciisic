import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import type { CargaFirmadosRequest } from '../upload-firmados'
import * as service from '../services/firmados'
import type { AnularCertificadoInput, CargaFirmadosInput, ReemplazarFirmadoInput } from '../validation/firmados'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de certificados firmados sin guarda de permisos')
    return actor
}

function archivosDe(req: Request): service.ArchivoSubido[] {
    const files = req.files
    if (Array.isArray(files)) return files
    return files ? Object.values(files).flat() : []
}

/** `POST /v1/events/:eventId/certificates/signed`: tanda de firmados → reporte por archivo. */
export async function uploadSigned(req: Request, res: Response) {
    const eventoId = idParam(req.params.eventId, 'eventId')
    const { reemplazar } = req.body as CargaFirmadosInput
    const rechazados = (req as CargaFirmadosRequest).archivosRechazados ?? []
    res.json({ success: true, data: await service.cargarFirmados(eventoId, archivosDe(req), rechazados, { reemplazar }, actorDe(req)) })
}

/** `PUT /v1/certificates/:id/signed`: firmado de un certificado concreto. */
export async function replaceSigned(req: Request, res: Response) {
    const id = idParam(req.params.id)
    res.json({ success: true, data: await service.reemplazarFirmado(id, req.file, req.body as ReemplazarFirmadoInput, actorDe(req)) })
}

/** `DELETE /v1/certificates/:id/signed`: quita el firmado (vuelve a PREPARADO). */
export async function removeSigned(req: Request, res: Response) {
    res.json({ success: true, data: await service.quitarFirmado(idParam(req.params.id), actorDe(req)) })
}

/** `POST /v1/certificates/:id/annul`. */
export async function annul(req: Request, res: Response) {
    const { motivo } = req.body as AnularCertificadoInput
    res.json({ success: true, data: await service.anularCertificado(idParam(req.params.id), motivo, actorDe(req)) })
}

import { Response } from 'express'
import { HttpError, idParam, notFound, unprocessable } from '../../../core/http-error'
import { leerArchivoServido } from '../../../core/almacenamiento'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/participant-portal'

function participanteId(req: AuthenticatedRequest): number {
    return req.participante?.id as number
}

/** Todo lo del portal es personal: ni el navegador ni un proxy lo guardan. */
function responder(res: Response, data: unknown) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({ success: true, data })
}

export async function me(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.miPerfil(participanteId(req)))
}

export async function updateProfile(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.actualizarPerfil(participanteId(req), req.body))
}

export async function inscriptions(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.misInscripciones(participanteId(req)))
}

export async function badge(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.miFotocheck(participanteId(req), idParam(req.params.id)))
}

export async function attendances(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.misAsistencias(participanteId(req)))
}

export async function credential(req: AuthenticatedRequest, res: Response) {
    const { ruta, nombre } = await service.miCredencial(participanteId(req), idParam(req.params.id))
    // Se lee a memoria sin esperas: una foto nueva borra los PDF guardados (ver `leerArchivoServido`)
    const pdf = leerArchivoServido(ruta, () => new HttpError(503, 'PDF_BUSY', 'Tu credencial se está actualizando. Intenta nuevamente en unos segundos.', undefined, 5))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    res.send(pdf)
}

export async function uploadPhoto(req: AuthenticatedRequest, res: Response) {
    if (!req.file) throw unprocessable('FILE_REQUIRED', 'Adjunta tu foto.', { file: 'Adjunta tu foto' })
    const body = (req.body ?? {}) as Record<string, unknown>
    responder(res, await service.guardarFoto(participanteId(req), req.file, body.consentimiento))
}

export async function photo(req: AuthenticatedRequest, res: Response) {
    const { ruta, mime } = await service.miFoto(participanteId(req))
    const foto = leerArchivoServido(ruta, () => notFound('PHOTO_NOT_FOUND', 'No tienes una foto registrada.'))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Disposition', 'inline')
    res.send(foto)
}

export async function deletePhoto(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.borrarFoto(participanteId(req)))
}

/** Certificados firmados propios (spec 015). */
export async function certificates(req: AuthenticatedRequest, res: Response) {
    responder(res, await service.misCertificados(participanteId(req)))
}

export async function certificateFile(req: AuthenticatedRequest, res: Response) {
    const { ruta, nombre } = await service.miCertificadoFirmado(participanteId(req), idParam(req.params.id))
    // Un reemplazo del firmado borra el archivo anterior: se lee a memoria sin esperas
    const pdf = leerArchivoServido(ruta, service.certificadoNoEncontrado)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    res.send(pdf)
}

import type { Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { crearEnlaces, listarEnlaces, revocarEnlace } from '../services/enlaces'
import type { CrearEnlacesInput } from '../validation'

/** Los enlaces son credenciales: ninguna respuesta de esta ruta se guarda en cachés. */
function sinCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
}

/** `GET /v1/events/:eventId/advisory/links` — el enlace de cada asesor (o `null`) y su último acceso. */
export async function listLinks(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    sinCache(res)
    res.json({ success: true, data: await listarEnlaces(evento.id) })
}

/** `POST /v1/events/:eventId/advisory/links` — crea los que faltan; con `regenerar`, renueva (el anterior deja de valer). */
export async function createLinks(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const { asesorIds, regenerar } = req.body as CrearEnlacesInput
    sinCache(res)
    res.status(201).json({ success: true, data: await crearEnlaces(evento.id, { asesorIds, regenerar }) })
}

/** `DELETE /v1/events/:eventId/advisory/links/:asesorId` — desactiva el enlace de un asesor. */
export async function revokeLink(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    await revocarEnlace(evento.id, idParam(req.params.asesorId, 'asesorId'))
    sinCache(res)
    res.json({ success: true, data: await listarEnlaces(evento.id) })
}

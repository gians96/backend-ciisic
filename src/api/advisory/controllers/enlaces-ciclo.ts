import type { Response } from 'express'
import { idParam, unprocessable } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { crearEnlacesCiclo, listarEnlacesCiclo, revocarEnlaceCiclo } from '../services/enlaces-ciclo'
import type { CrearEnlacesCicloInput } from '../validation'

/** Los enlaces son credenciales: ninguna respuesta de esta ruta se guarda en cachés. */
function sinCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
}

/** `GET /v1/events/:eventId/advisory/cycle-links` — cada ciclo del padrón con su enlace (o `null`) y su último acceso. */
export async function listCycleLinks(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    sinCache(res)
    res.json({ success: true, data: await listarEnlacesCiclo(evento.id) })
}

/** `POST /v1/events/:eventId/advisory/cycle-links` — crea los que faltan; con `regenerar`, renueva (el anterior deja de valer). */
export async function createCycleLinks(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const { ciclos, regenerar } = req.body as CrearEnlacesCicloInput
    sinCache(res)
    res.status(201).json({ success: true, data: await crearEnlacesCiclo(evento.id, { ciclos, regenerar }) })
}

/** `DELETE /v1/events/:eventId/advisory/cycle-links/:ciclo` — desactiva el enlace de un ciclo. */
export async function revokeCycleLink(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const ciclo = String(req.params.ciclo ?? '').trim()
    if (!ciclo || ciclo.length > 10) throw unprocessable('VALIDATION_ERROR', 'El ciclo no es válido', { ciclo: 'Debe tener entre 1 y 10 caracteres' })
    await revocarEnlaceCiclo(evento.id, ciclo)
    sinCache(res)
    res.json({ success: true, data: await listarEnlacesCiclo(evento.id) })
}

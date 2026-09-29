import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import { obtenerEventoPorId, obtenerEventoPrincipal } from '../../event/services/public-event'
import * as service from '../services/contact'
import { eventoDelSitio } from '../../../middlewares/sitio'

export async function publicCreate(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    res.status(201).json({ success: true, data: await service.crearMensaje(evento.id, req.body) })
}

/** Legacy: `{ firstName, lastName, email, subject, message }` → evento principal. */
export async function create(req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal().catch(() => null)
    const { firstName, lastName, email, subject, message } = req.body
    const creado = await service.crearMensaje(evento?.id ?? null, { nombres: firstName, apellidos: lastName, correo: email, asunto: subject, mensaje: message })
    res.status(201).json({ success: true, data: creado })
}

function leidoDe(query: Request['query']): boolean | undefined {
    if (query.leido === 'true') return true
    if (query.leido === 'false') return false
    return undefined
}

export async function listByEvent(req: Request, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    res.json({ success: true, ...(await service.listarMensajes(evento.id, leidoDe(req.query), parsePagination(req.query))) })
}

/** Legacy: `GET /v1/contact` (todos los mensajes). */
export async function list(req: Request, res: Response) {
    const { data } = await service.listarMensajes(undefined, undefined, parsePagination(req.query, 100, 1000))
    res.json(data)
}

export async function find(req: Request, res: Response) {
    res.json(await service.obtenerMensaje(idParam(req.params.id)))
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.marcarLeido(idParam(req.params.id), req.body.leido) })
}

export async function remove(req: Request, res: Response) {
    await service.eliminarMensaje(idParam(req.params.id))
    res.json({ success: true, data: null })
}

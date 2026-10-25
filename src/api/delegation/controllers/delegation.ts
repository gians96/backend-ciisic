import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/delegation'

/** Sin «pagos.ver» las filas de los miembros no llevan montos ni datos de pago (spec 013). */
function conPago(req: Request): boolean {
    return (req as AuthenticatedRequest).actor?.permisos.has('pagos.ver') === true
}

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarDelegaciones(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearDelegacion(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: service.aDelegacion(await service.obtenerDelegacion(idParam(req.params.id))) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarDelegacion(idParam(req.params.id), req.body) })
}

/** Participantes inscritos en la delegación (spec 018), paginados como el listado de inscritos. */
export async function members(req: Request, res: Response) {
    const resultado = await service.listarMiembros(idParam(req.params.id), parsePagination(req.query), conPago(req))
    res.json({ success: true, ...resultado })
}

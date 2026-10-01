import type { Request, Response } from 'express'
import { badRequest, idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/tipos'

/** `?activo=true|false` filtra; sin él, todos. */
function filtroActivo(valor: unknown): boolean | undefined {
    if (valor === undefined || valor === '') return undefined
    if (valor === 'true') return true
    if (valor === 'false') return false
    throw badRequest('INVALID_FILTER', 'El filtro activo debe ser true o false.')
}

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarTipos({ activo: filtroActivo(req.query.activo) }) })
}

export async function create(req: AuthenticatedRequest, res: Response) {
    res.status(201).json({ success: true, data: await service.crearTipo(req.body, req.actor?.id) })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.actualizarTipo(idParam(req.params.id), req.body, req.actor?.id) })
}

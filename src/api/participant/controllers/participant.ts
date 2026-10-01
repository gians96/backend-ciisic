import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/participant'
import type { ActualizarParticipanteInput, CrearParticipanteInput } from '../validation'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: AuthenticatedRequest): Actor {
    if (!req.actor) throw new Error('Ruta de participantes sin guarda de permisos')
    return req.actor
}

export async function list(req: Request, res: Response) {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined
    res.json({ success: true, ...(await service.listarParticipantes(q, parsePagination(req.query))) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearParticipante(req.body as CrearParticipanteInput) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await service.obtenerParticipante(idParam(req.params.id)) })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    const id = idParam(req.params.id)
    res.json({ success: true, data: await service.actualizarParticipante(id, req.body as ActualizarParticipanteInput, actorDe(req).id) })
}

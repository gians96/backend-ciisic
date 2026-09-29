import { Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/access-token'

export async function list(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.listarTokensAcceso(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: AuthenticatedRequest, res: Response) {
    const creado = await service.crearTokenAcceso(idParam(req.params.eventId, 'eventId'), req.body, req.user?.id)
    res.setHeader('Cache-Control', 'no-store')
    res.status(201).json({ success: true, data: creado })
}

export async function revoke(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.revocarTokenAcceso(idParam(req.params.id)) })
}

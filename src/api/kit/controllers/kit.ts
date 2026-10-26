import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/kit'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de kits sin guarda de permisos')
    return actor
}

export async function deliver(req: Request, res: Response) {
    res.json({ success: true, data: await service.entregarKit(idParam(req.params.id), actorDe(req)) })
}

export async function undo(req: Request, res: Response) {
    res.json({ success: true, data: await service.deshacerEntregaKit(idParam(req.params.id)) })
}

export async function summary(req: Request, res: Response) {
    res.json({ success: true, data: await service.resumenKits(idParam(req.params.eventId, 'eventId')) })
}

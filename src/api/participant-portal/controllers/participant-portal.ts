import { Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/participant-portal'

function participanteId(req: AuthenticatedRequest): number {
    return req.participante?.id as number
}

export async function me(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({ success: true, data: await service.miPerfil(participanteId(req)) })
}

export async function inscriptions(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.json({ success: true, data: await service.misInscripciones(participanteId(req)) })
}

export async function credential(req: AuthenticatedRequest, res: Response) {
    const { ruta, nombre } = await service.miCredencial(participanteId(req), idParam(req.params.id))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    res.sendFile(ruta)
}

import { Request, Response } from 'express'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/participant-auth'

// Las esperas (`EsperaRequerida`) llegan al `errorHandler`, que las anuncia en `Retry-After`

/** Siempre 202 con el mismo cuerpo, exista o no el correo. */
export async function requestCode(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    const data = await service.solicitarCodigo(req.body.correo, req.ip)
    res.status(202).json({ success: true, data })
}

export async function verifyCode(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    const data = await service.verificarCodigo(req.body.correo, req.body.codigo, req.ip)
    res.json({ success: true, data })
}

export async function switchToPortal(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.cambiarAPortal(req.actor as Actor, req.metodoSesion) })
}

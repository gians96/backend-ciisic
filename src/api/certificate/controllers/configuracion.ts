import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/configuracion'

export async function find(_req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.obtenerConfiguracionCertificados() })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.actualizarConfiguracionCertificados(req.body, req.actor?.id) })
}

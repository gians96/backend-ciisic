import { Request, Response } from 'express'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { configuracionPublica } from '../../../core/configuracion-sistema'
import * as service from '../services/system-settings'

export async function find(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.obtenerConfiguracionAdmin() })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.actualizarConfiguracion(req.body, req.user?.id) })
}

export async function testUndc(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.probarUndc() })
}

/** Configuración pública (client ID de Google y URL del panel): nada secreto. */
export async function publicConfig(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.json({ success: true, data: await configuracionPublica() })
}

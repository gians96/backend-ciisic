import { Request, Response } from 'express'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import type { SitioRequest } from '../../../middlewares/sitio'
import { configuracionPanel, configuracionPublica } from '../../../core/configuracion-sistema'
import { accesoCodigoDisponible } from '../../participant-auth/services/participant-auth'
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

/** API de certificados de la UNDC (spec 015): 501 `CERTIFICATE_PROVIDER_PENDING` mientras no haya API. */
export async function testCertificadosUndc(_req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.probarCertificadosUndc() })
}

/**
 * Configuración pública (client ID de Google y URL del panel): nada secreto. La landing
 * (`/v1/site/config`, con el token del evento) la recibe sin cambios; el panel (`/v1/auth/config`)
 * además sabe si puede ofrecer el acceso con código por correo (spec 014).
 */
export async function publicConfig(req: SitioRequest, res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=60')
    const data = req.tokenAccesoId ? await configuracionPublica() : await configuracionPanel(accesoCodigoDisponible)
    res.json({ success: true, data })
}

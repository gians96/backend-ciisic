import type { NextFunction, Request, Response } from 'express'
import { obtenerConfiguracion } from '../core/configuracion-sistema'

/**
 * Marca una ruta legacy (landing anterior y herramientas previas, spec 002). Se desactivan desde
 * el panel (Sistema → Landing anterior): responden 410 sin desplegar código.
 */
export async function rutaLegacy(_req: Request, res: Response, next: NextFunction): Promise<void> {
    if ((await obtenerConfiguracion()).rutasLegacyActivas) return next()
    res.status(410).json({
        success: false,
        code: 'LEGACY_ROUTE_DISABLED',
        message: 'Esta ruta fue retirada. Usa la API del sitio del evento (/api/v1/site).',
    })
}

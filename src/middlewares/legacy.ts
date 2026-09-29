import type { NextFunction, Request, Response } from 'express'
import { env } from '../../config/env'

/**
 * Marca una ruta legacy (landing anterior y herramientas previas, spec 002). Con
 * `LEGACY_ROUTES_ENABLED=false` responde 410 para retirarlas sin desplegar código.
 */
export function rutaLegacy(_req: Request, res: Response, next: NextFunction): void {
    if (env.LEGACY_ROUTES_ENABLED) return next()
    res.status(410).json({
        success: false,
        code: 'LEGACY_ROUTE_DISABLED',
        message: 'Esta ruta fue retirada. Usa la API del sitio del evento (/api/v1/site).',
    })
}

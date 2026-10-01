import { Request, Response } from 'express'
import { verificarCertificado } from '../services/verificacion'

/**
 * `GET /v1/public/certificates/:codigo` (sin sesión). El estado puede cambiar (anulación), así que
 * no se guarda en cachés.
 */
export async function verify(req: Request, res: Response) {
    const data = await verificarCertificado(req.params.codigo)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data })
}

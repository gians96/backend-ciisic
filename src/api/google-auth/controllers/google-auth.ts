import { Request, Response } from 'express'
import { eventoDelSitio } from '../../../middlewares/sitio'
import * as service from '../services/google-auth'

export async function login(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.iniciarSesionConGoogle(req.body.idToken, req.body.nonce) })
}

export async function siteVerification(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: await service.verificarCorreoConGoogle(eventoDelSitio(req), req.body.idToken) })
}

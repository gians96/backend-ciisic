import { Request, Response } from 'express'
import { unprocessable } from '../../../core/http-error'
import { eventoDelSitio } from '../../../middlewares/sitio'
import { guardarQr, mimeDeQr, rutaQr, rutaQrDelEvento } from '../services/payment-qr'

export async function upload(req: Request, res: Response) {
    if (!req.file) throw unprocessable('FILE_REQUIRED', 'Adjunta la imagen del QR.', { file: 'Adjunta la imagen del QR' })
    res.status(201).json({ success: true, data: await guardarQr(req.file) })
}

// Cada imagen tiene un nombre único que no se reutiliza: se puede guardar en caché sin revalidar
function enviarImagen(res: Response, ruta: string, cache: string) {
    res.setHeader('Cache-Control', cache)
    res.setHeader('Content-Type', mimeDeQr(ruta))
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(ruta)
}

export async function adminFile(req: Request, res: Response) {
    enviarImagen(res, await rutaQr(String(req.params.archivo)), 'private, max-age=86400, immutable')
}

export async function siteFile(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    enviarImagen(res, await rutaQrDelEvento(evento.datosPago, String(req.params.archivo)), 'public, max-age=86400, immutable')
}

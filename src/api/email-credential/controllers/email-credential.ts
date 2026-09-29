import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import * as service from '../services/email-credential'

export async function list(_req: Request, res: Response) {
    res.json({ success: true, data: await service.listarCredenciales() })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearCredencial(req.body) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarCredencial(idParam(req.params.id), req.body) })
}

export async function remove(req: Request, res: Response) {
    await service.eliminarCredencial(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function test(req: Request, res: Response) {
    res.json({ success: true, data: await service.probarCredencial(idParam(req.params.id)) })
}

export async function sendTest(req: Request, res: Response) {
    res.json({ success: true, data: await service.enviarCorreoDePrueba(idParam(req.params.id), req.body.correo) })
}

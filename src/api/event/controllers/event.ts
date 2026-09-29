import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { actualizarEvento, crearEvento, eliminarEvento, listarEventos, obtenerEvento, resumenEvento } from '../services/event'
import { aEventoPublico } from '../services/public-event'
import { eventoDelSitio } from '../../../middlewares/sitio'

export async function list(_req: Request, res: Response) {
    res.json({ success: true, data: await listarEventos() })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await obtenerEvento(idParam(req.params.id)) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await crearEvento(req.body) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await actualizarEvento(idParam(req.params.id), req.body) })
}

export async function remove(req: Request, res: Response) {
    await eliminarEvento(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function summary(req: Request, res: Response) {
    res.json({ success: true, data: await resumenEvento(idParam(req.params.id)) })
}

export async function publicFind(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: aEventoPublico(evento) })
}

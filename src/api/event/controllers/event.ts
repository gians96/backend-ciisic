import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { actualizarEvento, crearEvento, eliminarEvento, listarEventos, listarEventosOperativos, obtenerEvento, resumenEvento } from '../services/event'
import { aEventoPublico } from '../services/public-event'
import { eventoDelSitio } from '../../../middlewares/sitio'

/**
 * Quien configura eventos recibe la vista completa (sin cambios para el panel actual); el resto del
 * staff (Tesorero, Comisión) solo sus eventos y con la vista operativa.
 */
export async function list(req: AuthenticatedRequest, res: Response) {
    const actor = req.actor
    if (!actor) throw new Error('GET /v1/events necesita requireActor')
    const data = actor.permisos.has('eventos.configurar') ? await listarEventos() : await listarEventosOperativos(actor)
    res.json({ success: true, data })
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

export async function summary(req: AuthenticatedRequest, res: Response) {
    // Sin «pagos.ver» (Comisión) los montos salen en null
    res.json({ success: true, data: await resumenEvento(idParam(req.params.id), req.actor?.permisos.has('pagos.ver') === true) })
}

export async function publicFind(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: aEventoPublico(evento) })
}

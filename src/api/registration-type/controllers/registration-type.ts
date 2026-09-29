import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { obtenerEventoPrincipal, obtenerEventoPublico } from '../../event/services/public-event'
import * as service from '../services/registration-type'

// Público
export async function publicList(req: Request, res: Response) {
    const evento = await obtenerEventoPublico(String(req.params.codigo))
    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria : undefined
    res.json({ success: true, data: await service.tiposPublicos(evento.id, categoria) })
}

// Legacy (evento principal, forma de respuesta anterior)
export async function legacyList(_req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    res.json(await service.tiposLegacy(evento.id))
}

export async function legacyFind(req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    res.json(await service.tipoLegacy(evento.id, idParam(req.params.id)))
}

// Administración
export async function listCategories(req: Request, res: Response) {
    res.json({ success: true, data: await service.categoriasDeEvento(idParam(req.params.eventId, 'eventId')) })
}

export async function createCategory(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearCategoria(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function updateCategory(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarCategoria(idParam(req.params.id), req.body) })
}

export async function removeCategory(req: Request, res: Response) {
    await service.eliminarCategoria(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function createType(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearTipo(idParam(req.params.id), req.body) })
}

export async function updateType(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarTipo(idParam(req.params.id), req.body) })
}

export async function removeType(req: Request, res: Response) {
    await service.eliminarTipo(idParam(req.params.id))
    res.json({ success: true, data: null })
}

import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import * as service from '../services/integration'

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarIntegraciones(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearIntegracion(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarIntegracion(idParam(req.params.id), req.body) })
}

export async function remove(req: Request, res: Response) {
    await service.eliminarIntegracion(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function test(req: Request, res: Response) {
    res.json({ success: true, data: await service.probarIntegracion(idParam(req.params.id)) })
}

export async function sportsSummary(req: Request, res: Response) {
    res.json({ success: true, data: await service.resumenSemanaSistemica(idParam(req.params.eventId, 'eventId')) })
}

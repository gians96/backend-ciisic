import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import * as service from '../services/activity'

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarActividades(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearActividad(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarActividad(idParam(req.params.id), req.body) })
}

export async function remove(req: Request, res: Response) {
    await service.eliminarActividad(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function listAttendances(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarAsistencias(idParam(req.params.id)) })
}

export async function createAttendance(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.registrarAsistencia(idParam(req.params.id), req.body) })
}

export async function removeAttendance(req: Request, res: Response) {
    await service.eliminarAsistencia(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function exportAttendance(req: Request, res: Response) {
    res.json({ success: true, data: await service.matrizAsistencia(idParam(req.params.eventId, 'eventId')) })
}

// ─── Legacy ─────────────────────────────────────────────────────────────────

export async function legacyCreate(req: Request, res: Response) {
    res.status(201).json(await service.registrarAsistencia(Number(req.body.id_evento), { participanteId: Number(req.body.id_usuario), fueraDeHorario: false }))
}

export async function legacyOvertime(req: Request, res: Response) {
    res.status(201).json(await service.registrarAsistencia(Number(req.body.id_evento), { participanteId: Number(req.body.id_usuario), fueraDeHorario: true }))
}

export async function legacyFind(req: Request, res: Response) {
    res.json(await service.obtenerAsistencia(idParam(req.params.id)))
}

export async function legacyExport(req: Request, res: Response) {
    const matriz = await service.matrizLegacy(req.body.eventos)
    res.json({ success: true, data: matriz.participantes, eventos: matriz.actividades, message: `Se encontraron ${matriz.participantes.length} participantes` })
}

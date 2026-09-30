import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as service from '../services/activity'
import type { RegistrarAsistenciaInput } from '../validation'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de asistencia sin guarda de permisos')
    return actor
}

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
    res.json({ success: true, data: await service.listarAsistencias(idParam(req.params.id), actorDe(req)) })
}

export async function createAttendance(req: Request, res: Response) {
    const input = req.body as RegistrarAsistenciaInput
    // Sin método declarado: el id sale del QR de la credencial y el documento se digita
    const metodo = input.metodo ?? (input.participanteId ? 'QR' : 'DOCUMENTO')
    res.status(201).json({ success: true, data: await service.registrarAsistencia(idParam(req.params.id), input, { actor: actorDe(req), metodo }) })
}

export async function removeAttendance(req: Request, res: Response) {
    await service.eliminarAsistencia(idParam(req.params.id), actorDe(req).id)
    res.json({ success: true, data: null })
}

export async function exportAttendance(req: Request, res: Response) {
    res.json({ success: true, data: await service.matrizAsistencia(idParam(req.params.eventId, 'eventId'), actorDe(req)) })
}

// ─── Legacy ─────────────────────────────────────────────────────────────────

// Vienen del lector QR de la herramienta anterior (id_usuario = participante)
function registrarLegacy(req: Request, fueraDeHorario: boolean) {
    const input = { participanteId: Number(req.body.id_usuario), fueraDeHorario }
    return service.registrarAsistencia(Number(req.body.id_evento), input, { actor: actorDe(req), metodo: 'QR' })
}

export async function legacyCreate(req: Request, res: Response) {
    res.status(201).json(await registrarLegacy(req, false))
}

export async function legacyOvertime(req: Request, res: Response) {
    res.status(201).json(await registrarLegacy(req, true))
}

export async function legacyFind(req: Request, res: Response) {
    res.json(await service.obtenerAsistencia(idParam(req.params.id)))
}

export async function legacyExport(req: Request, res: Response) {
    const matriz = await service.matrizLegacy(req.body.eventos, actorDe(req))
    res.json({ success: true, data: matriz.participantes, eventos: matriz.actividades, message: `Se encontraron ${matriz.participantes.length} participantes` })
}

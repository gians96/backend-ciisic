import type { Request, Response } from 'express'
import { badRequest, idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { REGEX_FECHA } from '../../../core/fechas'
import { parsePagination } from '../../../core/pagination'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { eventoDelSitio } from '../../../middlewares/sitio'
import * as talks from '../services/talks'
import * as registrations from '../services/registrations'
import * as checkin from '../services/checkin'
import {
    MODALIDADES, ORIGENES_INSCRIPCION_PONENCIA, ESTADOS_INSCRIPCION_PONENCIA, PROCEDENCIAS,
    type AsistenteInput, type EditarInscripcionInput, type InscripcionSitioInput,
} from '../validation'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de ponencias especializadas sin guarda de permisos')
    return actor
}

function texto(valor: unknown): string | undefined {
    if (valor === undefined || valor === '') return undefined
    if (typeof valor !== 'string') throw badRequest('INVALID_FILTER', 'Filtro inválido.')
    return valor.trim() || undefined
}

function opcion<T extends string>(valor: unknown, permitidos: readonly T[], nombre: string): T | undefined {
    const dato = texto(valor)
    if (dato === undefined) return undefined
    if (!(permitidos as readonly string[]).includes(dato)) throw badRequest('INVALID_FILTER', `El filtro ${nombre} no es válido.`)
    return dato as T
}

function fechaFiltro(valor: unknown): string | undefined {
    const dato = texto(valor)
    if (dato !== undefined && !REGEX_FECHA.test(dato)) throw badRequest('INVALID_FILTER', 'El filtro fecha debe tener el formato AAAA-MM-DD.')
    return dato
}

// ─── Ponencias ──────────────────────────────────────────────────────────────

export async function list(req: Request, res: Response) {
    const filtros = { fecha: fechaFiltro(req.query.fecha), modalidad: opcion(req.query.modalidad, MODALIDADES, 'modalidad') }
    res.json({ success: true, data: await talks.listarPonencias(idParam(req.params.eventId, 'eventId'), filtros) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await talks.crearPonencia(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await talks.actualizarPonencia(idParam(req.params.id), req.body) })
}

export async function remove(req: Request, res: Response) {
    await talks.eliminarPonencia(idParam(req.params.id))
    res.json({ success: true, data: null })
}

// ─── Inscripciones ──────────────────────────────────────────────────────────

export async function listRegistrations(req: Request, res: Response) {
    const { q } = req.query
    const ponenciaId = texto(req.query.ponenciaId)
    const filtros: registrations.FiltrosInscripciones = {
        ponenciaId: ponenciaId === undefined ? undefined : idParam(ponenciaId, 'ponenciaId'),
        fecha: fechaFiltro(req.query.fecha),
        modalidad: opcion(req.query.modalidad, MODALIDADES, 'modalidad'),
        estado: opcion(req.query.estado, ESTADOS_INSCRIPCION_PONENCIA, 'estado'),
        asistencia: opcion(req.query.asistencia, ['si', 'no'] as const, 'asistencia'),
        procedencia: opcion(req.query.procedencia, [...PROCEDENCIAS, 'SIN_DATO'] as const, 'procedencia'),
        origen: opcion(req.query.origen, ORIGENES_INSCRIPCION_PONENCIA, 'origen'),
        q: texto(q)?.slice(0, 100),
    }
    const { data, meta } = await registrations.listarInscripciones(idParam(req.params.eventId, 'eventId'), filtros, parsePagination(req.query, 20, 100))
    res.json({ success: true, data, meta })
}

export async function register(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await registrations.inscribirManual(idParam(req.params.id), req.body as AsistenteInput, actorDe(req)) })
}

export async function updateRegistration(req: Request, res: Response) {
    res.json({ success: true, data: await registrations.actualizarInscripcion(idParam(req.params.id), req.body as EditarInscripcionInput, actorDe(req)) })
}

export async function checkIn(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await checkin.registrarAsistencia(idParam(req.params.id), req.body as AsistenteInput, actorDe(req)) })
}

export async function removeAttendance(req: Request, res: Response) {
    await registrations.anularAsistencia(idParam(req.params.id), actorDe(req))
    res.json({ success: true, data: null })
}

// ─── Sitio (token del evento) ───────────────────────────────────────────────

export async function publicList(req: Request, res: Response) {
    res.json({ success: true, data: await talks.listarPublicas(eventoDelSitio(req).id) })
}

export async function publicRegister(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await registrations.inscribirDesdeSitio(eventoDelSitio(req), req.body as InscripcionSitioInput) })
}

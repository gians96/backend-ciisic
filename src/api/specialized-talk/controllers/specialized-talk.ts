import type { Request, Response } from 'express'
import { badRequest, idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { REGEX_FECHA, fechaLima } from '../../../core/fechas'
import { parsePagination } from '../../../core/pagination'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { eventoDelSitio } from '../../../middlewares/sitio'
import * as talks from '../services/talks'
import * as registrations from '../services/registrations'
import * as checkin from '../services/checkin'
import * as acceso from '../services/acceso'
import * as resumen from '../services/resumen'
import * as avisos from '../services/avisos'
import { generarExcelResumen } from '../services/exportar-resumen'
import { contentDisposition, nombreDeArchivo } from '../../advisory/exports/reporte'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { SITUACIONES_CONGRESO } from '../../../core/ponencias-especializadas'
import { verificarCongresista } from '../services/congresista'
import {
    MODALIDADES, ORIGENES_INSCRIPCION_PONENCIA, ESTADOS_INSCRIPCION_PONENCIA, PROCEDENCIAS,
    type AsistenteInput, type AvisarSinCongresoInput, type CancelarSinCongresoInput, type EditarInscripcionInput, type ElegibilidadInput, type InscripcionSitioInput,
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
        validacion: opcion(req.query.validacion, ['si', 'no'] as const, 'validacion'),
        modo: opcion(req.query.modo, MODALIDADES, 'modo'),
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

// ─── Resumen por persona, cancelación y comunicado (spec 031) ───────────────

function filtrosResumen(query: Request['query']): resumen.FiltrosResumen {
    return {
        situacion: opcion(query.situacion, SITUACIONES_CONGRESO, 'situacion'),
        puede: opcion(query.puede, ['si', 'no'] as const, 'puede'),
        validacion: opcion(query.validacion, ['si', 'no'] as const, 'validacion'),
        modo: opcion(query.modo, MODALIDADES, 'modo'),
        aviso: opcion(query.aviso, ['si', 'no'] as const, 'aviso'),
        q: texto(query.q)?.slice(0, 100),
    }
}

export async function attendees(req: Request, res: Response) {
    const { data, meta } = await resumen.listarResumen(idParam(req.params.eventId, 'eventId'), filtrosResumen(req.query), parsePagination(req.query, 20, 100))
    res.json({ success: true, data, meta })
}

/** `GET …/specialized-talk-attendees/export`: el Excel con los filtros de la consulta; siempre se calcula en el momento. */
export async function attendeesExport(req: Request, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const filtros = filtrosResumen(req.query)
    const { personas, accesoLibre } = await resumen.cargarPersonas(evento.id)
    const generadoEn = new Date()
    const contenido = await generarExcelResumen(evento, personas, resumen.filtrar(personas, filtros), filtros, accesoLibre, generadoEn)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', contentDisposition(nombreDeArchivo(`Ponencias especializadas ${evento.codigo} ${fechaLima(generadoEn)}`, 'xlsx')))
    res.setHeader('Cache-Control', 'no-store')
    res.send(contenido)
}

export async function cancelAttendees(req: Request, res: Response) {
    res.json({ success: true, data: await avisos.cancelarSinCongreso(idParam(req.params.eventId, 'eventId'), req.body as CancelarSinCongresoInput, actorDe(req)) })
}

export async function notifyAttendees(req: Request, res: Response) {
    res.json({ success: true, data: await avisos.avisarSinCongreso(idParam(req.params.eventId, 'eventId'), req.body as AvisarSinCongresoInput, actorDe(req)) })
}

// ─── Acceso libre del evento (spec 030) ─────────────────────────────────────

export async function getAccess(req: Request, res: Response) {
    res.json({ success: true, data: await acceso.obtenerAcceso(idParam(req.params.eventId, 'eventId')) })
}

export async function putAccess(req: Request, res: Response) {
    const { accesoLibre } = req.body as { accesoLibre: boolean }
    res.json({ success: true, data: await acceso.guardarAcceso(idParam(req.params.eventId, 'eventId'), accesoLibre, actorDe(req)) })
}

// ─── Sitio (token del evento) ───────────────────────────────────────────────

/** `meta.accesoLibre` le dice a la landing qué formulario mostrar; el servidor decide igual al inscribir. */
export async function publicList(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: await talks.listarPublicas(evento.id), meta: { accesoLibre: evento.ponenciasAccesoLibre === true } })
}

export async function eligibility(req: Request, res: Response) {
    const { tipoDocumento, numeroDocumento, correo } = req.body as ElegibilidadInput
    res.json({ success: true, data: await verificarCongresista(eventoDelSitio(req).id, { tipoDocumento, numeroDocumento, correo }) })
}

export async function publicRegister(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await registrations.inscribirDesdeSitio(eventoDelSitio(req), req.body as InscripcionSitioInput) })
}

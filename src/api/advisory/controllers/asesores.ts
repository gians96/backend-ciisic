import type { Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { crearDocente, editarDocente, eliminarDocente, listarDocentes } from '../services/asesores'
import type { DocenteInput } from '../validation'

/** El DNI es un dato personal: ninguna respuesta de esta ruta se guarda en cachés. */
function sinCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
}

/** `GET /v1/events/:eventId/advisory/advisors` — los docentes con su DNI y sus secciones, y las secciones del padrón. */
export async function listAdvisors(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    sinCache(res)
    res.json({ success: true, data: await listarDocentes(evento.id) })
}

/** `POST /v1/events/:eventId/advisory/advisors` — agrega un docente que no está en el Excel. */
export async function createAdvisor(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const datos = req.body as DocenteInput
    const docente = await crearDocente(evento.id, { nombre: datos.nombre, documento: datos.documento, secciones: datos.secciones })
    sinCache(res)
    res.status(201).json({ success: true, data: docente })
}

/** `PUT /v1/events/:eventId/advisory/advisors/:asesorId` — cambia nombre, DNI y secciones (la lista reemplaza a la anterior). */
export async function updateAdvisor(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const datos = req.body as DocenteInput
    const docente = await editarDocente(evento.id, idParam(req.params.asesorId, 'asesorId'), { nombre: datos.nombre, documento: datos.documento, secciones: datos.secciones })
    sinCache(res)
    res.json({ success: true, data: docente })
}

/** `DELETE /v1/events/:eventId/advisory/advisors/:asesorId` — quita al docente (sus estudiantes quedan sin asesor en esas secciones). */
export async function deleteAdvisor(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    await eliminarDocente(evento.id, idParam(req.params.asesorId, 'asesorId'))
    sinCache(res)
    res.json({ success: true, data: null })
}

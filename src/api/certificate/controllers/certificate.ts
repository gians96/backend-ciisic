import { pipeline } from 'stream/promises'
import type { Request, Response } from 'express'
import { idParam, unprocessable } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as certificados from '../services/certificados'
import * as destinatarios from '../services/destinatarios'
import * as generacion from '../services/generacion'
import * as descargas from '../services/descargas'
import type {
    DesdeInscripcionesInput,
    EditarCertificadoInput,
    EmitirCertificadoInput,
    GenerarCertificadosInput,
    ImportarCertificadosInput,
} from '../validation/certificados'

/**
 * Emisión, generación y descargas de certificados (spec 015). La guarda de permisos deja la cuenta
 * en `req.actor`: el documento completo (listados, detalle, manifiesto del ZIP) solo va con
 * `certificados.gestionar`; descargar para firmar exige `certificados.operar`.
 */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de certificados sin guarda de permisos')
    return actor
}

const conDocumento = (req: Request) => actorDe(req).permisos.has('certificados.gestionar')
const eventoDe = (req: Request) => idParam(req.params.eventId, 'eventId')

/** `GET /v1/events/:eventId/certificates?estado&tipo&plantillaId&q&page&pageSize`. */
export async function list(req: Request, res: Response) {
    const query = req.query as Record<string, unknown>
    const filtros = certificados.leerFiltros(query)
    const { data, meta } = await certificados.listarCertificados(eventoDe(req), filtros, parsePagination(query, 20, 100), conDocumento(req))
    res.json({ success: true, data, meta })
}

/** `GET /v1/certificates/:id`. */
export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await certificados.obtenerCertificado(idParam(req.params.id), conDocumento(req)) })
}

/** `POST /v1/events/:eventId/certificates`: individual (participante existente o persona por documento). */
export async function create(req: Request, res: Response) {
    const data = await destinatarios.emitirIndividual(eventoDe(req), req.body as EmitirCertificadoInput, actorDe(req).id)
    res.status(201).json({ success: true, data })
}

/** `POST /v1/events/:eventId/certificates/from-inscriptions`: simulación (200) o emisión (201). */
export async function fromInscriptions(req: Request, res: Response) {
    const data = await destinatarios.emitirDesdeInscripciones(eventoDe(req), req.body as DesdeInscripcionesInput, actorDe(req).id)
    res.status(data.simular ? 200 : 201).json({ success: true, data })
}

/** `POST /v1/events/:eventId/certificates/import`: resultado por fila (simulación o emisión). */
export async function importList(req: Request, res: Response) {
    const data = await destinatarios.importarCertificados(eventoDe(req), req.body as ImportarCertificadosInput, actorDe(req).id)
    res.status(data.simular ? 200 : 201).json({ success: true, data })
}

/** `PUT /v1/certificates/:id`: vuelve a PENDIENTE. */
export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await certificados.editarCertificado(idParam(req.params.id), req.body as EditarCertificadoInput, actorDe(req).id, conDocumento(req)) })
}

/** `DELETE /v1/certificates/:id`: solo PENDIENTE nunca generado. */
export async function remove(req: Request, res: Response) {
    await certificados.borrarCertificado(idParam(req.params.id))
    res.json({ success: true, data: null })
}

/** `POST /v1/events/:eventId/certificates/generate`: una tanda síncrona de hasta 10. */
export async function generate(req: Request, res: Response) {
    res.json({ success: true, data: await generacion.generarCertificados(eventoDe(req), req.body as GenerarCertificadosInput) })
}

/** `GET /v1/certificates/:id/file?version=generado|firmado`. */
export async function file(req: Request, res: Response) {
    const version = req.query.version ?? 'firmado'
    if (version !== 'generado' && version !== 'firmado') {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { version: 'Usa generado o firmado' })
    }
    const puedeOperar = actorDe(req).permisos.has('certificados.operar')
    const { pdf, nombre } = await descargas.archivoCertificado(idParam(req.params.id), version, puedeOperar)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
    res.send(pdf)
}

/**
 * `GET /v1/events/:eventId/certificates/zip`: ZIP en flujo. La parte va en cabeceras para que el panel
 * pida la siguiente con `despuesDe=<X-Zip-Siguiente>` mientras `X-Zip-Hay-Mas` sea `true`:
 * `X-Zip-Total`, `X-Zip-Certificados`, `X-Zip-Archivos`, `X-Zip-Desde`, `X-Zip-Hasta`,
 * `X-Zip-Restantes`, `X-Zip-Siguiente` y `X-Zip-Hay-Mas`. Un error a mitad del envío corta la
 * respuesta (el navegador ve la descarga incompleta).
 */
export async function zip(req: Request, res: Response) {
    const opciones = descargas.leerOpcionesZip(req.query as Record<string, unknown>)
    const preparado = await descargas.prepararZip(eventoDe(req), opciones, conDocumento(req))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${preparado.nombre}"`)
    res.setHeader('X-Zip-Total', String(preparado.total))
    res.setHeader('X-Zip-Certificados', String(preparado.certificados))
    res.setHeader('X-Zip-Archivos', String(preparado.archivos))
    res.setHeader('X-Zip-Desde', String(preparado.desdeNumero))
    res.setHeader('X-Zip-Hasta', String(preparado.hastaNumero))
    res.setHeader('X-Zip-Restantes', String(preparado.restantes))
    res.setHeader('X-Zip-Siguiente', preparado.restantes > 0 ? String(preparado.hastaNumero) : '')
    res.setHeader('X-Zip-Hay-Mas', preparado.restantes > 0 ? 'true' : 'false')
    try {
        await pipeline(preparado.salida, res)
    } catch (error) {
        console.error(`No se pudo completar el ZIP de certificados del evento ${eventoDe(req)}:`, error instanceof Error ? error.message : error)
    }
}

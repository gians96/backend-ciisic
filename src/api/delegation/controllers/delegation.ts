import { Request, Response } from 'express'
import { idParam, unprocessable } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { eventoDelSitio, type SitioRequest } from '../../../middlewares/sitio'
import { archivosSubidos, mimeDeArchivo, removeUploadedFiles } from '../../../middlewares/upload'
import * as service from '../services/delegation'
import type { VistaDelegacion } from '../services/delegation'
import * as pagos from '../services/pagos'
import type { CodigoPlan } from '../services/planes'
import type {
    CambiarPlanInput, ConfigDelegacionInput, CrearDelegacionInput, EditarDelegacionInput, InscribirEnDelegacionInput, InscribirseInput, RegenerarLinkInput,
} from '../validation'
import { agregarPagosSchema, estadoPagoDelegacionSchema } from '../validation'

/** Qué ve quien consulta (spec 013 y 029): sin `pagos.ver` el dinero va en `null`; los links, solo quien inscribe o gestiona. */
function vistaDe(req: Request): VistaDelegacion {
    const permisos = (req as AuthenticatedRequest).actor?.permisos
    return {
        conPago: permisos?.has('pagos.ver') === true,
        conLinks: permisos?.has('delegaciones.inscribir') === true || permisos?.has('delegaciones.gestionar') === true,
    }
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarDelegaciones(idParam(req.params.eventId, 'eventId'), vistaDe(req)) })
}

export async function create(req: Request, res: Response) {
    const puedeConfigurar = (req as AuthenticatedRequest).actor?.permisos.has('delegaciones.gestionar') === true
    res.status(201).json({
        success: true,
        data: await service.crearDelegacion(idParam(req.params.eventId, 'eventId'), req.body as CrearDelegacionInput, { puedeConfigurar }, vistaDe(req)),
    })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await service.obtenerDelegacion(idParam(req.params.id), vistaDe(req)) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarDelegacion(idParam(req.params.id), req.body as EditarDelegacionInput, vistaDe(req)) })
}

/** Planes y precios, mínimo para el promocional, dominio del correo y link individual (`delegaciones.gestionar`). */
export async function config(req: Request, res: Response) {
    res.json({ success: true, data: await service.configurarDelegacion(idParam(req.params.id), req.body as ConfigDelegacionInput, vistaDe(req)) })
}

export async function regenerateLink(req: Request, res: Response) {
    res.json({ success: true, data: await service.regenerarLink(idParam(req.params.id), req.body as RegenerarLinkInput, vistaDe(req)) })
}

export async function bulkInscriptions(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.inscribirParticipantes(idParam(req.params.id), req.body as InscribirEnDelegacionInput, vistaDe(req)) })
}

export async function removeInscription(req: Request, res: Response) {
    res.json({ success: true, data: await service.quitarIntegrante(idParam(req.params.id), idParam(req.params.inscriptionId, 'inscriptionId'), vistaDe(req)) })
}

export async function changePlan(req: Request, res: Response) {
    const { plan } = req.body as CambiarPlanInput
    res.json({
        success: true,
        data: await service.cambiarPlanIntegrante(idParam(req.params.id), idParam(req.params.inscriptionId, 'inscriptionId'), plan as CodigoPlan, vistaDe(req)),
    })
}

export async function approve(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await service.aprobarDelegacion(idParam(req.params.id), req.actor?.id, vistaDe(req)) })
}

/** Suma vouchers a la delegación desde el panel (multipart: `pagos` en JSON y los archivos en `vouchers`). */
export async function addPayments(req: Request, res: Response) {
    try {
        const input = await leerPagos(req)
        const delegacion = await service.delegacionBasica(idParam(req.params.id))
        await pagos.agregarPagos(delegacion, input, archivosSubidos(req).map((archivo) => archivo.filename))
        res.status(201).json({ success: true, data: await service.obtenerDelegacion(delegacion.id, vistaDe(req)) })
    } catch (error) {
        removeUploadedFiles(req)
        throw error
    }
}

export async function paymentState(req: AuthenticatedRequest, res: Response) {
    const input = await estadoPagoDelegacionSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    res.json({ success: true, data: await pagos.cambiarEstadoPago(idParam(req.params.id), idParam(req.params.paymentId, 'paymentId'), input, req.actor?.id) })
}

export async function removePayment(req: Request, res: Response) {
    await pagos.eliminarPago(idParam(req.params.id), idParam(req.params.paymentId, 'paymentId'))
    res.json({ success: true, data: await service.obtenerDelegacion(idParam(req.params.id), vistaDe(req)) })
}

/** Voucher de un pago de la delegación (lo ve el staff con `pagos.ver`). */
export async function paymentVoucher(req: Request, res: Response) {
    const ruta = await pagos.archivoVoucherPago(idParam(req.params.id), idParam(req.params.paymentId, 'paymentId'))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', mimeDeArchivo(ruta))
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(ruta)
}

// ─── API del sitio ──────────────────────────────────────────────────────────

/** Datos de una delegación por su link (el evento sale del token de acceso). */
export async function publicFind(req: SitioRequest, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: await service.delegacionPorCodigo(String(req.params.codigoLink), evento.id) })
}

/** El delegado suma integrantes con el link de su delegación (solo agrega). */
export async function publicAddParticipants(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.inscribirPorLink(eventoDelSitio(req), String(req.params.codigoLink), req.body as InscribirEnDelegacionInput) })
}

/** El delegado suma vouchers con el link de su delegación (solo agrega). */
export async function publicAddPayments(req: Request, res: Response) {
    try {
        const evento = eventoDelSitio(req)
        const delegacion = await service.delegacionParaPagos(evento, String(req.params.codigoLink))
        const input = await leerPagos(req)
        await pagos.agregarPagos(delegacion, input, archivosSubidos(req).map((archivo) => archivo.filename))
        res.status(201).json({ success: true, data: await service.delegacionPorCodigo(delegacion.codigoLink, evento.id) })
    } catch (error) {
        removeUploadedFiles(req)
        throw error
    }
}

/** Lo que ve quien abre el link individual: el grupo, el dominio del correo y los planes activos. */
export async function publicJoinFind(req: SitioRequest, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: await service.delegacionPublicaPorInscripcion(String(req.params.codigoInscripcion), evento.id) })
}

/** Un integrante se inscribe solo con el link individual de su delegación (sin Google). */
export async function publicJoin(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.inscribirseConLink(eventoDelSitio(req), String(req.params.codigoInscripcion), req.body as InscribirseInput) })
}

/** Quita cadenas vacías (multipart) para que yup trate los campos como ausentes. */
function limpiar(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(body).filter(([, valor]) => valor !== '' && valor !== undefined && valor !== 'null'))
}

/** Lee un campo JSON del multipart (los pagos). */
function leerJson(valor: unknown, campo: string): unknown {
    if (typeof valor !== 'string') return valor
    try {
        return JSON.parse(valor)
    } catch {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { [campo]: 'JSON inválido' })
    }
}

/** Los pagos de un multipart: validados y con exactamente un archivo por pago. */
async function leerPagos(req: Request) {
    const body = limpiar(req.body ?? {})
    const input = await agregarPagosSchema.validate({ pagos: leerJson(body.pagos, 'pagos') }, { abortEarly: false, stripUnknown: true })
    if (archivosSubidos(req).length !== input.pagos.length) throw unprocessable('VOUCHER_REQUIRED', 'Adjunta el voucher de cada pago.')
    return input
}

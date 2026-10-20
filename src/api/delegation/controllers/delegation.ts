import { Request, Response } from 'express'
import { idParam, unprocessable } from '../../../core/http-error'
import { eventoDelSitio, type SitioRequest } from '../../../middlewares/sitio'
import { mimeDeArchivo } from '../../../middlewares/upload'
import * as service from '../services/delegation'
import type { InscribirEnDelegacionInput } from '../validation'

export async function list(req: Request, res: Response) {
    res.json({ success: true, data: await service.listarDelegaciones(idParam(req.params.eventId, 'eventId')) })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.crearDelegacion(idParam(req.params.eventId, 'eventId'), req.body) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await service.obtenerDelegacion(idParam(req.params.id)) })
}

/** Tarifa de las delegaciones del evento: los precios salen de los tipos (spec 019). */
export async function publicTarifa(req: SitioRequest, res: Response) {
    res.json({ success: true, data: await service.tarifaDelegaciones(eventoDelSitio(req)) })
}

/** Datos de una delegación por su link (el evento sale del token de acceso). */
export async function publicFind(req: SitioRequest, res: Response) {
    const evento = eventoDelSitio(req)
    res.json({ success: true, data: await service.delegacionPorCodigo(String(req.params.codigoLink), evento.id) })
}

export async function bulkInscriptions(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await service.inscribirParticipantes(idParam(req.params.id), req.body as InscribirEnDelegacionInput) })
}

/** Voucher del pago conjunto de la delegación (lo ve el staff). */
export async function voucher(req: Request, res: Response) {
    const ruta = await service.archivoVoucherDelegacion(idParam(req.params.id))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', mimeDeArchivo(ruta))
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(ruta)
}

/** Quita cadenas vacías (multipart) para que yup trate los campos como ausentes. */
function limpiar(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(body).filter(([, valor]) => valor !== '' && valor !== undefined && valor !== 'null'))
}

/** Lee un campo JSON del multipart (el array de participantes y la delegación). */
function leerJson(valor: unknown, campo: string): unknown {
    if (typeof valor !== 'string') return valor
    try {
        return JSON.parse(valor)
    } catch {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { [campo]: 'JSON inválido' })
    }
}

/**
 * `POST /v1/site/delegations`: el representante registra a su grupo y paga el total con un solo
 * voucher (spec 018). El monto lo calcula el backend; el cliente solo manda los datos.
 */
export async function publicCreate(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    const body = limpiar(req.body ?? {})
    const input = await service.validarRegistroDelegacion({
        ...body,
        delegacion: leerJson(body.delegacion, 'delegacion'),
        representante: leerJson(body.representante, 'representante'),
        participantes: leerJson(body.participantes, 'participantes'),
    })
    const delegacion = await service.registrarDelegacion(evento, input, req.file?.filename ?? null)
    res.status(201).json({ success: true, data: delegacion })
}

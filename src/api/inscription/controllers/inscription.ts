import { Request, Response } from 'express'
import { HttpError, idParam, unprocessable } from '../../../core/http-error'
import { ESTADO_POR_ID_LEGACY, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { parsePagination } from '../../../core/pagination'
import { mimeDeArchivo } from '../../../middlewares/upload'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId, obtenerEventoPrincipal } from '../../event/services/public-event'
import * as service from '../services/inscription'
import { aCreada, aDetalle, aLegacy } from '../services/mappers'
import { cambiarEstadoSchema, crearInscripcionSchema, inscripcionLegacySchema, type CrearInscripcionInput } from '../validation'
import { eventoDelSitio } from '../../../middlewares/sitio'

/** Quita cadenas vacías (multipart) para que yup trate los campos como ausentes. */
function limpiar(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(body).filter(([, valor]) => valor !== '' && valor !== undefined && valor !== 'null'))
}

function leerJson(valor: unknown, campo: string): unknown {
    if (typeof valor !== 'string') return valor
    try {
        return JSON.parse(valor)
    } catch {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { [campo]: 'JSON inválido' })
    }
}

// ─── Público ────────────────────────────────────────────────────────────────

export async function publicCreate(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    const body = limpiar(req.body ?? {})
    const input = await crearInscripcionSchema.validate(
        { ...body, participante: leerJson(body.participante, 'participante') },
        { abortEarly: false, stripUnknown: true },
    )
    const inscripcion = await service.crearInscripcion(evento, input, req.file?.filename ?? null)
    res.status(201).json({ success: true, data: aCreada(inscripcion) })
}

// ─── Permisos del actor (spec 013) ──────────────────────────────────────────

/** Sin «pagos.ver» (Comisión) las respuestas no llevan montos, precios ni datos de pago. */
function conPago(req: AuthenticatedRequest): boolean {
    return req.actor?.permisos.has('pagos.ver') === true
}

/** Cancelar es más que validar un pago: exige además «inscripciones.cancelar» (el Tesorero no lo tiene). */
function verificarDestino(req: AuthenticatedRequest, codigo: CodigoEstadoInscripcion) {
    if (codigo === 'CANCELADO' && !req.actor?.permisos.has('inscripciones.cancelar')) {
        throw new HttpError(403, 'STATUS_NOT_ALLOWED', 'No tienes permiso para cancelar inscripciones.')
    }
}

// ─── Legacy (landing anterior; evento principal) ────────────────────────────

export async function legacyCreate(req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    const body = limpiar(req.body ?? {})
    const legacy = await inscripcionLegacySchema.validate(
        { ...body, usuario: leerJson(body.usuario, 'usuario') },
        { abortEarly: false, stripUnknown: true },
    )
    const input: CrearInscripcionInput = {
        participante: {
            tipoDocumento: legacy.usuario.idTipoDocumentoId,
            numeroDocumento: legacy.usuario.dni,
            nombres: legacy.usuario.nombres,
            apellidos: legacy.usuario.apellidos,
            correo: legacy.usuario.correoElectronico,
            celular: legacy.usuario.celular,
        },
        tipoInscripcionId: legacy.tipoInscripcionId,
        clasificacionId: legacy.clasificacionId ?? null,
        modalidadPago: legacy.modalidadDeposito,
        banco: legacy.bancoSeleccionado ?? null,
        tipoOperacion: legacy.tipoOperacion === 'directo' || legacy.tipoOperacion === 'interbancario' ? legacy.tipoOperacion : null,
        billeteraDigital: legacy.billeteraDigital ?? null,
        numeroOperacion: legacy.numeroOperacion,
        fechaPago: legacy.fechaPago.toISOString().slice(0, 10),
        verificacionToken: null,
        verificacionCorreoToken: null,
    }
    // Solo se acepta el archivo subido (nunca un nombre de archivo enviado por el cliente)
    const inscripcion = await service.crearInscripcion(evento, input, req.file?.filename ?? null, { legacy: true })
    res.status(201).json({ success: true, message: 'Inscripción creada exitosamente', data: aLegacy(inscripcion) })
}

export async function legacyList(_req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    res.json((await service.todasLasInscripciones(evento.id)).map(aLegacy))
}

export async function legacyFind(req: Request, res: Response) {
    const inscripcion = await service.obtenerInscripcion(idParam(req.params.id))
    res.json({ success: true, message: 'Inscripción encontrada', data: aLegacy(inscripcion) })
}

export async function legacyUpdateStatus(req: AuthenticatedRequest, res: Response) {
    const codigo = ESTADO_POR_ID_LEGACY[Number(req.body?.estadoId)]
    if (!codigo) throw unprocessable('VALIDATION_ERROR', 'estadoId inválido', { estadoId: 'Debe ser un estado válido (1-5)' })
    verificarDestino(req, codigo)
    if (codigo === 'RECHAZADO') req.body.motivo = req.body.motivo || 'Rechazado desde herramienta anterior'
    const { inscripcion } = await service.cambiarEstado(idParam(req.params.id), codigo, req.body.motivo, req.actor?.id)
    res.json({ success: true, message: 'Estado de inscripción actualizado correctamente', data: aLegacy(inscripcion) })
}

// ─── Administración ─────────────────────────────────────────────────────────

function filtros(query: Request['query']): service.FiltrosInscripcion {
    const texto = (valor: unknown) => (typeof valor === 'string' && valor.trim() ? valor.trim() : undefined)
    const tipo = Number(query.tipoInscripcionId)
    return {
        estado: texto(query.estado)?.toUpperCase(),
        tipoInscripcionId: Number.isSafeInteger(tipo) && tipo > 0 ? tipo : undefined,
        categoria: texto(query.categoria)?.toUpperCase(),
        esEstudianteUndc: query.esEstudianteUndc === 'true' ? true : query.esEstudianteUndc === 'false' ? false : undefined,
        q: texto(query.q)?.slice(0, 100),
    }
}

export async function list(req: AuthenticatedRequest, res: Response) {
    const eventoId = idParam(req.params.eventId, 'eventId')
    await obtenerEventoPorId(eventoId)
    const resultado = await service.listarInscripciones(eventoId, filtros(req.query), parsePagination(req.query), conPago(req))
    res.json({ success: true, ...resultado })
}

export async function exportCsv(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const csv = await service.exportarCsv(evento.id, filtros(req.query), conPago(req))
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="inscripciones-${evento.codigo}.csv"`)
    res.send(csv)
}

export async function find(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: aDetalle(await service.obtenerInscripcion(idParam(req.params.id)), conPago(req)) })
}

export async function updateStatus(req: AuthenticatedRequest, res: Response) {
    const body = await cambiarEstadoSchema.validate(req.body, { abortEarly: false, stripUnknown: true })
    const codigo = body.estado as CodigoEstadoInscripcion
    verificarDestino(req, codigo)
    const { inscripcion, credencialEnviada } = await service.cambiarEstado(idParam(req.params.id), codigo, body.motivo, req.actor?.id)
    res.json({ success: true, data: { ...aDetalle(inscripcion, conPago(req)), credencialEnviada } })
}

export async function resendCredential(req: Request, res: Response) {
    res.json({ success: true, data: await service.reenviarCredencial(idParam(req.params.id)) })
}

export async function voucher(req: Request, res: Response) {
    const ruta = await service.archivoVoucher(idParam(req.params.id))
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', mimeDeArchivo(ruta))
    res.setHeader('Content-Disposition', 'inline')
    res.sendFile(ruta)
}

export async function credential(req: Request, res: Response) {
    const id = idParam(req.params.id)
    const ruta = await service.archivoCredencial(id)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="credencial-${id}.pdf"`)
    res.sendFile(ruta)
}

export async function remove(req: Request, res: Response) {
    await service.eliminarInscripcion(idParam(req.params.id))
    res.json({ success: true, data: null })
}

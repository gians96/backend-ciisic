import type { Request } from 'express'
import { prisma } from '../database/prisma'
import { badRequest, idParam } from './http-error'

/**
 * Resolutores del evento al que pertenece lo que pide una ruta (spec 013). La guarda los usa con
 * las cuentas que tienen eventos asignados: `null` (recurso inexistente o sin evento) responde 404 o
 * 403 y nunca deja pasar. Parsean los ids igual que los controladores (`idParam`), para que un id
 * con otra forma (`0x3`, `3.0`) no llegue a otro recurso.
 */
export type ResolutorEvento = ((req: Request) => Promise<number | null>) & { readonly nombre: string }

function resolutor(nombre: string, fn: (req: Request) => Promise<number | null>): ResolutorEvento {
    return Object.assign(fn, { nombre })
}

/** Código de recepción de una ponencia (UUID v1–v5). */
export const UUID_RECEPCION = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function uuidRecepcion(value: unknown): string {
    const id = String(value)
    if (!UUID_RECEPCION.test(id)) throw badRequest('INVALID_ID', 'Código de recepción inválido.')
    return id
}

/** El evento viene en la ruta: `/v1/events/:eventId/...` o `/v1/events/:id/...`. */
export function eventoDelParametro(param = 'eventId'): ResolutorEvento {
    return resolutor(`parametro:${param}`, async (req) => idParam(req.params[param], param))
}

export const eventoDeInscripcion = resolutor('inscripcion', async (req) => {
    const fila = await prisma.inscripcion.findUnique({ where: { id: idParam(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

export const eventoDeActividad = resolutor('actividad', async (req) => {
    const fila = await prisma.actividad.findUnique({ where: { id: idParam(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

export const eventoDeAsistencia = resolutor('asistencia', async (req) => {
    const fila = await prisma.asistencia.findUnique({ where: { id: idParam(req.params.id) }, select: { actividad: { select: { eventoId: true } } } })
    return fila?.actividad.eventoId ?? null
})

/** Los mensajes antiguos sin evento no son de ninguna cuenta por evento. */
export const eventoDeMensaje = resolutor('mensaje', async (req) => {
    const fila = await prisma.mensajeContacto.findUnique({ where: { id: idParam(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

export const eventoDePonencia = resolutor('ponencia', async (req) => {
    const fila = await prisma.ponencia.findUnique({ where: { id: uuidRecepcion(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

/** Certificado por id (spec 015): `/v1/certificates/:id/...`. */
export const eventoDeCertificado = resolutor('certificado', async (req) => {
    const fila = await prisma.certificado.findUnique({ where: { id: idParam(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

/** Plantilla de certificado por id (spec 015): `/v1/certificate-templates/:id/...`. */
export const eventoDePlantilla = resolutor('plantilla', async (req) => {
    const fila = await prisma.plantillaCertificado.findUnique({ where: { id: idParam(req.params.id) }, select: { eventoId: true } })
    return fila?.eventoId ?? null
})

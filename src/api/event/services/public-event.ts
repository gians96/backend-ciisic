import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { fechaSoloDia } from '../../../core/fechas'

/** Evento principal (usado por las rutas legacy de la landing actual). */
export async function obtenerEventoPrincipal(): Promise<Evento> {
    const evento = await prisma.evento.findFirst({ where: { esPrincipal: true }, orderBy: { id: 'asc' } })
    if (!evento) throw notFound('EVENT_NOT_FOUND', 'No hay un evento principal configurado.')
    return evento
}

/** Evento por id para rutas administrativas; 404 si no existe. */
export async function obtenerEventoPorId(id: number): Promise<Evento> {
    const evento = await prisma.evento.findUnique({ where: { id } })
    if (!evento) throw notFound('EVENT_NOT_FOUND', 'El evento no existe.')
    return evento
}

type VentanaEvento = Pick<Evento, 'estado' | 'inscripcionesAbiertas' | 'inscripcionesInicio' | 'inscripcionesFin'>

export function inscripcionesAbiertas(evento: VentanaEvento, ahora = new Date()): boolean {
    if (evento.estado !== 'PUBLICADO' || !evento.inscripcionesAbiertas) return false
    if (evento.inscripcionesInicio && ahora < evento.inscripcionesInicio) return false
    if (evento.inscripcionesFin && ahora > evento.inscripcionesFin) return false
    return true
}

export function aEventoPublico(evento: Evento) {
    return {
        codigo: evento.codigo,
        nombre: evento.nombre,
        nombreCorto: evento.nombreCorto,
        descripcion: evento.descripcion,
        sede: evento.sede,
        fechaInicio: fechaSoloDia(evento.fechaInicio),
        fechaFin: fechaSoloDia(evento.fechaFin),
        estado: evento.estado,
        inscripciones: {
            abiertas: inscripcionesAbiertas(evento),
            inicio: evento.inscripcionesInicio,
            fin: evento.inscripcionesFin,
        },
        dominioInstitucional: evento.dominioInstitucional,
        contacto: { correo: evento.correoContacto, telefono: evento.telefonoContacto },
        datosPago: evento.datosPago ?? null,
    }
}

import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound } from '../../../core/http-error'
import { fechaLima, horaLima } from '../../../core/fechas'
import { aKit, KIT_SELECT, tipoIncluyeKit, type KitEstado } from '../../../core/kit'
import type { Actor } from '../../../core/actor'
import { obtenerEventoPorId } from '../../event/services/public-event'

/**
 * Entrega del kit en la puerta (spec 037). El kit es de la inscripción: se entrega una vez en todo el congreso, a una
 * inscripción `APROBADO` cuyo tipo lo incluye (`incluye_kit`, presencial), y no depende del horario de ninguna actividad.
 * Marcar y deshacer son atómicos (`updateMany` condicionado al estado que se leyó): dos operadores a la vez no se pisan.
 */

const DATOS_KIT_INSCRIPCION = {
    id: true,
    eventoId: true,
    estado: { select: { codigo: true } },
    tipoInscripcion: { select: { modalidad: true, incluyeKit: true } },
    ...KIT_SELECT,
} as const

export interface ResultadoKit {
    inscripcionId: number
    kit: KitEstado
}

async function obtenerInscripcionKit(id: number) {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id }, select: DATOS_KIT_INSCRIPCION })
    if (!inscripcion) throw notFound('INSCRIPTION_NOT_FOUND', 'La inscripción no existe.')
    return inscripcion
}

/** «a las 10:32» si fue hoy (hora de Lima); si no, con la fecha: el kit puede haberse entregado otro día. */
function cuando(entregadoEn: Date, ahora: Date): string {
    return fechaLima(entregadoEn) === fechaLima(ahora) ? `a las ${horaLima(entregadoEn)}` : `el ${fechaLima(entregadoEn)} a las ${horaLima(entregadoEn)}`
}

const yaEntregado = (entregadoEn: Date | null | undefined, ahora: Date) => conflict(
    'KIT_ALREADY_DELIVERED',
    entregadoEn ? `El kit ya fue entregado ${cuando(entregadoEn, ahora)}.` : 'El kit ya fue entregado.',
)

/**
 * Marca el kit como entregado ahora, por quien lo entrega. 403 `NOT_APPROVED` si la inscripción no está aprobada, 409
 * `KIT_NOT_INCLUDED` si el tipo no lleva kit (o es virtual, o no tiene tipo) y 409 `KIT_ALREADY_DELIVERED` (con la hora) si ya se entregó.
 */
export async function entregarKit(inscripcionId: number, actor: Actor, ahora = new Date()): Promise<ResultadoKit> {
    const inscripcion = await obtenerInscripcionKit(inscripcionId)
    if (inscripcion.estado.codigo !== 'APROBADO') throw new HttpError(403, 'NOT_APPROVED', 'El participante no tiene una inscripción aprobada en este evento.')
    if (!tipoIncluyeKit(inscripcion.tipoInscripcion)) throw conflict('KIT_NOT_INCLUDED', 'El tipo de inscripción de esta persona no incluye kit.')
    if (inscripcion.kitEntregadoEn) throw yaEntregado(inscripcion.kitEntregadoEn, ahora)
    const { count } = await prisma.inscripcion.updateMany({
        where: { id: inscripcionId, kitEntregadoEn: null },
        data: { kitEntregadoEn: ahora, kitEntregadoPorId: actor.id },
    })
    // Otra cuenta lo entregó entre la lectura y la escritura: se informa con su hora
    if (!count) throw yaEntregado((await obtenerInscripcionKit(inscripcionId)).kitEntregadoEn, ahora)
    return {
        inscripcionId,
        kit: aKit({
            ...inscripcion,
            kitEntregadoEn: ahora,
            kitEntregadoPor: { id: actor.id, nombres: actor.nombres, apellidos: actor.apellidos },
        }),
    }
}

/**
 * Deshace la entrega (se marcó por error, o el kit no estaba y se entrega otro día): vuelve a «pendiente». No exige que
 * el tipo siga incluyendo kit, para poder corregir aunque el tipo haya cambiado. 409 `KIT_NOT_DELIVERED` si no estaba entregado.
 */
export async function deshacerEntregaKit(inscripcionId: number): Promise<ResultadoKit> {
    const inscripcion = await obtenerInscripcionKit(inscripcionId)
    const { count } = await prisma.inscripcion.updateMany({
        where: { id: inscripcionId, kitEntregadoEn: { not: null } },
        data: { kitEntregadoEn: null, kitEntregadoPorId: null },
    })
    if (!count) throw conflict('KIT_NOT_DELIVERED', 'El kit de esta persona no estaba entregado.')
    return { inscripcionId, kit: aKit({ ...inscripcion, kitEntregadoEn: null, kitEntregadoPor: null }) }
}

/** Cuántos kits corresponden al evento y cuántos ya se entregaron: inscripciones aprobadas con un tipo presencial que incluye kit. */
export async function resumenKits(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const donde = { eventoId, estado: { codigo: 'APROBADO' }, tipoInscripcion: { incluyeKit: true, modalidad: 'PRESENCIAL' as const } }
    const [conKit, entregados] = await Promise.all([
        prisma.inscripcion.count({ where: donde }),
        prisma.inscripcion.count({ where: { ...donde, kitEntregadoEn: { not: null } } }),
    ])
    return { conKit, entregados, pendientes: Math.max(0, conKit - entregados) }
}

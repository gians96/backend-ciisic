import { prisma } from '../../../database/prisma'
import type { Actor } from '../../../core/actor'
import { obtenerEventoPorId } from '../../event/services/public-event'

/** Si las ponencias especializadas del evento se inscriben solo con el documento (spec 030). */
export async function obtenerAcceso(eventoId: number) {
    const evento = await obtenerEventoPorId(eventoId)
    return { accesoLibre: evento.ponenciasAccesoLibre }
}

/** Enciende o apaga el acceso libre. Solo registra ids: quién lo cambió y a qué valor. */
export async function guardarAcceso(eventoId: number, accesoLibre: boolean, actor: Actor) {
    await obtenerEventoPorId(eventoId)
    await prisma.evento.update({ where: { id: eventoId }, data: { ponenciasAccesoLibre: accesoLibre } })
    console.info(`[ponencias-especializadas] La cuenta ${actor.id} ${accesoLibre ? 'encendió' : 'apagó'} el acceso libre del evento ${eventoId}`)
    return { accesoLibre }
}

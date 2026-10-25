import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { ANOTAR_ACCESO_CADA_MS, enlaceInvalido, nuevoToken, REGEX_TOKEN } from '../../advisory/services/enlaces'
import { listarAforo } from './talks'

/**
 * Enlace público del aforo de las ponencias especializadas (spec 036). Uno por evento: un token aleatorio de 256 bits
 * (como los de los docentes y los ciclos, spec 026/027) con el que la landing del evento muestra, sin iniciar sesión,
 * el aforo, los inscritos presenciales y la asistencia de cada tema. El token **es** la credencial: solo el Owner
 * (`especializadas.enlace_aforo`) lo ve, lo crea, lo renueva o lo desactiva.
 */

export interface EnlaceAforo {
    /** `null`: el evento no tiene enlace. */
    token: string | null
    creadoEn: string | null
    ultimoAcceso: string | null
}

const SIN_ENLACE: EnlaceAforo = { token: null, creadoEn: null, ultimoAcceso: null }

export async function obtenerEnlaceAforo(eventoId: number): Promise<EnlaceAforo> {
    const enlace = await prisma.enlaceAforoPonencias.findUnique({ where: { eventoId }, select: { token: true, creadoEn: true, ultimoAcceso: true } })
    if (!enlace) return { ...SIN_ENLACE }
    return { token: enlace.token, creadoEn: enlace.creadoEn.toISOString(), ultimoAcceso: enlace.ultimoAcceso?.toISOString() ?? null }
}

/**
 * Crea el enlace del evento si no tiene. Con `regenerar` lo renueva: el anterior deja de valer al instante. Ante la
 * (casi imposible) colisión del índice único del token prueba con otro.
 */
export async function crearEnlaceAforo(eventoId: number, regenerar = false): Promise<EnlaceAforo> {
    if (!regenerar) {
        const actual = await obtenerEnlaceAforo(eventoId)
        if (actual.token) return actual
    }
    for (let intento = 0; intento < 3; intento++) {
        try {
            await prisma.enlaceAforoPonencias.upsert({
                where: { eventoId },
                create: { eventoId, token: nuevoToken() },
                update: { token: nuevoToken(), creadoEn: new Date(), ultimoAcceso: null },
            })
            break
        } catch (error) {
            const colision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
            if (!colision || intento === 2) throw error
        }
    }
    return obtenerEnlaceAforo(eventoId)
}

/** Desactiva el enlace del evento (si lo tenía): quien lo use deja de ver el aforo. */
export async function desactivarEnlaceAforo(eventoId: number): Promise<EnlaceAforo> {
    await prisma.enlaceAforoPonencias.deleteMany({ where: { eventoId } })
    return { ...SIN_ENLACE }
}

/**
 * Aforo de las ponencias del evento del sitio, con el token de su enlace. El token debe ser del **mismo** evento que el
 * token del sitio. Uno faltante, mal formado, desconocido, de otro evento o desactivado responde igual (`LINK_NOT_FOUND`).
 * Anota el último acceso como máximo cada 5 minutos.
 */
export async function aforoDelEnlace(evento: { id: number, nombre: string, nombreCorto: string | null }, token: string | undefined) {
    if (!token || !REGEX_TOKEN.test(token)) throw enlaceInvalido()
    const enlace = await prisma.enlaceAforoPonencias.findUnique({ where: { token }, select: { id: true, eventoId: true, ultimoAcceso: true } })
    if (!enlace || enlace.eventoId !== evento.id) throw enlaceInvalido()
    const ahora = new Date()
    if (!enlace.ultimoAcceso || ahora.getTime() - enlace.ultimoAcceso.getTime() > ANOTAR_ACCESO_CADA_MS) {
        // El acceso es un dato de cortesía: si no se puede anotar, igual se muestra el aforo
        await prisma.enlaceAforoPonencias.update({ where: { id: enlace.id }, data: { ultimoAcceso: ahora } }).catch(() => undefined)
    }
    return {
        evento: { nombre: evento.nombre, nombreCorto: evento.nombreCorto },
        generadoEn: ahora.toISOString(),
        ponencias: await listarAforo(evento.id),
    }
}

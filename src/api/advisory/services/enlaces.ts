import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'

/**
 * Enlaces públicos de los docentes (spec 026). Cada asesor puede tener un token aleatorio de 256 bits
 * (43 caracteres base64url) con el que ve el avance de sus estudiantes sin iniciar sesión. El token **es** la
 * credencial: quien lo tiene entra, así que solo el staff con `reportes.gestionar` lo ve, lo crea, lo renueva
 * o lo desactiva (un token nuevo invalida el anterior al instante).
 */

export const REGEX_TOKEN = /^[A-Za-z0-9_-]{43}$/

/** El último acceso se anota como máximo cada 5 minutos: una escritura por visita no hace falta. */
export const ANOTAR_ACCESO_CADA_MS = 5 * 60 * 1000

export const nuevoToken = (): string => crypto.randomBytes(32).toString('base64url')

export interface EnlaceAsesor {
    asesorId: number
    nombre: string
    /** `null`: el docente no tiene enlace. */
    token: string | null
    creadoEn: string | null
    ultimoAcceso: string | null
}

/** El mismo error para un token mal formado, desconocido o desactivado: no se distingue cuál fue. */
export const enlaceInvalido = () => notFound('LINK_NOT_FOUND', 'El enlace no es válido o fue desactivado.')

export async function listarEnlaces(eventoId: number): Promise<EnlaceAsesor[]> {
    const asesores = await prisma.asesor.findMany({
        where: { eventoId },
        select: { id: true, nombre: true, enlaceToken: true, enlaceCreadoEn: true, enlaceUltimoAcceso: true },
        orderBy: { nombre: 'asc' },
    })
    return asesores.map((a) => ({
        asesorId: a.id,
        nombre: a.nombre,
        token: a.enlaceToken,
        creadoEn: a.enlaceCreadoEn?.toISOString() ?? null,
        ultimoAcceso: a.enlaceUltimoAcceso?.toISOString() ?? null,
    }))
}

/** Asigna un token; ante la (casi imposible) colisión del índice único prueba con otro. */
async function asignarToken(asesorId: number): Promise<void> {
    for (let intento = 0; intento < 3; intento++) {
        try {
            await prisma.asesor.update({
                where: { id: asesorId },
                data: { enlaceToken: nuevoToken(), enlaceCreadoEn: new Date(), enlaceUltimoAcceso: null },
            })
            return
        } catch (error) {
            const colision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
            if (!colision || intento === 2) throw error
        }
    }
}

/**
 * Crea los enlaces que faltan (de los asesores indicados o de todos los del evento). Con `regenerar` también
 * renueva los que ya existen: el enlace anterior deja de valer. Devuelve la lista completa.
 */
export async function crearEnlaces(eventoId: number, opciones: { asesorIds?: number[], regenerar?: boolean }): Promise<EnlaceAsesor[]> {
    const pedidos = opciones.asesorIds ? [...new Set(opciones.asesorIds)] : null
    const asesores = await prisma.asesor.findMany({
        where: { eventoId, ...(pedidos ? { id: { in: pedidos } } : {}) },
        select: { id: true, enlaceToken: true },
    })
    if (pedidos && asesores.length !== pedidos.length) throw notFound('ADVISOR_NOT_FOUND', 'Alguno de los asesores no existe en este evento.')
    for (const asesor of asesores) {
        if (opciones.regenerar || !asesor.enlaceToken) await asignarToken(asesor.id)
    }
    return listarEnlaces(eventoId)
}

/** Desactiva el enlace de un asesor: el token deja de valer y el panel vuelve a ofrecer «Crear enlace». */
export async function revocarEnlace(eventoId: number, asesorId: number): Promise<void> {
    const { count } = await prisma.asesor.updateMany({
        where: { id: asesorId, eventoId },
        data: { enlaceToken: null, enlaceCreadoEn: null, enlaceUltimoAcceso: null },
    })
    if (!count) throw notFound('ADVISOR_NOT_FOUND', 'El asesor no existe en este evento.')
}

export interface AsesorDelEnlace {
    id: number
    nombre: string
    evento: { id: number, nombre: string, nombreCorto: string }
}

/** Asesor dueño del token (y su evento); anota el acceso. Cualquier token inválido responde igual (`LINK_NOT_FOUND`). */
export async function asesorDelEnlace(token: string): Promise<AsesorDelEnlace> {
    if (!REGEX_TOKEN.test(token)) throw enlaceInvalido()
    const asesor = await prisma.asesor.findUnique({
        where: { enlaceToken: token },
        select: { id: true, nombre: true, enlaceUltimoAcceso: true, evento: { select: { id: true, nombre: true, nombreCorto: true } } },
    })
    if (!asesor) throw enlaceInvalido()
    const ahora = new Date()
    if (!asesor.enlaceUltimoAcceso || ahora.getTime() - asesor.enlaceUltimoAcceso.getTime() > ANOTAR_ACCESO_CADA_MS) {
        // El acceso es un dato de cortesía: si no se puede anotar, el docente igual ve su avance
        await prisma.asesor.update({ where: { id: asesor.id }, data: { enlaceUltimoAcceso: ahora } }).catch(() => undefined)
    }
    return { id: asesor.id, nombre: asesor.nombre, evento: asesor.evento }
}

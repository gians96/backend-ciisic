import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { ANOTAR_ACCESO_CADA_MS, enlaceInvalido, nuevoToken, REGEX_TOKEN } from './enlaces'
import { compararCiclos } from './seguimiento'

/**
 * Enlaces públicos de los ciclos (spec 027). Como los de los docentes (spec 026), cada uno es un token aleatorio
 * de 256 bits y **es** la credencial: solo el staff con `reportes.gestionar` lo ve, lo crea, lo renueva o lo
 * desactiva. Se guardan en `enlaces_ciclo`, aparte del padrón, así que recargar el padrón no los invalida.
 */

export interface EnlaceCiclo {
    /** Ciclo tal como viene en el padrón («VI»). */
    ciclo: string
    /** Estudiantes del padrón en ese ciclo (0 si el ciclo ya no está en el padrón cargado). */
    alumnos: number
    /** `null`: el ciclo no tiene enlace. */
    token: string | null
    creadoEn: string | null
    ultimoAcceso: string | null
}

const mismoCiclo = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()

/** Ciclos del padrón cargado con su cantidad de estudiantes, en orden académico. */
async function ciclosDelPadron(eventoId: number): Promise<Array<{ ciclo: string, alumnos: number }>> {
    const grupos = await prisma.padronEstudiante.groupBy({ by: ['ciclo'], where: { eventoId }, _count: { _all: true } })
    return grupos.map((g) => ({ ciclo: g.ciclo, alumnos: g._count._all })).sort((a, b) => compararCiclos(a.ciclo, b.ciclo))
}

/**
 * Cada ciclo del padrón con su enlace (o `null`). Un enlace cuyo ciclo ya no está en el padrón (se recargó sin
 * él) también aparece, con 0 estudiantes, para que se pueda desactivar.
 */
export async function listarEnlacesCiclo(eventoId: number): Promise<EnlaceCiclo[]> {
    const [ciclos, enlaces] = await Promise.all([
        ciclosDelPadron(eventoId),
        prisma.enlaceCiclo.findMany({ where: { eventoId }, select: { ciclo: true, token: true, creadoEn: true, ultimoAcceso: true } }),
    ])
    const enlaceDe = (ciclo: string) => enlaces.find((e) => mismoCiclo(e.ciclo, ciclo))
    const lista: EnlaceCiclo[] = ciclos.map(({ ciclo, alumnos }) => {
        const enlace = enlaceDe(ciclo)
        return { ciclo, alumnos, token: enlace?.token ?? null, creadoEn: enlace?.creadoEn.toISOString() ?? null, ultimoAcceso: enlace?.ultimoAcceso?.toISOString() ?? null }
    })
    for (const enlace of enlaces) {
        if (!ciclos.some((c) => mismoCiclo(c.ciclo, enlace.ciclo))) {
            lista.push({ ciclo: enlace.ciclo, alumnos: 0, token: enlace.token, creadoEn: enlace.creadoEn.toISOString(), ultimoAcceso: enlace.ultimoAcceso?.toISOString() ?? null })
        }
    }
    return lista.sort((a, b) => compararCiclos(a.ciclo, b.ciclo))
}

/** Crea o renueva el token de un ciclo; ante la (casi imposible) colisión del índice único prueba con otro. */
async function asignarToken(eventoId: number, ciclo: string): Promise<void> {
    for (let intento = 0; intento < 3; intento++) {
        try {
            await prisma.enlaceCiclo.upsert({
                where: { eventoId_ciclo: { eventoId, ciclo } },
                create: { eventoId, ciclo, token: nuevoToken() },
                update: { token: nuevoToken(), creadoEn: new Date(), ultimoAcceso: null },
            })
            return
        } catch (error) {
            const colision = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
            if (!colision || intento === 2) throw error
        }
    }
}

/**
 * Crea los enlaces que faltan (de los ciclos indicados o de todos los del padrón). Con `regenerar` también
 * renueva los que ya existen: el enlace anterior deja de valer. Devuelve la lista completa.
 */
export async function crearEnlacesCiclo(eventoId: number, opciones: { ciclos?: string[], regenerar?: boolean }): Promise<EnlaceCiclo[]> {
    const existentes = await listarEnlacesCiclo(eventoId)
    const delPadron = existentes.filter((e) => e.alumnos > 0)
    let elegidos = delPadron
    if (opciones.ciclos) {
        elegidos = []
        for (const pedido of opciones.ciclos) {
            const hallado = delPadron.find((e) => mismoCiclo(e.ciclo, pedido))
            if (!hallado) throw notFound('CYCLE_NOT_FOUND', `El ciclo ${pedido.trim()} no está en el padrón de este evento.`)
            if (!elegidos.includes(hallado)) elegidos.push(hallado)
        }
    }
    for (const { ciclo, token } of elegidos) {
        if (opciones.regenerar || !token) await asignarToken(eventoId, ciclo)
    }
    return listarEnlacesCiclo(eventoId)
}

/** Desactiva el enlace de un ciclo: el token deja de valer y el panel vuelve a ofrecer «Crear enlace». */
export async function revocarEnlaceCiclo(eventoId: number, ciclo: string): Promise<void> {
    const { count } = await prisma.enlaceCiclo.deleteMany({ where: { eventoId, ciclo } })
    if (count) return
    // Sin enlace que borrar: es válido si el ciclo existe (ya estaba desactivado) y un error si no existe
    const ciclos = await ciclosDelPadron(eventoId)
    if (!ciclos.some((c) => mismoCiclo(c.ciclo, ciclo))) throw notFound('CYCLE_NOT_FOUND', `El ciclo ${ciclo.trim()} no está en el padrón de este evento.`)
}

export interface CicloDelEnlace {
    ciclo: string
    evento: { id: number, nombre: string, nombreCorto: string }
}

/** Ciclo dueño del token (y su evento); anota el acceso. Cualquier token inválido responde igual (`LINK_NOT_FOUND`). */
export async function cicloDelEnlace(token: string): Promise<CicloDelEnlace> {
    if (!REGEX_TOKEN.test(token)) throw enlaceInvalido()
    const enlace = await prisma.enlaceCiclo.findUnique({
        where: { token },
        select: { id: true, ciclo: true, ultimoAcceso: true, evento: { select: { id: true, nombre: true, nombreCorto: true } } },
    })
    if (!enlace) throw enlaceInvalido()
    const ahora = new Date()
    if (!enlace.ultimoAcceso || ahora.getTime() - enlace.ultimoAcceso.getTime() > ANOTAR_ACCESO_CADA_MS) {
        // El acceso es un dato de cortesía: si no se puede anotar, igual se muestra el avance
        await prisma.enlaceCiclo.update({ where: { id: enlace.id }, data: { ultimoAcceso: ahora } }).catch(() => undefined)
    }
    return { ciclo: enlace.ciclo, evento: enlace.evento }
}

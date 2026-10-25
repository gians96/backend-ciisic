import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { aFilaLista, detalleInclude } from '../../inscription/services/mappers'
import type { ActualizarDelegacionInput, CrearDelegacionInput } from '../validation'

/** Datos del delegado que se muestran en la delegación (spec 018). */
const DATOS_DELEGADO = {
    id: true, nombres: true, apellidos: true, tipoDocumentoId: true, numeroDocumento: true, correo: true,
} as const

const incluirDelegacion = {
    delegado: { select: DATOS_DELEGADO },
    _count: { select: { inscripciones: true } },
} satisfies Prisma.DelegacionInclude

type DelegacionRegistro = Prisma.DelegacionGetPayload<{ include: typeof incluirDelegacion }>

export function aDelegacion(d: DelegacionRegistro) {
    return {
        id: d.id,
        eventoId: d.eventoId,
        nombre: d.nombre,
        tipo: d.tipo,
        abreviatura: d.abreviatura,
        activo: d.activo,
        delegado: d.delegado
            ? {
                id: d.delegado.id,
                nombres: d.delegado.nombres,
                apellidos: d.delegado.apellidos,
                tipoDocumento: d.delegado.tipoDocumentoId,
                numeroDocumento: d.delegado.numeroDocumento,
                correo: d.delegado.correo,
            }
            : null,
        totalInscripciones: d._count.inscripciones,
        creadoEn: d.creadoEn,
        actualizadoEn: d.actualizadoEn,
    }
}

export type DelegacionSalida = ReturnType<typeof aDelegacion>

export async function obtenerDelegacion(id: number): Promise<DelegacionRegistro> {
    const delegacion = await prisma.delegacion.findUnique({ where: { id }, include: incluirDelegacion })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe.')
    return delegacion
}

/** El delegado es una persona del padrón: si no existe, 404 (el panel la da de alta antes). */
async function exigirDelegado(delegadoId: number): Promise<void> {
    const delegado = await prisma.participante.findUnique({ where: { id: delegadoId }, select: { id: true } })
    if (!delegado) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${delegadoId} no encontrado`)
}

/** Dos altas con el mismo nombre en el evento (índice único) se responden como un conflicto. */
function nombreDuplicado(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('DELEGATION_EXISTS', 'Ya existe una delegación con ese nombre en este evento.')
    }
    throw error
}

export async function listarDelegaciones(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const delegaciones = await prisma.delegacion.findMany({
        where: { eventoId },
        include: incluirDelegacion,
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    })
    return delegaciones.map(aDelegacion)
}

export async function crearDelegacion(eventoId: number, input: CrearDelegacionInput): Promise<DelegacionSalida> {
    await obtenerEventoPorId(eventoId)
    if (input.delegadoId) await exigirDelegado(input.delegadoId)
    try {
        const creada = await prisma.delegacion.create({
            data: {
                eventoId,
                nombre: input.nombre,
                tipo: input.tipo,
                abreviatura: input.abreviatura ?? null,
                delegadoId: input.delegadoId ?? null,
            },
            include: incluirDelegacion,
        })
        return aDelegacion(creada)
    } catch (error) {
        return nombreDuplicado(error)
    }
}

export async function actualizarDelegacion(id: number, input: ActualizarDelegacionInput): Promise<DelegacionSalida> {
    const actual = await obtenerDelegacion(id)
    if (input.delegadoId) await exigirDelegado(input.delegadoId)
    const data: Prisma.DelegacionUpdateInput = {
        ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
        ...(input.tipo !== undefined ? { tipo: input.tipo } : {}),
        ...(input.abreviatura !== undefined ? { abreviatura: input.abreviatura } : {}),
        ...(input.activo !== undefined ? { activo: input.activo } : {}),
        ...(input.delegadoId !== undefined
            ? { delegado: input.delegadoId ? { connect: { id: input.delegadoId } } : { disconnect: true } }
            : {}),
    }
    // Sin campos enviados no hay nada que cambiar (y Prisma no acepta un update vacío)
    if (!Object.keys(data).length) return aDelegacion(actual)
    try {
        const actualizada = await prisma.delegacion.update({ where: { id }, data, include: incluirDelegacion })
        return aDelegacion(actualizada)
    } catch (error) {
        return nombreDuplicado(error)
    }
}

/**
 * Listado de los participantes inscritos en una delegación (spec 018): filas de inscripción
 * paginadas, con el mismo formato del listado de inscritos del evento. 404 si la delegación no
 * existe.
 */
export async function listarMiembros(delegacionId: number, paginacion: Pagination, conPago = true) {
    const delegacion = await obtenerDelegacion(delegacionId)
    const where = { delegacionId, eventoId: delegacion.eventoId }
    const [total, filas] = await Promise.all([
        prisma.inscripcion.count({ where }),
        prisma.inscripcion.findMany({
            where,
            include: detalleInclude,
            orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
            skip: paginacion.skip,
            take: paginacion.take,
        }),
    ])
    return { data: filas.map((fila) => aFilaLista(fila, conPago)), meta: pageMeta(paginacion, total) }
}

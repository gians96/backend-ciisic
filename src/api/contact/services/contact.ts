import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { pageMeta, type Pagination } from '../../../core/pagination'
import type { CrearMensajeInput } from '../validation'

export async function crearMensaje(eventoId: number | null, data: CrearMensajeInput) {
    const mensaje = await prisma.mensajeContacto.create({ data: { ...data, eventoId } })
    return { id: mensaje.id }
}

export async function listarMensajes(eventoId: number | undefined, leido: boolean | undefined, paginacion: Pagination) {
    const where = { ...(eventoId ? { eventoId } : {}), ...(leido !== undefined ? { leido } : {}) }
    const [total, data] = await Promise.all([
        prisma.mensajeContacto.count({ where }),
        prisma.mensajeContacto.findMany({ where, orderBy: { id: 'desc' }, skip: paginacion.skip, take: paginacion.take }),
    ])
    return { data, meta: pageMeta(paginacion, total) }
}

export async function obtenerMensaje(id: number) {
    const mensaje = await prisma.mensajeContacto.findUnique({ where: { id } })
    if (!mensaje) throw notFound('MESSAGE_NOT_FOUND', `Mensaje con id ${id} no encontrado`)
    return mensaje
}

export async function marcarLeido(id: number, leido: boolean) {
    await obtenerMensaje(id)
    return prisma.mensajeContacto.update({ where: { id }, data: { leido } })
}

export async function eliminarMensaje(id: number) {
    await obtenerMensaje(id)
    await prisma.mensajeContacto.delete({ where: { id } })
}

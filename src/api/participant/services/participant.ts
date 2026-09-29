import type { Participante, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import { pageMeta, type Pagination } from '../../../core/pagination'

export function aParticipante(p: Participante) {
    return {
        id: p.id,
        tipoDocumento: p.tipoDocumentoId,
        numeroDocumento: p.numeroDocumento,
        nombres: p.nombres,
        apellidos: p.apellidos,
        correo: p.correo,
        celular: p.celular,
        creadoEn: p.creadoEn,
        actualizadoEn: p.actualizadoEn,
    }
}

export async function listarParticipantes(q: string | undefined, paginacion: Pagination) {
    const texto = q?.trim()
    const where: Prisma.ParticipanteWhereInput = texto
        ? { OR: [{ numeroDocumento: { contains: texto } }, { nombres: { contains: texto } }, { apellidos: { contains: texto } }, { correo: { contains: texto } }] }
        : {}
    const [total, filas] = await Promise.all([
        prisma.participante.count({ where }),
        prisma.participante.findMany({ where, orderBy: { id: 'desc' }, skip: paginacion.skip, take: paginacion.take }),
    ])
    return { data: filas.map(aParticipante), meta: pageMeta(paginacion, total) }
}

export async function obtenerParticipante(id: number) {
    const p = await prisma.participante.findUnique({
        where: { id },
        include: { inscripciones: { include: { evento: true, estado: true, tipoInscripcion: true }, orderBy: { id: 'desc' } } },
    })
    if (!p) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${id} no encontrado`)
    return {
        ...aParticipante(p),
        inscripciones: p.inscripciones.map((i) => ({
            id: i.id,
            evento: { id: i.evento.id, codigo: i.evento.codigo, nombreCorto: i.evento.nombreCorto },
            estado: { codigo: i.estado.codigo, nombre: i.estado.nombre },
            tipoInscripcion: i.tipoInscripcion?.nombre ?? null,
            creadoEn: i.creadoEn,
        })),
    }
}

export async function actualizarParticipante(id: number, data: { nombres?: string, apellidos?: string, correo?: string, celular?: string }) {
    if (!await prisma.participante.findUnique({ where: { id } })) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${id} no encontrado`)
    if (data.correo) {
        const otro = await prisma.participante.findUnique({ where: { correo: data.correo } })
        if (otro && otro.id !== id) throw conflict('EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')
    }
    return aParticipante(await prisma.participante.update({ where: { id }, data }))
}

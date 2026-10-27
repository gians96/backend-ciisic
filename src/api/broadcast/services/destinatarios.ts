import type { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { obtenerEventoPorId } from '../../event/services/public-event'

/**
 * Destinatarios de los envíos masivos (spec 039): las inscripciones **aprobadas y presenciales** del evento
 * (un tipo presencial o sin tipo, como las cortesías: igual que `resolverElegibilidad`) y, en el canal
 * `virtual` (spec 043), las **aprobadas con un tipo virtual**. Cada canal lleva su propia marca de «ya se le
 * envió» en la inscripción, así se puede volver a elegir solo a quien falta.
 */
export type Canal = 'credencial' | 'ponencias' | 'virtual'

export interface FiltrosDestinatarios {
    q?: string
    /** `si`: ya recibió el envío; `no`: aún no. */
    enviado?: 'si' | 'no'
}

/** Aprobadas y presenciales del evento: la base de los envíos a presenciales y lo único a lo que el servidor deja enviar. */
export function aprobadasPresenciales(eventoId: number): Prisma.InscripcionWhereInput {
    return {
        eventoId,
        estado: { codigo: 'APROBADO' },
        OR: [{ tipoInscripcion: { modalidad: 'PRESENCIAL' } }, { tipoInscripcionId: null }],
    }
}

/** Aprobadas con un tipo virtual (spec 043). Sin tipo es presencial (`modalidadDe`), así que una cortesía no entra. */
export function aprobadasVirtuales(eventoId: number): Prisma.InscripcionWhereInput {
    return {
        eventoId,
        estado: { codigo: 'APROBADO' },
        tipoInscripcion: { modalidad: 'VIRTUAL' },
    }
}

/** Lo único a lo que el servidor deja enviar en cada canal. */
export function baseDelCanal(eventoId: number, canal: Canal): Prisma.InscripcionWhereInput {
    return canal === 'virtual' ? aprobadasVirtuales(eventoId) : aprobadasPresenciales(eventoId)
}

/** Marca de un canal en la inscripción, leída siempre por su nombre de campo (sin claves dinámicas). */
export function marcaDe(
    fila: { enlaceCredencialEnviadoEn: Date | null, enlacePonenciasEnviadoEn: Date | null, enlaceVirtualEnviadoEn: Date | null },
    canal: Canal,
): Date | null {
    if (canal === 'credencial') return fila.enlaceCredencialEnviadoEn
    if (canal === 'ponencias') return fila.enlacePonenciasEnviadoEn
    return fila.enlaceVirtualEnviadoEn
}

function conMarca(canal: Canal): Prisma.InscripcionWhereInput {
    if (canal === 'credencial') return { enlaceCredencialEnviadoEn: { not: null } }
    if (canal === 'ponencias') return { enlacePonenciasEnviadoEn: { not: null } }
    return { enlaceVirtualEnviadoEn: { not: null } }
}

function sinMarca(canal: Canal): Prisma.InscripcionWhereInput {
    if (canal === 'credencial') return { enlaceCredencialEnviadoEn: null }
    if (canal === 'ponencias') return { enlacePonenciasEnviadoEn: null }
    return { enlaceVirtualEnviadoEn: null }
}

/** Cada palabra de la búsqueda debe aparecer en el documento, los nombres o el correo. */
export function whereDestinatarios(eventoId: number, canal: Canal, filtros: FiltrosDestinatarios): Prisma.InscripcionWhereInput {
    const palabras = (filtros.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)
    const and: Prisma.InscripcionWhereInput[] = [baseDelCanal(eventoId, canal)]
    for (const palabra of palabras) {
        and.push({
            participante: {
                OR: [
                    { numeroDocumento: { contains: palabra } },
                    { nombres: { contains: palabra } },
                    { apellidos: { contains: palabra } },
                    { correo: { contains: palabra } },
                ],
            },
        })
    }
    if (filtros.enviado === 'si') and.push(conMarca(canal))
    if (filtros.enviado === 'no') and.push(sinMarca(canal))
    return { AND: and }
}

const seleccion = {
    id: true,
    enlaceCredencialEnviadoEn: true,
    enlacePonenciasEnviadoEn: true,
    enlaceVirtualEnviadoEn: true,
    participante: { select: { nombres: true, apellidos: true, tipoDocumentoId: true, numeroDocumento: true, correo: true } },
    tipoInscripcion: { select: { nombre: true, etiqueta: true } },
    clasificacion: { select: { nombre: true } },
} satisfies Prisma.InscripcionSelect

type FilaDestinatario = Prisma.InscripcionGetPayload<{ select: typeof seleccion }>

export function aDestinatario(fila: FilaDestinatario, canal: Canal) {
    return {
        id: fila.id,
        nombres: fila.participante.nombres,
        apellidos: fila.participante.apellidos,
        tipoDocumento: fila.participante.tipoDocumentoId,
        numeroDocumento: fila.participante.numeroDocumento,
        correo: fila.participante.correo,
        tipo: fila.tipoInscripcion ? { nombre: fila.tipoInscripcion.nombre, etiqueta: fila.tipoInscripcion.etiqueta } : null,
        clasificacion: fila.clasificacion?.nombre ?? null,
        enviadoEn: marcaDe(fila, canal),
    }
}

const orden = [{ participante: { apellidos: 'asc' } }, { participante: { nombres: 'asc' } }, { id: 'asc' }] satisfies Prisma.InscripcionOrderByWithRelationInput[]

/** Una página de destinatarios y, en `meta.resumen`, los totales del evento (no de los filtros). */
export async function listarDestinatarios(eventoId: number, canal: Canal, filtros: FiltrosDestinatarios, paginacion: Pagination) {
    await obtenerEventoPorId(eventoId)
    const base = baseDelCanal(eventoId, canal)
    const [filas, total, totalEvento, enviados] = await Promise.all([
        prisma.inscripcion.findMany({ where: whereDestinatarios(eventoId, canal, filtros), orderBy: orden, skip: paginacion.skip, take: paginacion.take, select: seleccion }),
        prisma.inscripcion.count({ where: whereDestinatarios(eventoId, canal, filtros) }),
        prisma.inscripcion.count({ where: base }),
        prisma.inscripcion.count({ where: { AND: [base, conMarca(canal)] } }),
    ])
    return {
        data: filas.map((fila) => aDestinatario(fila, canal)),
        meta: { ...pageMeta(paginacion, total), resumen: { total: totalEvento, enviados, pendientes: totalEvento - enviados } },
    }
}

/** Tope de ids que devuelve «elegir a todos»: más que cualquier evento real, y acota la consulta. */
const MAXIMO_IDS = 5000

/** Los ids de todos los destinatarios con los filtros dados: el panel los parte en tandas para enviar. */
export async function idsDestinatarios(eventoId: number, canal: Canal, filtros: FiltrosDestinatarios): Promise<{ ids: number[], total: number }> {
    await obtenerEventoPorId(eventoId)
    const where = whereDestinatarios(eventoId, canal, filtros)
    const [filas, total] = await Promise.all([
        prisma.inscripcion.findMany({ where, orderBy: orden, take: MAXIMO_IDS, select: { id: true } }),
        prisma.inscripcion.count({ where }),
    ])
    return { ids: filas.map((fila) => fila.id), total }
}

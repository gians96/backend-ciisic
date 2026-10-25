import { Prisma } from '@prisma/client'
import type { ModalidadPonencia, PonenciaEspecializada } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import { aColumnaFecha, fechaSoloDia, horaLima, instanteLima } from '../../../core/fechas'
import { aNumero } from '../../../core/catalogos'
import { coponentesDe, duracionMinutos } from '../../../core/ponencias-especializadas'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { ActualizarPonenciaInput, CrearPonenciaInput } from '../validation'

/**
 * `inscritos` es el total vigente; solo los `presenciales` ocupan aforo (spec 030): los virtuales no tienen
 * límite y nunca agotan el cupo.
 */
export interface Conteo {
    inscritos: number
    presenciales: number
    virtuales: number
    asistentes: number
}

const SIN_INSCRITOS: Conteo = { inscritos: 0, presenciales: 0, virtuales: 0, asistentes: 0 }

function cuposDisponibles(ponencia: Pick<PonenciaEspecializada, 'cupo'>, presenciales: number): number | null {
    return ponencia.cupo === null ? null : Math.max(0, ponencia.cupo - presenciales)
}

function datosBase(ponencia: PonenciaEspecializada) {
    const precio = aNumero(ponencia.precio) ?? 0
    return {
        id: ponencia.id,
        eventoId: ponencia.eventoId,
        tema: ponencia.tema,
        fecha: fechaSoloDia(ponencia.fecha),
        horaInicio: horaLima(ponencia.horaInicio),
        horaFin: horaLima(ponencia.horaFin),
        duracionMin: duracionMinutos(ponencia),
        ambiente: ponencia.ambiente,
        modalidad: ponencia.modalidad,
        precio,
        esGratuita: precio === 0,
        cupo: ponencia.cupo,
        ponente: {
            nombre: ponencia.ponenteNombre,
            bio: ponencia.ponenteBio,
            foto: ponencia.ponenteFoto,
            externo: ponencia.ponenteExterno,
        },
        /** Los demás ponentes del tema (spec 032); `[]` si lo dicta una sola persona. */
        coponentes: coponentesDe(ponencia.coponentes),
        orden: ponencia.orden,
    }
}

type PonenteEntrada = { nombre: string, bio?: string | null, foto?: string | null, externo?: boolean }

/** Lo que se guarda en la columna JSON: sin lista, `NULL` (una sola forma de «sin coponentes») y siempre con las cuatro claves. */
function aColumnaCoponentes(lista: readonly PonenteEntrada[] | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (!lista?.length) return Prisma.DbNull
    return lista.map((p) => ({ nombre: p.nombre, bio: p.bio ?? null, foto: p.foto ?? null, externo: p.externo ?? false }))
}

/** Respuesta del panel: con inscritos, asistentes y si está publicada. */
export function aPonencia(ponencia: PonenciaEspecializada, conteo: Conteo = SIN_INSCRITOS) {
    return {
        ...datosBase(ponencia),
        publicada: ponencia.publicada,
        inscritos: conteo.inscritos,
        inscritosPresenciales: conteo.presenciales,
        inscritosVirtuales: conteo.virtuales,
        asistentes: conteo.asistentes,
        cuposDisponibles: cuposDisponibles(ponencia, conteo.presenciales),
    }
}

/** Respuesta del sitio: sin datos de inscritos, solo los cupos presenciales que quedan (`llena` = aforo presencial completo). */
export function aPonenciaPublica(ponencia: PonenciaEspecializada, presenciales: number) {
    const disponibles = cuposDisponibles(ponencia, presenciales)
    return { ...datosBase(ponencia), cuposDisponibles: disponibles, llena: disponibles === 0 }
}

/**
 * Respuesta del enlace público del aforo (spec 036): el aforo presencial, cuántos lo ocupan (`inscritos`, solo presenciales)
 * y cuántos asistieron. De los ponentes solo nombre, foto y si es externo; nada de inscritos, precio ni biografía.
 */
export function aPonenciaAforo(ponencia: PonenciaEspecializada, conteo: Conteo = SIN_INSCRITOS) {
    const base = datosBase(ponencia)
    const disponibles = cuposDisponibles(ponencia, conteo.presenciales)
    const ponente = ({ nombre, foto, externo }: { nombre: string, foto: string | null, externo: boolean }) => ({ nombre, foto, externo })
    return {
        id: base.id,
        tema: base.tema,
        fecha: base.fecha,
        horaInicio: base.horaInicio,
        horaFin: base.horaFin,
        duracionMin: base.duracionMin,
        ambiente: base.ambiente,
        modalidad: base.modalidad,
        ponente: ponente(base.ponente),
        coponentes: base.coponentes.map(ponente),
        cupo: base.cupo,
        inscritos: conteo.presenciales,
        cuposDisponibles: disponibles,
        llena: disponibles === 0,
        asistentes: conteo.asistentes,
        orden: base.orden,
    }
}

export async function obtenerPonencia(id: number): Promise<PonenciaEspecializada> {
    const ponencia = await prisma.ponenciaEspecializada.findUnique({ where: { id } })
    if (!ponencia) throw notFound('TALK_NOT_FOUND', 'La ponencia no existe.')
    return ponencia
}

/** Inscritos vigentes (presenciales y virtuales) y los que ya asistieron, por ponencia del evento (o de las ids dadas). */
export async function conteosPorPonencia(filtro: { eventoId: number } | { ids: number[] }): Promise<Map<number, Conteo>> {
    const ponencia = 'eventoId' in filtro ? { eventoId: filtro.eventoId } : { id: { in: filtro.ids } }
    const base = { ponencia, estado: 'INSCRITO' as const }
    const [inscritos, asistentes] = await Promise.all([
        prisma.inscripcionPonencia.groupBy({ by: ['ponenciaId', 'modoAsistencia'], where: base, _count: { _all: true } }),
        prisma.inscripcionPonencia.groupBy({ by: ['ponenciaId'], where: { ...base, asistioEn: { not: null } }, _count: { _all: true } }),
    ])
    const conteos = new Map<number, Conteo>()
    for (const fila of inscritos) {
        const actual = conteos.get(fila.ponenciaId) ?? { ...SIN_INSCRITOS }
        const total = fila._count._all
        conteos.set(fila.ponenciaId, {
            ...actual,
            inscritos: actual.inscritos + total,
            ...(fila.modoAsistencia === 'VIRTUAL' ? { virtuales: actual.virtuales + total } : { presenciales: actual.presenciales + total }),
        })
    }
    for (const fila of asistentes) {
        const actual = conteos.get(fila.ponenciaId) ?? { ...SIN_INSCRITOS }
        conteos.set(fila.ponenciaId, { ...actual, asistentes: fila._count._all })
    }
    return conteos
}

const ORDEN: Prisma.PonenciaEspecializadaOrderByWithRelationInput[] = [{ fecha: 'asc' }, { horaInicio: 'asc' }, { orden: 'asc' }, { id: 'asc' }]

export async function listarPonencias(eventoId: number, filtros: { fecha?: string, modalidad?: ModalidadPonencia } = {}) {
    await obtenerEventoPorId(eventoId)
    const [ponencias, conteos] = await Promise.all([
        prisma.ponenciaEspecializada.findMany({
            where: {
                eventoId,
                ...(filtros.fecha ? { fecha: aColumnaFecha(filtros.fecha) } : {}),
                ...(filtros.modalidad ? { modalidad: filtros.modalidad } : {}),
            },
            orderBy: ORDEN,
        }),
        conteosPorPonencia({ eventoId }),
    ])
    return ponencias.map((ponencia) => aPonencia(ponencia, conteos.get(ponencia.id)))
}

/** Ponencias publicadas del evento del token, con los cupos que quedan. */
export async function listarPublicas(eventoId: number) {
    const [ponencias, conteos] = await Promise.all([
        prisma.ponenciaEspecializada.findMany({ where: { eventoId, publicada: true }, orderBy: ORDEN }),
        conteosPorPonencia({ eventoId }),
    ])
    return ponencias.map((ponencia) => aPonenciaPublica(ponencia, conteos.get(ponencia.id)?.presenciales ?? 0))
}

/** Ponencias publicadas del evento con su aforo, inscritos presenciales y asistencia (enlace público, spec 036). */
export async function listarAforo(eventoId: number) {
    const [ponencias, conteos] = await Promise.all([
        prisma.ponenciaEspecializada.findMany({ where: { eventoId, publicada: true }, orderBy: ORDEN }),
        conteosPorPonencia({ eventoId }),
    ])
    return ponencias.map((ponencia) => aPonenciaAforo(ponencia, conteos.get(ponencia.id)))
}

/** Dos ponencias presenciales no pueden usar el mismo ambiente a la vez (el nombre se compara sin distinguir mayúsculas). */
async function exigirAmbienteLibre(eventoId: number, ambiente: string, inicio: Date, fin: Date, excluirId?: number) {
    const ocupada = await prisma.ponenciaEspecializada.findFirst({
        where: {
            eventoId,
            modalidad: 'PRESENCIAL',
            ambiente,
            horaInicio: { lt: fin },
            horaFin: { gt: inicio },
            ...(excluirId ? { id: { not: excluirId } } : {}),
        },
        select: { tema: true },
    })
    if (ocupada) throw conflict('ROOM_CONFLICT', `El ambiente «${ambiente}» ya está ocupado a esa hora por «${ocupada.tema}».`)
}

export async function crearPonencia(eventoId: number, input: CrearPonenciaInput) {
    await obtenerEventoPorId(eventoId)
    const inicio = instanteLima(input.fecha, input.horaInicio)
    const fin = instanteLima(input.fecha, input.horaFin)
    if (input.modalidad === 'PRESENCIAL') await exigirAmbienteLibre(eventoId, input.ambiente, inicio, fin)
    const creada = await prisma.ponenciaEspecializada.create({
        data: {
            eventoId,
            tema: input.tema,
            fecha: aColumnaFecha(input.fecha),
            horaInicio: inicio,
            horaFin: fin,
            ambiente: input.ambiente,
            modalidad: input.modalidad as ModalidadPonencia,
            precio: input.precio,
            cupo: input.cupo ?? null,
            ponenteNombre: input.ponente.nombre,
            ponenteBio: input.ponente.bio ?? null,
            ponenteFoto: input.ponente.foto ?? null,
            ponenteExterno: input.ponente.externo ?? false,
            coponentes: aColumnaCoponentes(input.coponentes),
            publicada: input.publicada,
            orden: input.orden,
        },
    })
    return aPonencia(creada)
}

export async function actualizarPonencia(id: number, input: ActualizarPonenciaInput) {
    const actual = await obtenerPonencia(id)
    const fecha = input.fecha ?? fechaSoloDia(actual.fecha) ?? ''
    const horaInicio = input.horaInicio ?? horaLima(actual.horaInicio)
    const horaFin = input.horaFin ?? horaLima(actual.horaFin)
    if (horaFin <= horaInicio) throw conflict('INVALID_HOURS', 'La hora de fin debe ser posterior a la de inicio.')
    const inicio = instanteLima(fecha, horaInicio)
    const fin = instanteLima(fecha, horaFin)
    const modalidad = (input.modalidad ?? actual.modalidad) as ModalidadPonencia
    const ambiente = input.ambiente ?? actual.ambiente
    if (modalidad === 'PRESENCIAL') await exigirAmbienteLibre(actual.eventoId, ambiente, inicio, fin, id)

    // El cupo es el aforo presencial: los virtuales no lo ocupan
    if (input.cupo !== undefined && input.cupo !== null) {
        const presenciales = await prisma.inscripcionPonencia.count({ where: { ponenciaId: id, estado: 'INSCRITO', modoAsistencia: 'PRESENCIAL' } })
        if (input.cupo < presenciales) throw conflict('CAPACITY_BELOW_REGISTERED', `Ya hay ${presenciales} inscritos presenciales: el cupo no puede ser menor.`)
    }

    const { ponente } = input
    const actualizada = await prisma.ponenciaEspecializada.update({
        where: { id },
        data: {
            ...(input.tema !== undefined ? { tema: input.tema } : {}),
            fecha: aColumnaFecha(fecha),
            horaInicio: inicio,
            horaFin: fin,
            ...(input.ambiente !== undefined ? { ambiente: input.ambiente } : {}),
            ...(input.modalidad !== undefined ? { modalidad } : {}),
            ...(input.precio !== undefined ? { precio: input.precio } : {}),
            ...(input.cupo !== undefined ? { cupo: input.cupo } : {}),
            ...(ponente?.nombre !== undefined ? { ponenteNombre: ponente.nombre } : {}),
            ...(ponente?.bio !== undefined ? { ponenteBio: ponente.bio } : {}),
            ...(ponente?.foto !== undefined ? { ponenteFoto: ponente.foto } : {}),
            ...(ponente?.externo !== undefined ? { ponenteExterno: ponente.externo } : {}),
            ...(input.coponentes !== undefined ? { coponentes: aColumnaCoponentes(input.coponentes) } : {}),
            ...(input.publicada !== undefined ? { publicada: input.publicada } : {}),
            ...(input.orden !== undefined ? { orden: input.orden } : {}),
        },
    })
    const conteo = (await conteosPorPonencia({ ids: [id] })).get(id)
    return aPonencia(actualizada, conteo)
}

const conInscritos = () => conflict('TALK_HAS_REGISTRATIONS', 'La ponencia tiene inscritos vigentes. Despublícala o cancela sus inscripciones primero.')

/** Solo se borra una ponencia sin inscritos vigentes; las inscripciones canceladas se borran con ella. */
export async function eliminarPonencia(id: number) {
    await obtenerPonencia(id)
    const vigentes = await prisma.inscripcionPonencia.count({ where: { ponenciaId: id, estado: 'INSCRITO' } })
    if (vigentes) throw conInscritos()
    try {
        await prisma.$transaction([
            prisma.inscripcionPonencia.deleteMany({ where: { ponenciaId: id, estado: 'CANCELADO' } }),
            prisma.ponenciaEspecializada.delete({ where: { id } }),
        ])
    } catch (error) {
        // Alguien se inscribió entre la comprobación y el borrado: la FK lo impide
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw conInscritos()
        throw error
    }
}

import { Prisma } from '@prisma/client'
import type { Evento, ModalidadAsistencia, ModalidadPonencia, PonenciaEspecializada, ProcedenciaAsistente } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { aColumnaFecha, fechaSoloDia, horaLima } from '../../../core/fechas'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { seCruzan } from '../../../core/ponencias-especializadas'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { aAsistente, obtenerOCrearAsistente } from './asistentes'
import { resolverAcceso, selloDe, type Sello } from './congresista'
import { aPonenciaPublica, conteosPorPonencia, obtenerPonencia } from './talks'
import type { AsistenteInput, EditarInscripcionInput, InscripcionSitioInput } from '../validation'

export type Db = Prisma.TransactionClient

// ─── Cupo ───────────────────────────────────────────────────────────────────

/**
 * Bloquea las filas de las ponencias (siempre en orden de id, para no cruzar bloqueos) y las relee ya
 * bloqueadas: el cupo se comprueba y se ocupa sin que otra inscripción se cuele entre medias.
 */
export async function bloquearPonencias(tx: Db, ids: number[]): Promise<PonenciaEspecializada[]> {
    const ordenadas = [...new Set(ids)].sort((a, b) => a - b)
    await tx.$queryRaw`SELECT id FROM ponencias_especializadas WHERE id IN (${Prisma.join(ordenadas)}) ORDER BY id FOR UPDATE`
    return tx.ponenciaEspecializada.findMany({ where: { id: { in: ordenadas } }, orderBy: { id: 'asc' } })
}

/**
 * Lanza 409 `TALK_FULL` si el aforo presencial de la ponencia ya está completo. El cupo cuenta solo las
 * inscripciones presenciales vigentes (spec 030): una virtual no lo consume ni se bloquea por él.
 */
export async function exigirCupo(tx: Db, ponencia: Pick<PonenciaEspecializada, 'id' | 'tema' | 'cupo'>, modo: ModalidadAsistencia = 'PRESENCIAL'): Promise<void> {
    if (modo === 'VIRTUAL' || ponencia.cupo === null) return
    const presenciales = await tx.inscripcionPonencia.count({ where: { ponenciaId: ponencia.id, estado: 'INSCRITO', modoAsistencia: 'PRESENCIAL' } })
    if (presenciales >= ponencia.cupo) throw conflict('TALK_FULL', `La ponencia «${ponencia.tema}» ya no tiene cupos disponibles.`)
}

/**
 * Una inscripción vigente cuyo sello (con qué inscripción al congreso se validó y su modo) cambia: por
 * ejemplo, la que se hizo antes de la validación y ahora se valida. Pasar de virtual a presencial pide cupo.
 */
export async function sellarInscripcion(tx: Db, previa: { id: number, inscripcionCongresoId: number | null, modoAsistencia: ModalidadAsistencia }, ponencia: Pick<PonenciaEspecializada, 'id' | 'tema' | 'cupo'>, sello: Sello): Promise<boolean> {
    if (previa.inscripcionCongresoId === sello.inscripcionCongresoId && previa.modoAsistencia === sello.modoAsistencia) return false
    if (previa.modoAsistencia === 'VIRTUAL' && sello.modoAsistencia === 'PRESENCIAL') await exigirCupo(tx, ponencia, 'PRESENCIAL')
    await tx.inscripcionPonencia.update({ where: { id: previa.id }, data: sello })
    return true
}

// ─── Respuestas ─────────────────────────────────────────────────────────────

const PERSONA_STAFF = { select: { id: true, nombres: true, apellidos: true } } as const

const INCLUIR = {
    asistente: true,
    ponencia: { select: { id: true, tema: true, fecha: true, horaInicio: true, horaFin: true, ambiente: true, modalidad: true } },
    registradoPor: PERSONA_STAFF,
    asistenciaPor: PERSONA_STAFF,
    inscripcionCongreso: {
        select: {
            estado: { select: { codigo: true } },
            tipoInscripcion: { select: { nombre: true, categoria: { select: { nombre: true } } } },
        },
    },
} satisfies Prisma.InscripcionPonenciaInclude

type InscripcionCompleta = Prisma.InscripcionPonenciaGetPayload<{ include: typeof INCLUIR }>

export function aInscripcion(fila: InscripcionCompleta) {
    return {
        id: fila.id,
        estado: fila.estado,
        origen: fila.origen,
        creadoEn: fila.creadoEn,
        canceladoEn: fila.canceladoEn,
        motivoCancelacion: fila.motivoCancelacion,
        asistioEn: fila.asistioEn,
        esFueraDeHorario: fila.esFueraDeHorario,
        // Spec 030: con qué inscripción al congreso se validó (null = sin validar) y cómo asiste
        validada: fila.inscripcionCongresoId !== null,
        modoAsistencia: fila.modoAsistencia,
        congreso: fila.inscripcionCongreso
            ? {
                estado: fila.inscripcionCongreso.estado.codigo,
                tipo: fila.inscripcionCongreso.tipoInscripcion?.nombre ?? null,
                categoria: fila.inscripcionCongreso.tipoInscripcion?.categoria.nombre ?? null,
            }
            : null,
        asistente: aAsistente(fila.asistente),
        ponencia: {
            id: fila.ponencia.id,
            tema: fila.ponencia.tema,
            fecha: fechaSoloDia(fila.ponencia.fecha),
            horaInicio: horaLima(fila.ponencia.horaInicio),
            horaFin: horaLima(fila.ponencia.horaFin),
            ambiente: fila.ponencia.ambiente,
            modalidad: fila.ponencia.modalidad,
        },
        registradoPor: fila.registradoPor,
        asistenciaPor: fila.asistenciaPor,
    }
}

async function detalle(id: number) {
    const fila = await prisma.inscripcionPonencia.findUnique({ where: { id }, include: INCLUIR })
    if (!fila) throw notFound('REGISTRATION_NOT_FOUND', 'La inscripción no existe.')
    return aInscripcion(fila)
}

// ─── Listado del panel ──────────────────────────────────────────────────────

export interface FiltrosInscripciones {
    ponenciaId?: number
    fecha?: string
    modalidad?: ModalidadPonencia
    estado?: 'INSCRITO' | 'CANCELADO'
    asistencia?: 'si' | 'no'
    procedencia?: ProcedenciaAsistente | 'SIN_DATO'
    origen?: 'LANDING' | 'STAFF' | 'PUERTA'
    /** `si`: validadas con el congreso; `no`: sin validar. */
    validacion?: 'si' | 'no'
    /** Modo de asistencia (spec 030); no es la `modalidad` de la ponencia. */
    modo?: ModalidadAsistencia
    q?: string
}

function dondeDeFiltros(eventoId: number, filtros: FiltrosInscripciones): Prisma.InscripcionPonenciaWhereInput {
    // Cada palabra de la búsqueda debe aparecer en alguno de los datos de la persona
    const palabras = (filtros.q ?? '').split(/\s+/).filter(Boolean).slice(0, 5)
    return {
        ponencia: {
            eventoId,
            ...(filtros.fecha ? { fecha: aColumnaFecha(filtros.fecha) } : {}),
            ...(filtros.modalidad ? { modalidad: filtros.modalidad } : {}),
        },
        ...(filtros.ponenciaId ? { ponenciaId: filtros.ponenciaId } : {}),
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.asistencia === 'si' ? { asistioEn: { not: null } } : {}),
        ...(filtros.asistencia === 'no' ? { asistioEn: null } : {}),
        ...(filtros.origen ? { origen: filtros.origen } : {}),
        ...(filtros.validacion === 'si' ? { inscripcionCongresoId: { not: null } } : {}),
        ...(filtros.validacion === 'no' ? { inscripcionCongresoId: null } : {}),
        ...(filtros.modo ? { modoAsistencia: filtros.modo } : {}),
        asistente: {
            ...(filtros.procedencia ? { procedencia: filtros.procedencia === 'SIN_DATO' ? null : filtros.procedencia } : {}),
            ...(palabras.length
                ? {
                    AND: palabras.map((palabra) => ({
                        OR: [
                            { numeroDocumento: { contains: palabra } },
                            { nombres: { contains: palabra } },
                            { apellidos: { contains: palabra } },
                            { correo: { contains: palabra } },
                            { celular: { contains: palabra } },
                        ],
                    })),
                }
                : {}),
        },
    }
}

export async function listarInscripciones(eventoId: number, filtros: FiltrosInscripciones, paginacion: Pagination) {
    await obtenerEventoPorId(eventoId)
    const where = dondeDeFiltros(eventoId, filtros)
    const [total, asistieron, sinValidar, filas] = await Promise.all([
        prisma.inscripcionPonencia.count({ where }),
        prisma.inscripcionPonencia.count({ where: { ...where, asistioEn: { not: null } } }),
        prisma.inscripcionPonencia.count({ where: { ...where, estado: 'INSCRITO', inscripcionCongresoId: null } }),
        prisma.inscripcionPonencia.findMany({
            where,
            include: INCLUIR,
            orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
            skip: paginacion.skip,
            take: paginacion.take,
        }),
    ])
    return { data: filas.map(aInscripcion), meta: { ...pageMeta(paginacion, total), asistieron, sinValidar } }
}

// ─── Alta manual del staff ──────────────────────────────────────────────────

const yaInscrita = () => conflict('ALREADY_REGISTERED', 'La persona ya está inscrita en esta ponencia.')

/**
 * Inscribe a mano a una persona (staff con `especializadas.inscribir`). Respeta el cupo pero no la
 * regla de cruces de la landing. Una inscripción cancelada se reactiva. Salvo con el acceso libre, la
 * persona debe ser congresista con el pago aprobado (solo el documento: el staff la tiene delante); si
 * ya estaba inscrita sin validar, esta alta la valida.
 */
export async function inscribirManual(ponenciaId: number, input: AsistenteInput, actor: Actor) {
    const base = await obtenerPonencia(ponenciaId)
    const acceso = await resolverAcceso(base.eventoId, input, { exigirCorreo: false })
    const sello = selloDe(acceso)
    const { asistente } = await obtenerOCrearAsistente(input, 'PANEL', acceso.libre ? null : acceso)
    const id = await prisma.$transaction(async (tx) => {
        const [ponencia] = await bloquearPonencias(tx, [ponenciaId])
        if (!ponencia) throw notFound('TALK_NOT_FOUND', 'La ponencia no existe.')
        const previa = await tx.inscripcionPonencia.findUnique({ where: { ponenciaId_asistenteId: { ponenciaId, asistenteId: asistente.id } } })
        if (previa?.estado === 'INSCRITO') {
            if (acceso.libre || !(await sellarInscripcion(tx, previa, ponencia, sello))) throw yaInscrita()
            return previa.id
        }
        await exigirCupo(tx, ponencia, sello.modoAsistencia)
        const datos = { estado: 'INSCRITO' as const, origen: 'STAFF' as const, registradoPorId: actor.id, canceladoEn: null, motivoCancelacion: null, ...sello }
        if (previa) return (await tx.inscripcionPonencia.update({ where: { id: previa.id }, data: datos, select: { id: true } })).id
        return (await tx.inscripcionPonencia.create({ data: { ponenciaId, asistenteId: asistente.id, ...datos }, select: { id: true } })).id
    })
    return detalle(id)
}

// ─── Cancelar, reactivar y corregir datos ───────────────────────────────────

/**
 * `PATCH`: cancela o reactiva la inscripción y/o corrige los datos del asistente (que son de la
 * persona, no de la ponencia). No se cancela una inscripción con asistencia: primero se anula esta.
 */
export async function actualizarInscripcion(id: number, input: EditarInscripcionInput, actor: Actor, ahora = new Date()) {
    const actual = await prisma.inscripcionPonencia.findUnique({
        where: { id },
        select: {
            id: true,
            ponenciaId: true,
            asistenteId: true,
            estado: true,
            asistioEn: true,
            inscripcionCongresoId: true,
            modoAsistencia: true,
            ponencia: { select: { eventoId: true } },
            asistente: { select: { tipoDocumentoId: true, numeroDocumento: true } },
        },
    })
    if (!actual) throw notFound('REGISTRATION_NOT_FOUND', 'La inscripción no existe.')

    if (input.estado === 'CANCELADO' && actual.estado === 'INSCRITO') {
        if (actual.asistioEn) throw conflict('ALREADY_ATTENDED', 'La persona ya asistió: anula primero la asistencia para cancelar la inscripción.')
        await prisma.inscripcionPonencia.updateMany({
            where: { id, estado: 'INSCRITO', asistioEn: null },
            data: { estado: 'CANCELADO', canceladoEn: ahora, motivoCancelacion: 'STAFF' },
        })
        console.info(`[ponencias-especializadas] La cuenta ${actor.id} canceló la inscripción ${id}`)
    } else if (input.estado === 'INSCRITO' && actual.estado === 'CANCELADO') {
        // Una inscripción ya validada conserva su sello; una sin validar se valida ahora con el documento
        const sello: Sello = actual.inscripcionCongresoId !== null
            ? { inscripcionCongresoId: actual.inscripcionCongresoId, modoAsistencia: actual.modoAsistencia }
            : selloDe(await resolverAcceso(actual.ponencia.eventoId, { tipoDocumento: actual.asistente.tipoDocumentoId, numeroDocumento: actual.asistente.numeroDocumento }, { exigirCorreo: false }))
        await prisma.$transaction(async (tx) => {
            const [ponencia] = await bloquearPonencias(tx, [actual.ponenciaId])
            if (!ponencia) throw notFound('TALK_NOT_FOUND', 'La ponencia no existe.')
            await exigirCupo(tx, ponencia, sello.modoAsistencia)
            await tx.inscripcionPonencia.update({ where: { id }, data: { estado: 'INSCRITO', canceladoEn: null, motivoCancelacion: null, registradoPorId: actor.id, ...sello } })
        })
        console.info(`[ponencias-especializadas] La cuenta ${actor.id} reactivó la inscripción ${id}`)
    }

    if (input.asistente) {
        const { nombres, apellidos, correo, celular, procedencia } = input.asistente
        const data: Prisma.AsistentePonenciaUpdateInput = {
            ...(nombres !== undefined ? { nombres } : {}),
            ...(apellidos !== undefined ? { apellidos } : {}),
            ...(correo !== undefined ? { correo } : {}),
            ...(celular !== undefined ? { celular } : {}),
            ...(procedencia !== undefined ? { procedencia: procedencia as ProcedenciaAsistente | null } : {}),
        }
        await prisma.asistentePonencia.update({ where: { id: actual.asistenteId }, data })
        console.info(`[ponencias-especializadas] La cuenta ${actor.id} corrigió los datos del asistente ${actual.asistenteId}`)
    }
    return detalle(id)
}

/** Anula la asistencia (la inscripción sigue vigente). */
export async function anularAsistencia(id: number, actor: Actor) {
    const { count } = await prisma.inscripcionPonencia.updateMany({
        where: { id, asistioEn: { not: null } },
        data: { asistioEn: null, asistenciaPorId: null, esFueraDeHorario: false },
    })
    if (!count) throw notFound('ATTENDANCE_NOT_FOUND', 'La asistencia no existe o ya fue anulada.')
    console.info(`[ponencias-especializadas] La cuenta ${actor.id} anuló la asistencia de la inscripción ${id}`)
}

// ─── Inscripción desde la landing ───────────────────────────────────────────

const choque = (a: { tema: string }, b: { tema: string }) =>
    conflict('SCHEDULE_CONFLICT', `«${a.tema}» se cruza en horario con «${b.tema}». Elige una de las dos.`)

/**
 * Inscripción pública (token del evento): una persona a de 1 a 4 ponencias, todo o nada. Solo
 * ponencias publicadas, gratuitas y que no hayan terminado; sin cruces de horario (entre sí ni con
 * las que la persona ya tiene) y con cupo. Repetir una inscripción vigente es idempotente
 * (`yaInscrito`). Nunca modifica los datos de un asistente que ya existe.
 *
 * Spec 030: salvo con el acceso libre del evento, la persona debe ser congresista con el pago aprobado
 * (documento + correo registrado). Su modo (el del tipo de inscripción) decide si ocupa aforo: una
 * presencial pide cupo, una virtual no. Quien ya estaba inscrito sin validar queda validado.
 */
export async function inscribirDesdeSitio(evento: Pick<Evento, 'id'>, input: InscripcionSitioInput, ahora = new Date()) {
    const ids = [...new Set(input.ponenciaIds)]
    const ponencias = await prisma.ponenciaEspecializada.findMany({ where: { id: { in: ids }, eventoId: evento.id, publicada: true } })
    if (ponencias.length !== ids.length) throw notFound('TALK_NOT_FOUND', 'Alguna de las ponencias elegidas no existe o no está disponible.')

    for (const ponencia of ponencias) {
        if (Number(ponencia.precio) > 0) {
            throw unprocessable('PAID_TALK_UNAVAILABLE', `La ponencia «${ponencia.tema}» es de pago: la inscripción se realiza con la organización.`)
        }
        if (ponencia.horaFin < ahora) throw conflict('TALK_ENDED', `La ponencia «${ponencia.tema}» ya terminó.`)
    }
    ponencias.forEach((a, i) => {
        const cruzada = ponencias.slice(i + 1).find((b) => seCruzan(a, b))
        if (cruzada) throw choque(a, cruzada)
    })

    const acceso = await resolverAcceso(evento.id, input.asistente, { exigirCorreo: true })
    const sello = selloDe(acceso)
    const { asistente } = await obtenerOCrearAsistente(input.asistente, 'SITIO', acceso.libre ? null : acceso)

    const resultado = await prisma.$transaction(async (tx) => {
        const bloqueadas = await bloquearPonencias(tx, ids)
        const vigentes = await tx.inscripcionPonencia.findMany({
            where: { asistenteId: asistente.id, estado: 'INSCRITO', ponencia: { eventoId: evento.id } },
            select: { ponenciaId: true, ponencia: { select: { tema: true, horaInicio: true, horaFin: true } } },
        })
        const previas = await tx.inscripcionPonencia.findMany({
            where: { asistenteId: asistente.id, ponenciaId: { in: ids } },
            select: { id: true, ponenciaId: true, estado: true, inscripcionCongresoId: true, modoAsistencia: true },
        })
        const filas: { id: number, ponenciaId: number, yaInscrito: boolean }[] = []

        for (const ponencia of bloqueadas) {
            const previa = previas.find((fila) => fila.ponenciaId === ponencia.id)
            if (previa?.estado === 'INSCRITO') {
                if (!acceso.libre) await sellarInscripcion(tx, previa, ponencia, sello)
                filas.push({ id: previa.id, ponenciaId: ponencia.id, yaInscrito: true })
                continue
            }
            const otra = vigentes.find((fila) => fila.ponenciaId !== ponencia.id && seCruzan(fila.ponencia, ponencia))
            if (otra) throw choque(ponencia, otra.ponencia)
            await exigirCupo(tx, ponencia, sello.modoAsistencia)
            const datos = { estado: 'INSCRITO' as const, origen: 'LANDING' as const, canceladoEn: null, motivoCancelacion: null, ...sello }
            const id = previa
                ? (await tx.inscripcionPonencia.update({ where: { id: previa.id }, data: datos, select: { id: true } })).id
                : (await tx.inscripcionPonencia.create({ data: { ponenciaId: ponencia.id, asistenteId: asistente.id, ...datos }, select: { id: true } })).id
            filas.push({ id, ponenciaId: ponencia.id, yaInscrito: false })
        }
        return filas
    })

    const conteos = await conteosPorPonencia({ ids })
    return {
        asistente: aAsistente(asistente, true),
        // `null`: acceso libre, sin inscripción al congreso con la que validar
        modoAsistencia: acceso.libre ? null : acceso.modo,
        inscripciones: resultado.map((fila) => {
            const ponencia = ponencias.find((p) => p.id === fila.ponenciaId) as PonenciaEspecializada
            return { id: fila.id, yaInscrito: fila.yaInscrito, ponencia: aPonenciaPublica(ponencia, conteos.get(ponencia.id)?.presenciales ?? 0) }
        }),
    }
}

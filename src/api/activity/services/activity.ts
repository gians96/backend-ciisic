import { Prisma } from '@prisma/client'
import type { Actividad } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound } from '../../../core/http-error'
import { aColumnaFecha, fechaLima, fechaSoloDia, horaLima, instanteLima } from '../../../core/fechas'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { ActualizarActividadInput, CrearActividadInput, RegistrarAsistenciaInput } from '../validation'

export function aActividad(actividad: Actividad, totalAsistencias?: number) {
    return {
        id: actividad.id,
        eventoId: actividad.eventoId,
        nombre: actividad.nombre,
        fecha: fechaSoloDia(actividad.fecha),
        horaInicio: horaLima(actividad.horaInicio),
        horaFin: horaLima(actividad.horaFin),
        ...(totalAsistencias !== undefined ? { totalAsistencias } : {}),
    }
}

async function obtenerActividad(id: number) {
    const actividad = await prisma.actividad.findUnique({ where: { id } })
    if (!actividad) throw notFound('ACTIVITY_NOT_FOUND', 'La actividad no existe.')
    return actividad
}

export async function listarActividades(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const actividades = await prisma.actividad.findMany({
        where: { eventoId },
        include: { _count: { select: { asistencias: true } } },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    })
    return actividades.map((actividad) => aActividad(actividad, actividad._count.asistencias))
}

export async function crearActividad(eventoId: number, input: CrearActividadInput) {
    await obtenerEventoPorId(eventoId)
    const actividad = await prisma.actividad.create({
        data: {
            eventoId,
            nombre: input.nombre,
            fecha: aColumnaFecha(input.fecha),
            horaInicio: instanteLima(input.fecha, input.horaInicio),
            horaFin: instanteLima(input.fecha, input.horaFin),
        },
    })
    return aActividad(actividad, 0)
}

export async function actualizarActividad(id: number, input: ActualizarActividadInput) {
    const actual = await obtenerActividad(id)
    const fecha = input.fecha ?? fechaSoloDia(actual.fecha) ?? fechaLima()
    const horaInicio = input.horaInicio ?? horaLima(actual.horaInicio)
    const horaFin = input.horaFin ?? horaLima(actual.horaFin)
    if (horaFin <= horaInicio) throw conflict('INVALID_HOURS', 'La hora de fin debe ser posterior a la de inicio.')
    const actividad = await prisma.actividad.update({
        where: { id },
        data: {
            ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
            fecha: aColumnaFecha(fecha),
            horaInicio: instanteLima(fecha, horaInicio),
            horaFin: instanteLima(fecha, horaFin),
        },
    })
    return aActividad(actividad)
}

export async function eliminarActividad(id: number) {
    await obtenerActividad(id)
    const asistencias = await prisma.asistencia.count({ where: { actividadId: id } })
    if (asistencias) throw conflict('ACTIVITY_HAS_ATTENDANCE', 'La actividad tiene asistencias registradas.')
    await prisma.actividad.delete({ where: { id } })
}

// ─── Asistencia ─────────────────────────────────────────────────────────────

export async function listarAsistencias(actividadId: number) {
    await obtenerActividad(actividadId)
    const asistencias = await prisma.asistencia.findMany({
        where: { actividadId },
        include: { participante: true },
        orderBy: { registradoEn: 'desc' },
    })
    return asistencias.map((asistencia) => ({
        id: asistencia.id,
        registradoEn: asistencia.registradoEn,
        participante: {
            id: asistencia.participante.id,
            tipoDocumento: asistencia.participante.tipoDocumentoId,
            numeroDocumento: asistencia.participante.numeroDocumento,
            nombres: asistencia.participante.nombres,
            apellidos: asistencia.participante.apellidos,
        },
    }))
}

/**
 * Registra asistencia: la persona debe tener inscripción APROBADO en el evento de la
 * actividad y, salvo `fueraDeHorario`, estar dentro de la fecha y horario (hora de Lima).
 */
export async function registrarAsistencia(actividadId: number, input: RegistrarAsistenciaInput, ahora = new Date()) {
    const actividad = await obtenerActividad(actividadId)
    const participante = input.participanteId
        ? await prisma.participante.findUnique({ where: { id: input.participanteId } })
        : await prisma.participante.findFirst({ where: { numeroDocumento: input.numeroDocumento } })
    if (!participante) throw notFound('PARTICIPANT_NOT_FOUND', 'No se encontró al participante.')

    const aprobada = await prisma.inscripcion.findFirst({
        where: { eventoId: actividad.eventoId, participanteId: participante.id, estado: { codigo: 'APROBADO' } },
    })
    if (!aprobada) throw new HttpError(403, 'NOT_APPROVED', 'El participante no tiene una inscripción aprobada en este evento.')

    if (!input.fueraDeHorario) {
        const dia = fechaSoloDia(actividad.fecha)
        if (dia !== fechaLima(ahora)) throw conflict('OUTSIDE_WINDOW', `La asistencia se registra el día de la actividad (${dia}).`)
        if (ahora < actividad.horaInicio || ahora > actividad.horaFin) throw conflict('OUTSIDE_WINDOW', 'La asistencia está fuera del horario de la actividad.')
    }

    try {
        const asistencia = await prisma.asistencia.create({ data: { actividadId, participanteId: participante.id } })
        return {
            id: asistencia.id,
            registradoEn: asistencia.registradoEn,
            participante: { id: participante.id, nombres: participante.nombres, apellidos: participante.apellidos, numeroDocumento: participante.numeroDocumento },
        }
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw conflict('ATTENDANCE_ALREADY_REGISTERED', 'La asistencia ya fue registrada para esta actividad.')
        }
        throw error
    }
}

export async function eliminarAsistencia(id: number) {
    const asistencia = await prisma.asistencia.findUnique({ where: { id } })
    if (!asistencia) throw notFound('ATTENDANCE_NOT_FOUND', 'La asistencia no existe.')
    await prisma.asistencia.delete({ where: { id } })
}

export async function obtenerAsistencia(id: number) {
    const asistencia = await prisma.asistencia.findUnique({ where: { id } })
    if (!asistencia) throw notFound('ATTENDANCE_NOT_FOUND', 'Asistencia no encontrada')
    return asistencia
}

/** Matriz participantes aprobados × actividades (1/0). */
export async function matrizAsistencia(eventoId: number, actividadIds?: number[]) {
    const actividades = await prisma.actividad.findMany({
        where: { eventoId, ...(actividadIds ? { id: { in: actividadIds } } : {}) },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    })
    const participantes = await prisma.participante.findMany({
        where: { inscripciones: { some: { eventoId, estado: { codigo: 'APROBADO' } } } },
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    })
    const asistencias = await prisma.asistencia.findMany({
        where: { actividadId: { in: actividades.map((a) => a.id) }, participanteId: { in: participantes.map((p) => p.id) } },
        select: { participanteId: true, actividadId: true },
    })
    const marcadas = new Set(asistencias.map((a) => `${a.participanteId}-${a.actividadId}`))
    return {
        actividades: actividades.map((actividad) => aActividad(actividad)),
        participantes: participantes.map((participante) => {
            const marcas = Object.fromEntries(actividades.map((a) => [a.id, marcadas.has(`${participante.id}-${a.id}`) ? 1 : 0]))
            return {
                id: participante.id,
                tipoDocumento: participante.tipoDocumentoId,
                numeroDocumento: participante.numeroDocumento,
                nombres: participante.nombres,
                apellidos: participante.apellidos,
                asistencias: marcas,
                total: Object.values(marcas).reduce((suma, valor) => suma + valor, 0),
            }
        }),
    }
}

/** Legacy: exportación por ids de actividad (sin evento explícito). */
export async function matrizLegacy(actividadIds: number[]) {
    const actividades = await prisma.actividad.findMany({ where: { id: { in: actividadIds } }, select: { eventoId: true } })
    if (!actividades.length) throw notFound('ACTIVITY_NOT_FOUND', 'No se encontraron las actividades especificadas')
    return matrizAsistencia(actividades[0].eventoId, actividadIds)
}

import { Prisma } from '@prisma/client'
import type { Actividad } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound } from '../../../core/http-error'
import { aColumnaFecha, fechaLima, fechaSoloDia, horaLima, instanteLima } from '../../../core/fechas'
import type { MetodoAsistencia } from '../../../core/catalogos'
import { tienePermiso, type Actor } from '../../../core/actor'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { ActualizarActividadInput, CrearActividadInput, RegistrarAsistenciaInput } from '../validation'

/** Las marcas anuladas (spec 013) no cuentan en ninguna lectura: listado, conteos ni matriz. */
const VIGENTE = { anuladoEn: null }

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
        include: { _count: { select: { asistencias: { where: VIGENTE } } } },
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

const actividadConAsistencia = () => conflict('ACTIVITY_HAS_ATTENDANCE', 'La actividad tiene asistencias registradas.')

/**
 * Solo se borra una actividad sin asistencias vigentes. Las anuladas se borran con ella; si entre
 * tanto alguien marca, la FK impide el borrado y responde el mismo 409.
 */
export async function eliminarActividad(id: number) {
    await obtenerActividad(id)
    const asistencias = await prisma.asistencia.count({ where: { actividadId: id, ...VIGENTE } })
    if (asistencias) throw actividadConAsistencia()
    try {
        await prisma.$transaction([
            prisma.asistencia.deleteMany({ where: { actividadId: id, anuladoEn: { not: null } } }),
            prisma.actividad.delete({ where: { id } }),
        ])
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw actividadConAsistencia()
        throw error
    }
}

// ─── Asistencia ─────────────────────────────────────────────────────────────

/** Quién marca y cómo (spec 013). */
export interface ContextoAsistencia {
    actor: Actor
    metodo: MetodoAsistencia
}

/** Sin `inscripciones.ver` el documento se muestra como `****5678`. */
export function enmascararDocumento(numero: string): string {
    return `****${numero.slice(-4)}`
}

const DATOS_PERSONA = { id: true, nombres: true, apellidos: true, tipoDocumentoId: true, numeroDocumento: true } as const

type Persona = Prisma.ParticipanteGetPayload<{ select: typeof DATOS_PERSONA }>

/** Documento tal cual solo con `inscripciones.ver`; si no, enmascarado (listado, marca y exportación). */
function documentoPara(actor: Actor, numero: string): string {
    return tienePermiso(actor, 'inscripciones.ver') ? numero : enmascararDocumento(numero)
}

function aPersona(persona: Persona, actor: Actor) {
    return {
        id: persona.id,
        nombres: persona.nombres,
        apellidos: persona.apellidos,
        tipoDocumento: persona.tipoDocumentoId,
        numeroDocumento: documentoPara(actor, persona.numeroDocumento),
    }
}

export async function listarAsistencias(actividadId: number, actor: Actor) {
    await obtenerActividad(actividadId)
    const asistencias = await prisma.asistencia.findMany({
        where: { actividadId, ...VIGENTE },
        include: {
            participante: { select: DATOS_PERSONA },
            registradoPor: { select: { id: true, nombres: true, apellidos: true } },
        },
        orderBy: { registradoEn: 'desc' },
    })
    return asistencias.map((asistencia) => ({
        id: asistencia.id,
        registradoEn: asistencia.registradoEn,
        metodo: asistencia.metodo,
        esFueraDeHorario: asistencia.esFueraDeHorario,
        registradoPor: asistencia.registradoPor,
        participante: aPersona(asistencia.participante, actor),
    }))
}

const yaRegistrada = (registradoEn?: Date | null) => conflict(
    'ATTENDANCE_ALREADY_REGISTERED',
    registradoEn
        ? `La asistencia ya fue registrada para esta actividad a las ${horaLima(registradoEn)}.`
        : 'La asistencia ya fue registrada para esta actividad.',
)

/**
 * Persona inscrita en el evento de la actividad (spec 013): la búsqueda nunca sale de las
 * inscripciones del evento, así que el id o el documento de alguien no inscrito responde 404.
 */
async function buscarInscrito(eventoId: number, input: RegistrarAsistenciaInput) {
    const persona: Prisma.ParticipanteWhereInput = input.participanteId
        ? { id: input.participanteId }
        : { numeroDocumento: input.numeroDocumento, ...(input.tipoDocumento ? { tipoDocumentoId: input.tipoDocumento } : {}) }
    const inscripciones = await prisma.inscripcion.findMany({
        where: { eventoId, participante: persona },
        select: { estado: { select: { codigo: true } }, participante: { select: DATOS_PERSONA } },
        take: 2,
    })
    if (!inscripciones.length) throw notFound('PARTICIPANT_NOT_FOUND', 'La persona no está inscrita en este evento.')
    if (inscripciones.length > 1) {
        throw conflict('AMBIGUOUS_DOCUMENT', 'Hay más de una persona inscrita con ese número de documento. Indique el tipo de documento.')
    }
    return inscripciones[0]
}

/**
 * Registra asistencia: la persona debe tener inscripción APROBADO en el evento de la
 * actividad y, salvo `fueraDeHorario` (permiso `asistencia.fuera_horario`), estar dentro de la
 * fecha y horario (hora de Lima). `esFueraDeHorario` sale de la hora real, no de lo que envía el
 * cliente. Una marca anulada se reactiva con los datos de quien marca.
 */
export async function registrarAsistencia(actividadId: number, input: RegistrarAsistenciaInput, { actor, metodo }: ContextoAsistencia, ahora = new Date()) {
    if (input.fueraDeHorario && !tienePermiso(actor, 'asistencia.fuera_horario')) {
        throw new HttpError(403, 'OUT_OF_HOURS_NOT_ALLOWED', 'No tiene permiso para marcar asistencia fuera del horario de la actividad.')
    }
    const actividad = await obtenerActividad(actividadId)
    const { estado, participante } = await buscarInscrito(actividad.eventoId, input)
    if (estado.codigo !== 'APROBADO') throw new HttpError(403, 'NOT_APPROVED', 'El participante no tiene una inscripción aprobada en este evento.')

    // Queda como fuera de horario solo si de verdad lo estaba (el panel puede dejar marcada la casilla)
    const dia = fechaSoloDia(actividad.fecha)
    const enOtroDia = dia !== fechaLima(ahora)
    const fueraDeHorario = enOtroDia || ahora < actividad.horaInicio || ahora > actividad.horaFin
    if (fueraDeHorario && !input.fueraDeHorario) {
        throw conflict('OUTSIDE_WINDOW', enOtroDia ? `La asistencia se registra el día de la actividad (${dia}).` : 'La asistencia está fuera del horario de la actividad.')
    }

    const clave = { participanteId_actividadId: { participanteId: participante.id, actividadId } }
    const horaPrevia = async () => (await prisma.asistencia.findUnique({ where: clave, select: { registradoEn: true } }))?.registradoEn
    const marca = { registradoEn: ahora, registradoPorId: actor.id, metodo, esFueraDeHorario: fueraDeHorario }
    const previa = await prisma.asistencia.findUnique({ where: clave, select: { id: true, registradoEn: true, anuladoEn: true } })
    if (previa && !previa.anuladoEn) throw yaRegistrada(previa.registradoEn)

    let id: number
    if (previa) {
        // Reactivación: solo si sigue anulada (otra cuenta pudo reactivarla entre tanto)
        const { count } = await prisma.asistencia.updateMany({
            where: { id: previa.id, anuladoEn: { not: null } },
            data: { ...marca, anuladoEn: null, anuladoPorId: null },
        })
        if (!count) throw yaRegistrada(await horaPrevia())
        id = previa.id
    } else {
        try {
            id = (await prisma.asistencia.create({ data: { actividadId, participanteId: participante.id, ...marca }, select: { id: true } })).id
        } catch (error) {
            // Dos marcas simultáneas de la misma persona: la segunda choca con el índice único
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw yaRegistrada(await horaPrevia())
            throw error
        }
    }
    return { id, registradoEn: marca.registradoEn, metodo, esFueraDeHorario: marca.esFueraDeHorario, participante: aPersona(participante, actor) }
}

/** Anulación lógica (spec 013): la fila queda con quién y cuándo la anuló. */
export async function eliminarAsistencia(id: number, anuladoPorId: number, ahora = new Date()) {
    const { count } = await prisma.asistencia.updateMany({ where: { id, ...VIGENTE }, data: { anuladoEn: ahora, anuladoPorId } })
    if (!count) throw notFound('ATTENDANCE_NOT_FOUND', 'La asistencia no existe.')
}

/** Legacy: mismos campos que antes de la spec 013. */
export async function obtenerAsistencia(id: number) {
    const asistencia = await prisma.asistencia.findFirst({
        where: { id, ...VIGENTE },
        select: { id: true, registradoEn: true, participanteId: true, actividadId: true },
    })
    if (!asistencia) throw notFound('ATTENDANCE_NOT_FOUND', 'Asistencia no encontrada')
    return asistencia
}

/** Matriz participantes aprobados × actividades (1/0). Sin `inscripciones.ver` el documento va enmascarado. */
export async function matrizAsistencia(eventoId: number, actor: Actor, actividadIds?: number[]) {
    const actividades = await prisma.actividad.findMany({
        where: { eventoId, ...(actividadIds ? { id: { in: actividadIds } } : {}) },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    })
    const participantes = await prisma.participante.findMany({
        where: { inscripciones: { some: { eventoId, estado: { codigo: 'APROBADO' } } } },
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    })
    const asistencias = await prisma.asistencia.findMany({
        where: { actividadId: { in: actividades.map((a) => a.id) }, participanteId: { in: participantes.map((p) => p.id) }, ...VIGENTE },
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
                numeroDocumento: documentoPara(actor, participante.numeroDocumento),
                nombres: participante.nombres,
                apellidos: participante.apellidos,
                asistencias: marcas,
                total: Object.values(marcas).reduce((suma, valor) => suma + valor, 0),
            }
        }),
    }
}

/** Legacy: exportación por ids de actividad (sin evento explícito). */
export async function matrizLegacy(actividadIds: number[], actor: Actor) {
    const actividades = await prisma.actividad.findMany({ where: { id: { in: actividadIds } }, select: { eventoId: true } })
    if (!actividades.length) throw notFound('ACTIVITY_NOT_FOUND', 'No se encontraron las actividades especificadas')
    return matrizAsistencia(actividades[0].eventoId, actor, actividadIds)
}

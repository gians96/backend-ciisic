import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { horaLima } from '../../../core/fechas'
import { esFueraDeHorario } from '../../../core/ponencias-especializadas'
import { TOLERANCIA_ANTES_MINUTOS } from '../../activity/services/activity'
import { aAsistente, obtenerOCrearAsistente } from './asistentes'
import { bloquearPonencias, exigirCupo } from './registrations'
import { conteosPorPonencia, obtenerPonencia } from './talks'
import type { AsistenteInput } from '../validation'

const yaMarcada = (asistioEn: Date) =>
    conflict('ATTENDANCE_ALREADY_REGISTERED', `La asistencia ya fue registrada para esta ponencia a las ${horaLima(asistioEn)}.`)

/**
 * Asistencia en puerta con el documento. Hace en un solo paso lo que el operador necesita:
 * - la persona no existe → se busca el DNI en la consulta oficial y se registra;
 * - no está inscrita en esta ponencia (o su inscripción estaba cancelada) → se inscribe en el acto
 *   (origen `PUERTA`) si queda cupo (`409 TALK_FULL`);
 * - se marca la asistencia. Fuera de horario se registra igual, con la marca `esFueraDeHorario`.
 *
 * Una persona no puede estar en dos ponencias a la vez: al marcar, sus otras inscripciones vigentes
 * **sin asistencia** en ponencias que se cruzan con esta se cancelan (`CAMBIO_EN_PUERTA`) para liberar
 * el cupo, y se devuelven en `liberadas` para que el operador lo sepa.
 */
export async function registrarAsistencia(ponenciaId: number, input: AsistenteInput, actor: Actor, ahora = new Date()) {
    await obtenerPonencia(ponenciaId)
    const { asistente } = await obtenerOCrearAsistente(input, 'PANEL')

    const { inscripcion, inscripcionNueva, liberadas, ponencia } = await prisma.$transaction(async (tx) => {
        const [bloqueada] = await bloquearPonencias(tx, [ponenciaId])
        if (!bloqueada) throw notFound('TALK_NOT_FOUND', 'La ponencia no existe.')
        const previa = await tx.inscripcionPonencia.findUnique({ where: { ponenciaId_asistenteId: { ponenciaId, asistenteId: asistente.id } } })
        if (previa?.estado === 'INSCRITO' && previa.asistioEn) throw yaMarcada(previa.asistioEn)

        const nueva = previa?.estado !== 'INSCRITO'
        if (nueva) await exigirCupo(tx, bloqueada)

        const marca = {
            estado: 'INSCRITO' as const,
            asistioEn: ahora,
            asistenciaPorId: actor.id,
            esFueraDeHorario: esFueraDeHorario(ahora, bloqueada, TOLERANCIA_ANTES_MINUTOS),
            ...(nueva ? { origen: 'PUERTA' as const, registradoPorId: actor.id, canceladoEn: null, motivoCancelacion: null } : {}),
        }
        const guardada = previa
            ? await tx.inscripcionPonencia.update({ where: { id: previa.id }, data: marca, select: { id: true, asistioEn: true, esFueraDeHorario: true } })
            : await tx.inscripcionPonencia.create({ data: { ponenciaId, asistenteId: asistente.id, origen: 'PUERTA', registradoPorId: actor.id, ...marca }, select: { id: true, asistioEn: true, esFueraDeHorario: true } })

        const cruzadas = await tx.inscripcionPonencia.findMany({
            where: {
                asistenteId: asistente.id,
                estado: 'INSCRITO',
                asistioEn: null,
                ponenciaId: { not: ponenciaId },
                ponencia: { eventoId: bloqueada.eventoId, horaInicio: { lt: bloqueada.horaFin }, horaFin: { gt: bloqueada.horaInicio } },
            },
            select: { id: true, ponencia: { select: { id: true, tema: true, ambiente: true } } },
        })
        if (cruzadas.length) {
            await tx.inscripcionPonencia.updateMany({
                where: { id: { in: cruzadas.map((fila) => fila.id) }, estado: 'INSCRITO', asistioEn: null },
                data: { estado: 'CANCELADO', canceladoEn: ahora, motivoCancelacion: 'CAMBIO_EN_PUERTA' },
            })
        }
        return {
            inscripcion: guardada,
            inscripcionNueva: nueva,
            ponencia: bloqueada,
            liberadas: cruzadas.map((fila) => ({ inscripcionId: fila.id, ponenciaId: fila.ponencia.id, tema: fila.ponencia.tema, ambiente: fila.ponencia.ambiente })),
        }
    })

    if (liberadas.length) {
        console.info(`[ponencias-especializadas] La cuenta ${actor.id} marcó al asistente ${asistente.id} en la ponencia ${ponenciaId} y liberó ${liberadas.length} cupo(s)`)
    }
    const conteo = (await conteosPorPonencia({ ids: [ponenciaId] })).get(ponenciaId) ?? { inscritos: 0, asistentes: 0 }
    return {
        id: inscripcion.id,
        inscripcionNueva,
        asistioEn: inscripcion.asistioEn,
        esFueraDeHorario: inscripcion.esFueraDeHorario,
        asistente: aAsistente(asistente),
        ponencia: { id: ponencia.id, tema: ponencia.tema, ambiente: ponencia.ambiente, cupo: ponencia.cupo, inscritos: conteo.inscritos, asistentes: conteo.asistentes },
        liberadas,
    }
}

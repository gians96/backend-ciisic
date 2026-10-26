import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import type { Actor } from '../../../core/actor'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { escapeHtml, primerNombre } from '../../../core/html'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { cargarPersonas, type PersonaResumen } from './resumen'

/**
 * Cancelar y avisar a quienes no pueden estar inscritos a las ponencias (spec 031). Solo alcanza a quien **hoy** no es
 * congresista con el pago aprobado (el servidor lo vuelve a comprobar: lo que mande el panel no decide): a quien sí
 * puede asistir no se le cancela ni se le avisa. Con el acceso libre encendido todos pueden, así que no hay a quién.
 */
export type MotivoOmitida = 'NO_ENCONTRADA' | 'PUEDE_ASISTIR' | 'YA_ASISTIO'

export interface ResultadoAvisos {
    enviados: number
    sinCorreo: number
    fallidos: number
    /** No hay una credencial de correo activa: no se envió nada. */
    sinCredencial: boolean
}

const SIN_AVISOS: ResultadoAvisos = { enviados: 0, sinCorreo: 0, fallidos: 0, sinCredencial: false }

const accesoLibreActivo = () =>
    conflict('FREE_ACCESS_ENABLED', 'Con el acceso libre encendido todas las personas pueden asistir. Apágalo en el Programa para cancelar o avisar a quienes no están inscritas al congreso.')

/**
 * HTML del comunicado. El texto es del staff pero se **escapa** (nada de HTML ajeno en un correo oficial); las líneas en
 * blanco separan párrafos y `{nombre}` se reemplaza por el primer nombre de cada persona.
 */
export function htmlComunicado(
    mensaje: string,
    nombres: string,
    evento: Pick<Evento, 'nombre' | 'correoContacto'>,
    remitenteCorreo: string,
    /** Botón al final del mensaje (spec 039): su texto y su URL se escapan. */
    accion?: { texto: string, url: string },
): string {
    const texto = mensaje.replace(/\{nombre\}/gi, () => primerNombre(nombres) || 'participante')
    const parrafos = texto.split(/\n{2,}/).map((bloque) => bloque.trim()).filter(Boolean)
        .map((bloque) => `<p style="margin: 0 0 14px 0; padding: 0">${escapeHtml(bloque).replace(/\n/g, '<br>')}</p>`)
        .join('')
    const boton = accion
        ? `<p style="margin: 24px 0 0 0; padding: 0"><a href="${escapeHtml(accion.url)}" style="display: inline-block; padding: 13px 28px; border-radius: 999px; background-color: #041d39; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none">${escapeHtml(accion.texto)}</a></p>
<p style="margin: 10px 0 0 0; padding: 0; color: #6b7280; font-size: 13px">Si el botón no abre, copia este enlace en tu navegador:<br><a href="${escapeHtml(accion.url)}" style="color: #0071bc; word-break: break-all">${escapeHtml(accion.url)}</a></p>
`
        : ''
    return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.55; font-size: 15px">
<h2 style="margin: 0 0 18px 0; color: #0b3a6f; font-size: 18px">${escapeHtml(evento.nombre)}</h2>
${parrafos}
${boton}<p style="margin: 22px 0 0 0; padding-top: 14px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px">Si tienes dudas, escríbenos a ${escapeHtml(evento.correoContacto ?? remitenteCorreo)}.</p>
</div>`
}

/** Envía el comunicado a cada persona (de una en una) y anota la fecha en sus inscripciones. Nunca lanza por un fallo de envío. */
async function enviarComunicados(evento: Evento, personas: readonly PersonaResumen[], asunto: string, mensaje: string, ahora: Date): Promise<ResultadoAvisos> {
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    const resultado: ResultadoAvisos = { ...SIN_AVISOS, sinCredencial: credencial === null }
    for (const persona of personas) {
        const { correo, nombres } = persona.asistente
        if (!correo) {
            resultado.sinCorreo += 1
            continue
        }
        if (!credencial) {
            resultado.fallidos += 1
            continue
        }
        let error: string | null
        try {
            error = await enviarConCredencial(credencial, {
                remitente: { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto },
                para: [{ email: correo }],
                asunto,
                html: htmlComunicado(mensaje, nombres, evento, credencial.remitenteCorreo),
            })
        } catch {
            error = 'no se pudo preparar el correo'
        }
        if (error !== null) {
            resultado.fallidos += 1
            continue
        }
        resultado.enviados += 1
        await prisma.inscripcionPonencia.updateMany({
            where: { asistenteId: persona.asistente.id, ponencia: { eventoId: evento.id } },
            data: { avisoEnviadoEn: ahora },
        })
    }
    return resultado
}

/** Las personas pedidas entre las inscritas del evento, separadas en las que se pueden tratar y las omitidas con su motivo. */
async function seleccionar(eventoId: number, asistenteIds: readonly number[]) {
    const { personas, accesoLibre } = await cargarPersonas(eventoId)
    if (accesoLibre) throw accesoLibreActivo()
    const porId = new Map(personas.map((p) => [p.asistente.id, p]))
    const aTratar: PersonaResumen[] = []
    const omitidas: Array<{ asistenteId: number, motivo: MotivoOmitida }> = []
    for (const id of new Set(asistenteIds)) {
        const persona = porId.get(id)
        if (!persona) omitidas.push({ asistenteId: id, motivo: 'NO_ENCONTRADA' })
        else if (persona.puede) omitidas.push({ asistenteId: id, motivo: 'PUEDE_ASISTIR' })
        else aTratar.push(persona)
    }
    return { aTratar, omitidas }
}

export interface CancelarInput {
    asistenteIds: number[]
    notificar: boolean
    asunto?: string
    mensaje?: string
}

/**
 * Cancela todas las inscripciones vigentes de cada persona que no puede estar inscrita (motivo `SIN_CONGRESO`), salvo las
 * ya marcadas con asistencia («primero se anula la asistencia»), y si se pide les envía el comunicado. La cancelación se
 * guarda primero: un correo que falla no la revierte (se informa en `avisos`).
 */
export async function cancelarSinCongreso(eventoId: number, input: CancelarInput, actor: Actor, ahora = new Date()) {
    const evento = await obtenerEventoPorId(eventoId)
    if (input.notificar && (!input.asunto || !input.mensaje)) {
        throw unprocessable('VALIDATION_ERROR', 'Escribe el asunto y el mensaje del comunicado.', { mensaje: 'Escribe el asunto y el mensaje del comunicado' })
    }
    const { aTratar, omitidas } = await seleccionar(eventoId, input.asistenteIds)

    const canceladas: PersonaResumen[] = []
    let inscripcionesCanceladas = 0
    for (const persona of aTratar) {
        const { count } = await prisma.inscripcionPonencia.updateMany({
            where: { asistenteId: persona.asistente.id, estado: 'INSCRITO', asistioEn: null, ponencia: { eventoId } },
            data: { estado: 'CANCELADO', canceladoEn: ahora, motivoCancelacion: 'SIN_CONGRESO' },
        })
        if (count === 0) omitidas.push({ asistenteId: persona.asistente.id, motivo: 'YA_ASISTIO' })
        else {
            canceladas.push(persona)
            inscripcionesCanceladas += count
        }
    }
    console.info(`[ponencias-especializadas] La cuenta ${actor.id} canceló ${inscripcionesCanceladas} inscripción(es) de ${canceladas.length} persona(s) sin inscripción aprobada al congreso en el evento ${eventoId}`)

    const avisos = input.notificar && canceladas.length
        ? await enviarComunicados(evento, canceladas, input.asunto as string, input.mensaje as string, ahora)
        : null
    return { personas: canceladas.length, inscripciones: inscripcionesCanceladas, omitidas, avisos }
}

export interface AvisarInput {
    asistenteIds: number[]
    asunto: string
    mensaje: string
}

/** Solo avisa (sin cancelar), p. ej. para pedir que se inscriban al congreso antes de cancelar. */
export async function avisarSinCongreso(eventoId: number, input: AvisarInput, actor: Actor, ahora = new Date()) {
    const evento = await obtenerEventoPorId(eventoId)
    const { aTratar, omitidas } = await seleccionar(eventoId, input.asistenteIds)
    if (!aTratar.length) throw notFound('ATTENDEES_NOT_FOUND', 'Ninguna de las personas elegidas necesita el aviso (ya pueden asistir o no están inscritas).')
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) throw conflict('EMAIL_CREDENTIAL_UNAVAILABLE', 'No hay una credencial de correo activa. Configúrala en Correo para poder enviar avisos.')
    const avisos = await enviarComunicados(evento, aTratar, input.asunto, input.mensaje, ahora)
    console.info(`[ponencias-especializadas] La cuenta ${actor.id} avisó a ${avisos.enviados} de ${aTratar.length} persona(s) en el evento ${eventoId}`)
    return { personas: aTratar.length, omitidas, avisos }
}

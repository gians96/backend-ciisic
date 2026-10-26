import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import type { Actor } from '../../../core/actor'
import { asegurarCodigoCredencial } from '../../../core/codigos'
import { obtenerConfiguracion } from '../../../core/configuracion-sistema'
import { origenLanding, urlCredencial, urlInscripcionPonencias } from '../../../core/enlaces-landing'
import { conflict, HttpError } from '../../../core/http-error'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { detalleInclude } from '../../inscription/services/mappers'
import { enviarCorreoEnlaceCredencial } from '../../inscription/utils/sendEmail'
import { htmlComunicado } from '../../specialized-talk/services/avisos'
import { aprobadasPresenciales, type Canal } from './destinatarios'
import type { EnviarEnlacesCredencialInput, EnviarInvitacionPonenciasInput, ProbarInvitacionPonenciasInput } from '../validation'

/**
 * Envíos masivos a los inscritos presenciales (spec 039). Un correo por persona (nadie ve las direcciones
 * de otras) y una marca por persona y canal para saber a quién ya se le envió. Antes de enviar se **reserva**
 * la marca con un `UPDATE` condicionado a lo que se leyó: si dos cuentas envían a la vez, solo una gana y
 * nadie recibe el correo dos veces; si el envío falla, la marca vuelve a como estaba. El servidor vuelve a
 * comprobar a cada persona (aprobada y presencial): lo que mande el panel no decide.
 */
export interface ResultadoEnvio {
    enviados: number
    /** Ya lo habían recibido (y no se pidió reenviar), o lo tomó otra petición al mismo tiempo. */
    yaEnviados: number
    /** No existen, no son del evento, no están aprobadas o no son presenciales. */
    noElegibles: number
    fallidos: number
}

const sinResultado = (): ResultadoEnvio => ({ enviados: 0, yaEnviados: 0, noElegibles: 0, fallidos: 0 })

const sinLanding = () => conflict('LANDING_URL_MISSING', 'Falta la URL de la landing. Configúrala en Sistema para poder armar los enlaces.')
const sinCredencialDeCorreo = () => conflict('EMAIL_CREDENTIAL_UNAVAILABLE', 'No hay una credencial de correo activa. Configúrala en Correo para poder enviar.')

/** Marca de un canal en la inscripción, leída y escrita siempre por su nombre de campo (sin claves dinámicas). */
function marcaDe(fila: { enlaceCredencialEnviadoEn: Date | null, enlacePonenciasEnviadoEn: Date | null }, canal: Canal): Date | null {
    return canal === 'credencial' ? fila.enlaceCredencialEnviadoEn : fila.enlacePonenciasEnviadoEn
}

/** Pasa la marca de `esperada` a `nueva` solo si sigue valiendo `esperada`. `true` si este envío la ganó. */
async function cambiarMarca(id: number, canal: Canal, esperada: Date | null, nueva: Date | null): Promise<boolean> {
    const { count } = canal === 'credencial'
        ? await prisma.inscripcion.updateMany({ where: { id, enlaceCredencialEnviadoEn: esperada }, data: { enlaceCredencialEnviadoEn: nueva } })
        : await prisma.inscripcion.updateMany({ where: { id, enlacePonenciasEnviadoEn: esperada }, data: { enlacePonenciasEnviadoEn: nueva } })
    return count === 1
}

async function cargarFilas(eventoId: number, ids: readonly number[]) {
    const filas = await prisma.inscripcion.findMany({
        where: { AND: [aprobadasPresenciales(eventoId), { id: { in: [...ids] } }] },
        include: detalleInclude,
    })
    return new Map(filas.map((fila) => [fila.id, fila]))
}

type FilaCargada = Awaited<ReturnType<typeof cargarFilas>> extends Map<number, infer F> ? F : never

/**
 * Recorre las inscripciones pedidas de una en una: reserva la marca, envía y, si falla, la devuelve.
 * `enviar` devuelve `true` si el correo salió.
 */
async function recorrer(
    eventoId: number,
    ids: readonly number[],
    canal: Canal,
    reenviar: boolean,
    ahora: Date,
    enviar: (fila: FilaCargada) => Promise<boolean>,
): Promise<ResultadoEnvio> {
    const filas = await cargarFilas(eventoId, ids)
    const resultado = sinResultado()
    for (const id of ids) {
        const fila = filas.get(id)
        if (!fila) {
            resultado.noElegibles += 1
            continue
        }
        const previa = marcaDe(fila, canal)
        if (previa !== null && !reenviar) {
            resultado.yaEnviados += 1
            continue
        }
        if (!(await cambiarMarca(id, canal, previa, ahora))) {
            resultado.yaEnviados += 1
            continue
        }
        let enviado = false
        try {
            enviado = await enviar(fila)
        } catch {
            enviado = false
        }
        if (enviado) {
            resultado.enviados += 1
        } else {
            resultado.fallidos += 1
            await cambiarMarca(id, canal, ahora, previa).catch(() => undefined)
        }
    }
    return resultado
}

function remitenteDe(evento: Evento, credencial: { remitenteCorreo: string, remitenteNombre: string | null }) {
    return { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto }
}

// ─── Enlace de la credencial 3D ─────────────────────────────────────────────

/** Envía a cada persona elegida su propio enlace `<landing>/credencial/<codigo>` y la marca como enviada. */
export async function enviarEnlacesCredencial(eventoId: number, input: EnviarEnlacesCredencialInput, actor: Actor, ahora = new Date()): Promise<ResultadoEnvio> {
    const evento = await obtenerEventoPorId(eventoId)
    const { urlLanding } = await obtenerConfiguracion()
    if (!origenLanding(urlLanding)) throw sinLanding()
    if (!(await credencialParaEvento(evento.credencialCorreoId))) throw sinCredencialDeCorreo()

    const resultado = await recorrer(eventoId, input.ids, 'credencial', input.reenviar, ahora, async (fila) => {
        // Las inscripciones de la imagen anterior pueden no tener código: se les asigna uno
        const codigo = fila.codigoCredencial ?? await asegurarCodigoCredencial(fila.id)
        const enlace = urlCredencial(urlLanding, codigo)
        if (!enlace) return false
        return enviarCorreoEnlaceCredencial({ ...fila, codigoCredencial: codigo }, enlace)
    })
    console.info(`[envios-masivos] La cuenta ${actor.id} envió el enlace de la credencial a ${resultado.enviados} de ${input.ids.length} inscripción(es) del evento ${eventoId}`)
    return resultado
}

// ─── Enlace de inscripción a las ponencias especializadas ───────────────────

export const ACCION_PONENCIAS = 'Inscribirme a las ponencias'

/** HTML del mensaje del staff con el botón a la inscripción de ponencias (el mismo para todas las personas). */
export function htmlInvitacionPonencias(mensaje: string, evento: Pick<Evento, 'nombre' | 'correoContacto'>, remitenteCorreo: string, enlace: string): string {
    return htmlComunicado(mensaje, '', evento, remitenteCorreo, { texto: ACCION_PONENCIAS, url: enlace })
}

/** Envía el mismo mensaje a las personas elegidas (cada una por separado) con el botón a `…/inscripcion-ponencias`. */
export async function enviarInvitacionPonencias(eventoId: number, input: EnviarInvitacionPonenciasInput, actor: Actor, ahora = new Date()): Promise<ResultadoEnvio> {
    const evento = await obtenerEventoPorId(eventoId)
    const { urlLanding } = await obtenerConfiguracion()
    const enlace = urlInscripcionPonencias(urlLanding)
    if (!enlace) throw sinLanding()
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) throw sinCredencialDeCorreo()

    const html = htmlInvitacionPonencias(input.mensaje, evento, credencial.remitenteCorreo, enlace)
    const resultado = await recorrer(eventoId, input.ids, 'ponencias', input.reenviar, ahora, async (fila) => {
        const error = await enviarConCredencial(credencial, {
            remitente: remitenteDe(evento, credencial),
            para: [{ email: fila.participante.correo }],
            asunto: input.asunto,
            html,
        })
        return error === null
    })
    console.info(`[envios-masivos] La cuenta ${actor.id} envió el enlace de ponencias a ${resultado.enviados} de ${input.ids.length} inscripción(es) del evento ${eventoId}`)
    return resultado
}

/** Manda el mensaje a una dirección para ver cómo queda; no marca a nadie. */
export async function probarInvitacionPonencias(eventoId: number, input: ProbarInvitacionPonenciasInput, actor: Actor): Promise<{ enviado: true }> {
    const evento = await obtenerEventoPorId(eventoId)
    const { urlLanding } = await obtenerConfiguracion()
    const enlace = urlInscripcionPonencias(urlLanding)
    if (!enlace) throw sinLanding()
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) throw sinCredencialDeCorreo()

    const error = await enviarConCredencial(credencial, {
        remitente: remitenteDe(evento, credencial),
        para: [{ email: input.correo }],
        asunto: `[Prueba] ${input.asunto}`,
        html: htmlInvitacionPonencias(input.mensaje, evento, credencial.remitenteCorreo, enlace),
    })
    if (error !== null) throw new HttpError(502, 'EMAIL_SEND_FAILED', 'No se pudo enviar el correo de prueba. Revisa la credencial de correo.')
    console.info(`[envios-masivos] La cuenta ${actor.id} envió un correo de prueba del enlace de ponencias en el evento ${eventoId}`)
    return { enviado: true }
}

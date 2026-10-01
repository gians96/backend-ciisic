import fs from 'fs'
import path from 'path'
import { Prisma, type Evento } from '@prisma/client'
import { renderTemplate } from '../../../core/html'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import type { InscripcionDetalle } from '../services/mappers'

const ASUNTO_POR_DEFECTO = 'Tu inscripción ha sido aprobada'
/** Remitente y organizador de los avisos que no pertenecen a un evento. */
const ORGANIZADOR_POR_DEFECTO = 'CIISIC'

function plantilla(nombre: string): string {
    return fs.readFileSync(path.join(__dirname, 'templates', nombre), 'utf8')
}

/**
 * Envía el correo de aprobación con la credencial adjunta usando la credencial de correo del
 * evento (o la predeterminada, spec 006). Devuelve `false` (sin lanzar) si no hay credencial
 * activa o el envío falla, para no revertir la aprobación.
 *
 * El PDF se lee antes de la primera espera: quien llama lo pasa en cuanto se generó, y así otra
 * petición (una foto nueva borra los PDF guardados) no puede borrarlo antes de adjuntarlo.
 */
export async function enviarCorreoAprobacion(inscripcion: InscripcionDetalle, pdfPath: string): Promise<boolean> {
    let adjunto: string
    try {
        adjunto = fs.readFileSync(pdfPath).toString('base64')
    } catch {
        console.error(`No se pudo leer la credencial PDF de la inscripción ${inscripcion.id}; no se envió el correo de aprobación`)
        return false
    }
    const evento = inscripcion.evento
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) {
        console.warn('No hay una credencial de correo activa; no se envió el correo de aprobación')
        return false
    }
    let error: string | null
    try {
        const html = renderTemplate(plantilla('approval.html'), {
            NOMBRE: inscripcion.participante.nombres,
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            EVENTO_CORREO: evento.correoContacto ?? credencial.remitenteCorreo,
            ANIO: evento.fechaInicio.getUTCFullYear(),
        })
        error = await enviarConCredencial(credencial, {
            remitente: { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto },
            para: [{ email: inscripcion.participante.correo }],
            asunto: evento.asuntoAprobacion || ASUNTO_POR_DEFECTO,
            html,
            adjuntos: [{ nombre: `credencial-${evento.codigo}-${inscripcion.id}.pdf`, contenidoBase64: adjunto }],
        })
    } catch {
        error = 'no se pudo preparar el correo (plantilla)'
    }
    if (error) console.error(`No se pudo enviar el correo de aprobación: ${error}`)
    return error === null
}

// ─── Avisos de seguridad sobre el correo (spec 014) ─────────────────────────

/** Causa de un fallo sin datos personales: el tipo de error y, si es de Prisma, su código (nunca el mensaje). */
function causaDe(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `${error.name} ${error.code}`
    return error instanceof Error ? error.name : 'error desconocido'
}

/**
 * Ejecuta un envío después de responder. Un fallo (BD, plantilla, Brevo, o una excepción síncrona
 * de la tarea) solo se registra con su causa: nunca rechaza una promesa sin manejar ni retrasa la
 * respuesta. `descripcion` lleva los ids necesarios para rastrearlo (nunca correos ni nombres).
 */
export function enDiferido(descripcion: string, tarea: () => Promise<unknown>): void {
    setImmediate(() => {
        Promise.resolve().then(tarea).catch((error: unknown) => console.error(`No se pudo enviar ${descripcion}: ${causaDe(error)}`))
    })
}

type EventoDelAviso = Pick<Evento, 'nombre' | 'nombreCorto' | 'correoContacto' | 'remitenteNombre' | 'credencialCorreoId' | 'fechaInicio'>

interface Aviso {
    /** Evento cuya credencial de correo y contacto se usan; `null` usa la credencial predeterminada. */
    evento: EventoDelAviso | null
    para: string
    asunto: string
    /** Arma el HTML con el correo de contacto (el del evento o el del remitente). */
    html: (contacto: string) => string
    descripcion: string
}

/** Envía un aviso sin adjuntos. Devuelve `false` (sin lanzar) si no hay credencial activa o el envío falla. */
async function enviarAviso(aviso: Aviso): Promise<boolean> {
    const { evento } = aviso
    const credencial = await credencialParaEvento(evento?.credencialCorreoId ?? null)
    if (!credencial) {
        console.warn(`No hay una credencial de correo activa; no se envió ${aviso.descripcion}`)
        return false
    }
    let error: string | null
    try {
        error = await enviarConCredencial(credencial, {
            remitente: { email: credencial.remitenteCorreo, name: evento?.remitenteNombre || credencial.remitenteNombre || evento?.nombreCorto || ORGANIZADOR_POR_DEFECTO },
            para: [{ email: aviso.para }],
            asunto: aviso.asunto,
            html: aviso.html(evento?.correoContacto ?? credencial.remitenteCorreo),
        })
    } catch {
        error = 'no se pudo preparar el correo (plantilla)'
    }
    // El detalle del proveedor puede citar la dirección: queda en la credencial (`ultimoError`), no en el log
    if (error) console.error(`No se pudo enviar ${aviso.descripcion} (detalle en la credencial de correo)`)
    return error === null
}

/**
 * Reinscripción con un correo distinto sin verificarlo con Google: la inscripción quedó con el correo
 * registrado y se avisa a ese correo. `correoIngresado` llega ya enmascarado.
 */
export function enviarAvisoCorreoConservado(inscripcion: InscripcionDetalle, correoIngresado: string): Promise<boolean> {
    const evento = inscripcion.evento
    return enviarAviso({
        evento,
        para: inscripcion.participante.correo,
        asunto: `Conservamos tu correo en tu inscripción al ${evento.nombreCorto}`,
        descripcion: 'el aviso de correo conservado',
        html: (contacto) => renderTemplate(plantilla('correo-conservado.html'), {
            NOMBRE: inscripcion.participante.nombres,
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            CORREO_INGRESADO: correoIngresado,
            EVENTO_CORREO: contacto,
            ANIO: evento.fechaInicio.getUTCFullYear(),
        }),
    })
}

export interface CambioDeCorreo {
    nombres: string
    correoAnterior: string
    /** Ya enmascarado. */
    correoNuevo: string
    /** Evento de la inscripción más reciente, si tiene. */
    evento: EventoDelAviso | null
}

/** El staff cambió el correo de un participante: se avisa al correo anterior. */
export function enviarAvisoCambioCorreo(cambio: CambioDeCorreo): Promise<boolean> {
    const organizador = cambio.evento?.nombreCorto ?? ORGANIZADOR_POR_DEFECTO
    return enviarAviso({
        evento: cambio.evento,
        para: cambio.correoAnterior,
        asunto: `Se cambió el correo de tu registro en el ${organizador}`,
        descripcion: 'el aviso de cambio de correo',
        html: (contacto) => renderTemplate(plantilla('correo-actualizado.html'), {
            NOMBRE: cambio.nombres,
            ORGANIZADOR: organizador,
            CORREO_NUEVO: cambio.correoNuevo,
            CONTACTO: contacto,
            ANIO: (cambio.evento?.fechaInicio ?? new Date()).getUTCFullYear(),
        }),
    })
}

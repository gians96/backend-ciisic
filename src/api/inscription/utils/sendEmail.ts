import fs from 'fs'
import path from 'path'
import { Prisma, type Evento } from '@prisma/client'
import { escapeHtml, renderTemplate } from '../../../core/html'
import { obtenerConfiguracion } from '../../../core/configuracion-sistema'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import { generarInformePdf } from './generatePdf'
import type { InscripcionDetalle } from '../services/mappers'

const ASUNTO_POR_DEFECTO = 'Tu inscripción ha sido aprobada'
/** Remitente y organizador de los avisos que no pertenecen a un evento. */
const ORGANIZADOR_POR_DEFECTO = 'CIISIC'

function plantilla(nombre: string): string {
    return fs.readFileSync(path.join(__dirname, 'templates', nombre), 'utf8')
}

/**
 * Botón (HTML crudo) que abre la credencial 3D en la landing, o vacío si la URL de la landing
 * no está configurada (spec 020): sin enlace el correo sale igual, con el informe adjunto.
 */
function accionCredencial(link: string | null): string {
    if (!link) return ''
    return `<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;border-radius:4px;background-color:#0071bc;color:#ffffff;font-family:sans-serif;font-size:17px;font-weight:600;line-height:120%;text-decoration:none;">Ver mi credencial</a>`
}

/**
 * Envía el correo de aprobación con el informe genérico del evento adjunto y el enlace a la
 * credencial 3D (`<landing>/credencial/<codigo>`, spec 020) usando la credencial de correo del
 * evento (o la predeterminada, spec 006). Devuelve `false` (sin lanzar) si no hay credencial
 * activa o el envío falla, para no revertir la aprobación. Un fallo al generar el informe no
 * bloquea el correo: se envía solo con el enlace.
 */
export async function enviarCorreoAprobacion(inscripcion: InscripcionDetalle): Promise<boolean> {
    const evento = inscripcion.evento
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) {
        console.warn('No hay una credencial de correo activa; no se envió el correo de aprobación')
        return false
    }
    const { urlLanding } = await obtenerConfiguracion()
    const codigo = inscripcion.codigoCredencial
    const link = urlLanding && codigo ? `${urlLanding.replace(/\/+$/, '')}/credencial/${codigo}` : null

    let adjuntos: { nombre: string, contenidoBase64: string }[] | undefined
    try {
        const informe = await generarInformePdf(evento)
        adjuntos = [{ nombre: `informacion-${evento.codigo}.pdf`, contenidoBase64: fs.readFileSync(informe).toString('base64') }]
    } catch (error) {
        console.error(`No se pudo generar el informe de ${evento.codigo}; el correo de aprobación sale sin adjunto (${causaDe(error)})`)
    }

    let error: string | null
    try {
        const html = renderTemplate(plantilla('approval.html'), {
            NOMBRE: inscripcion.participante.nombres,
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            EVENTO_CORREO: evento.correoContacto ?? credencial.remitenteCorreo,
            ANIO: evento.fechaInicio.getUTCFullYear(),
            ACCION: accionCredencial(link),
        }, ['ACCION'])
        error = await enviarConCredencial(credencial, {
            remitente: { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto },
            para: [{ email: inscripcion.participante.correo }],
            asunto: evento.asuntoAprobacion || ASUNTO_POR_DEFECTO,
            html,
            adjuntos,
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

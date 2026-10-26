import fs from 'fs'
import path from 'path'
import { Prisma, type Evento } from '@prisma/client'
import { escapeHtml, primerNombre, renderTemplate } from '../../../core/html'
import { obtenerConfiguracion } from '../../../core/configuracion-sistema'
import { urlCredencial } from '../../../core/enlaces-landing'
import { modalidadDe } from '../../../core/catalogos'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import type { InscripcionDetalle } from '../services/mappers'

const ASUNTO_POR_DEFECTO = 'Tu inscripción ha sido aprobada'
/** Remitente y organizador de los avisos que no pertenecen a un evento. */
const ORGANIZADOR_POR_DEFECTO = 'CIISIC'

/** Texto neutro para quien se inscribe a distancia (spec 018): sin enlaces ni promesas de horas o certificado. */
export const TEXTO_MODALIDAD_VIRTUAL = 'Tu inscripción es en modalidad VIRTUAL: la organización te compartirá las indicaciones para conectarte a la transmisión del congreso.'

/**
 * Párrafo extra del correo de aprobación, solo para los tipos virtuales. `renderTemplate` no tiene
 * condicionales: el bloque se compone aquí (texto escapado) y se pasa como `raw`; para los demás, vacío.
 */
export function parrafoModalidad(tipo: { modalidad?: unknown } | null | undefined): string {
    if (modalidadDe(tipo?.modalidad) !== 'VIRTUAL') return ''
    return `<p style="margin: 15px 0 0 0; padding: 0">${escapeHtml(TEXTO_MODALIDAD_VIRTUAL)}</p>`
}

function plantilla(nombre: string): string {
    return fs.readFileSync(path.join(__dirname, 'templates', nombre), 'utf8')
}

/**
 * Fila del correo de aprobación con el botón a la credencial 3D (spec 038). `renderTemplate` no tiene
 * condicionales: la fila se compone aquí (URL escapada) y, sin enlace, no hay fila.
 */
export function filaCredencial3d(enlace: string | null): string {
    if (!enlace) return ''
    return `<tr><td align="center" valign="top" style="padding: 18px 6.25% 5px 6.25%; font-family: sans-serif">
<a href="${escapeHtml(enlace)}" style="display: inline-block; padding: 10px 22px; border: 2px solid #0071bc; border-radius: 4px; color: #0071bc; font-size: 16px; font-weight: 600; line-height: 120%; text-decoration: none">Ver mi credencial 3D</a>
<p style="margin: 10px 0 0 0; padding: 0; font-size: 13px; line-height: 150%; color: #666666">Ábrela desde tu celular y toca dos veces la credencial para elegir las tecnologías que usas.</p>
</td></tr>`
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
    const { urlLanding } = await obtenerConfiguracion()
    let error: string | null
    try {
        const html = renderTemplate(plantilla('approval.html'), {
            NOMBRE: inscripcion.participante.nombres,
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            EVENTO_CORREO: evento.correoContacto ?? credencial.remitenteCorreo,
            ANIO: evento.fechaInicio.getUTCFullYear(),
            AVISO_MODALIDAD: parrafoModalidad(inscripcion.tipoInscripcion),
            FILA_CREDENCIAL_3D: filaCredencial3d(urlCredencial(urlLanding, inscripcion.codigoCredencial)),
        }, ['AVISO_MODALIDAD', 'FILA_CREDENCIAL_3D'])
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

/**
 * Envío masivo del enlace de la credencial 3D (spec 039): un correo por persona con su propio enlace
 * (`<landing>/credencial/<codigo>`). Devuelve `false` (sin lanzar) si no hay credencial de correo activa o
 * el envío falla; el detalle del proveedor queda en la credencial de correo, no en el log.
 */
export async function enviarCorreoEnlaceCredencial(inscripcion: InscripcionDetalle, enlace: string): Promise<boolean> {
    const evento = inscripcion.evento
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) {
        console.warn('No hay una credencial de correo activa; no se envió el enlace de la credencial')
        return false
    }
    let error: string | null
    try {
        const html = renderTemplate(plantilla('credencial-enlace.html'), {
            NOMBRE: primerNombre(inscripcion.participante.nombres) || 'participante',
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            EVENTO_CORREO: evento.correoContacto ?? credencial.remitenteCorreo,
            ENLACE: enlace,
            CODIGO: inscripcion.codigoCredencial ?? '',
            ANIO: evento.fechaInicio.getUTCFullYear(),
        })
        error = await enviarConCredencial(credencial, {
            remitente: { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto },
            para: [{ email: inscripcion.participante.correo }],
            asunto: `Tu credencial digital del ${evento.nombreCorto}`,
            html,
        })
    } catch {
        error = 'no se pudo preparar el correo (plantilla)'
    }
    if (error) console.error('No se pudo enviar el enlace de la credencial (detalle en la credencial de correo)')
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

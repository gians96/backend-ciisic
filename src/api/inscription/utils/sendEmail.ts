import fs from 'fs'
import path from 'path'
import { renderTemplate } from '../../../core/html'
import { credencialParaEvento, enviarConCredencial } from '../../email-credential/services/email-credential'
import type { InscripcionDetalle } from '../services/mappers'

const ASUNTO_POR_DEFECTO = 'Tu inscripción ha sido aprobada'

/**
 * Envía el correo de aprobación con la credencial adjunta usando la credencial de correo del
 * evento (o la predeterminada, spec 006). Devuelve `false` (sin lanzar) si no hay credencial
 * activa o el envío falla, para no revertir la aprobación.
 */
export async function enviarCorreoAprobacion(inscripcion: InscripcionDetalle, pdfPath: string): Promise<boolean> {
    const evento = inscripcion.evento
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) {
        console.warn('No hay una credencial de correo activa; no se envió el correo de aprobación')
        return false
    }
    let error: string | null
    try {
        const plantilla = fs.readFileSync(path.join(__dirname, 'templates', 'approval.html'), 'utf8')
        const html = renderTemplate(plantilla, {
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
            adjuntos: [{ nombre: `credencial-${evento.codigo}-${inscripcion.id}.pdf`, contenidoBase64: fs.readFileSync(pdfPath).toString('base64') }],
        })
    } catch {
        error = 'no se pudo preparar el correo (plantilla o credencial PDF)'
    }
    if (error) console.error(`No se pudo enviar el correo de aprobación: ${error}`)
    return error === null
}

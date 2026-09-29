import fs from 'fs'
import path from 'path'
import SibApiV3Sdk from 'sib-api-v3-sdk'
import { env } from '../../../../config/env'
import { renderTemplate } from '../../../core/html'
import type { InscripcionDetalle } from '../services/mappers'

const client = SibApiV3Sdk.ApiClient.instance
client.authentications['api-key'].apiKey = env.BREVO_API_KEY
const emailApi = new SibApiV3Sdk.TransactionalEmailsApi()

/**
 * Envía el correo de aprobación con la credencial adjunta. Devuelve `false` (sin lanzar)
 * si Brevo no está configurado o el envío falla, para no revertir la aprobación.
 */
export async function enviarCorreoAprobacion(inscripcion: InscripcionDetalle, pdfPath: string): Promise<boolean> {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER) {
        console.warn('Brevo no está configurado; no se envió el correo de aprobación')
        return false
    }
    const evento = inscripcion.evento
    try {
        const plantilla = fs.readFileSync(path.join(__dirname, 'templates', 'approval.html'), 'utf8')
        const htmlContent = renderTemplate(plantilla, {
            NOMBRE: inscripcion.participante.nombres,
            EVENTO_NOMBRE: evento.nombre,
            EVENTO_NOMBRE_CORTO: evento.nombreCorto,
            EVENTO_CORREO: evento.correoContacto ?? env.BREVO_SENDER,
            ANIO: evento.fechaInicio.getUTCFullYear(),
        })
        await emailApi.sendTransacEmail({
            sender: { email: env.BREVO_SENDER, name: evento.remitenteNombre || env.BREVO_SENDER_NAME || evento.nombreCorto },
            to: [{ email: inscripcion.participante.correo }],
            subject: evento.asuntoAprobacion || env.BREVO_SENDER_SUBJECT,
            htmlContent,
            attachment: [{ name: `credencial-${evento.codigo}-${inscripcion.id}.pdf`, content: fs.readFileSync(pdfPath).toString('base64') }],
        })
        return true
    } catch {
        console.error('No se pudo enviar un correo de aprobación mediante Brevo')
        return false
    }
}

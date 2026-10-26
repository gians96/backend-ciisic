import * as controller from '../controllers/broadcast'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limiteEnviosMasivos, limiteLecturaEnvios } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { enviarEnlacesCredencialSchema, enviarInvitacionPonenciasSchema, probarInvitacionPonenciasSchema } from '../validation'

/**
 * Envíos masivos a los inscritos presenciales (spec 039). Reusan permisos que ya existen: quien ve
 * inscritos ve la lista de la credencial y quien puede reenviar credenciales envía los enlaces; quien ve
 * las ponencias especializadas ve la lista de la invitación y quien inscribe a ponencias la envía.
 */
const verCredenciales = requirePermiso('inscripciones.ver', { evento: eventoDelParametro('eventId') })
const enviarCredenciales = requirePermiso('credenciales.reenviar', { evento: eventoDelParametro('eventId') })
const verPonencias = requirePermiso('especializadas.ver', { evento: eventoDelParametro('eventId') })
const enviarPonencias = requirePermiso('especializadas.inscribir', { evento: eventoDelParametro('eventId') })

const routes: AppRoute[] = [
    // Enlace de la credencial 3D: cada persona recibe el suyo
    { method: 'get', path: '/v1/events/:eventId/credential-links', handler: controller.listar('credencial'), middlewares: [verCredenciales, limiteLecturaEnvios] },
    { method: 'get', path: '/v1/events/:eventId/credential-links/ids', handler: controller.ids('credencial'), middlewares: [verCredenciales, limiteLecturaEnvios] },
    { method: 'post', path: '/v1/events/:eventId/credential-links/send', handler: controller.sendCredentialLinks, middlewares: [enviarCredenciales, limiteEnviosMasivos, validateBody(enviarEnlacesCredencialSchema)] },

    // Enlace de inscripción a las ponencias especializadas: un mismo mensaje para todas
    { method: 'get', path: '/v1/events/:eventId/specialized-talk-invitations', handler: controller.listar('ponencias'), middlewares: [verPonencias, limiteLecturaEnvios] },
    { method: 'get', path: '/v1/events/:eventId/specialized-talk-invitations/ids', handler: controller.ids('ponencias'), middlewares: [verPonencias, limiteLecturaEnvios] },
    { method: 'post', path: '/v1/events/:eventId/specialized-talk-invitations/send', handler: controller.sendTalkInvitations, middlewares: [enviarPonencias, limiteEnviosMasivos, validateBody(enviarInvitacionPonenciasSchema)] },
    { method: 'post', path: '/v1/events/:eventId/specialized-talk-invitations/test', handler: controller.testTalkInvitation, middlewares: [enviarPonencias, limiteEnviosMasivos, validateBody(probarInvitacionPonenciasSchema)] },
]

export default buildRouter(routes)

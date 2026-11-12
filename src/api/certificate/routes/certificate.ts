import * as controller from '../controllers/certificate'
import * as publico from '../controllers/public-certificate'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireParticipante, requirePermiso } from '../../../middlewares/auth'
import {
    limiteCargaCertificados,
    limiteConsultaCertificados,
    limiteCredencialPortal,
    limiteDescargaCertificadoPublico,
    limiteEnviosMasivos,
    limiteIntentosDni,
    limiteLecturaCertificados,
    limitePortal,
} from '../../../middlewares/rate-limit'
import { uploadCertificados, uploadExcel } from '../../../middlewares/upload'
import { validateBody } from '../../../middlewares/validate'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { anularCertificadoSchema, enviarCertificadosSchema, probarEnvioSchema } from '../validation'

/**
 * Certificados (spec 015, fase 1: certificados firmados fuera del sistema). Ver: la lista y los PDF; operar: subir
 * los PDF firmados y enviarlos por correo; gestionar (global): importar el Excel y anular. Todas las rutas del staff
 * van bajo el evento y el servicio comprueba que el certificado sea de ese evento.
 */
const evento = { evento: eventoDelParametro('eventId') }
const ver = requirePermiso('certificados.ver', evento)
const operar = requirePermiso('certificados.operar', evento)
const gestionar = requirePermiso('certificados.gestionar')

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/certificates', handler: controller.list, middlewares: [ver, limiteLecturaCertificados] },
    { method: 'get', path: '/v1/events/:eventId/certificates/ids', handler: controller.ids, middlewares: [ver, limiteLecturaCertificados] },
    { method: 'get', path: '/v1/events/:eventId/certificates/pending-inscriptions', handler: controller.pendingInscriptions, middlewares: [ver, limiteLecturaCertificados] },
    { method: 'post', path: '/v1/events/:eventId/certificates/import', handler: controller.importExcel, middlewares: [gestionar, limiteCargaCertificados, uploadExcel.single('file')] },
    { method: 'post', path: '/v1/events/:eventId/certificates/files', handler: controller.uploadFiles, middlewares: [operar, limiteCargaCertificados, uploadCertificados.array('files')] },
    { method: 'post', path: '/v1/events/:eventId/certificates/send', handler: controller.send, middlewares: [operar, limiteEnviosMasivos, validateBody(enviarCertificadosSchema)] },
    { method: 'get', path: '/v1/events/:eventId/certificates/:id', handler: controller.detail, middlewares: [ver, limiteLecturaCertificados] },
    { method: 'get', path: '/v1/events/:eventId/certificates/:id/file', handler: controller.file, middlewares: [ver, limiteLecturaCertificados] },
    { method: 'put', path: '/v1/events/:eventId/certificates/:id/file', handler: controller.uploadFile, middlewares: [operar, limiteCargaCertificados, uploadCertificados.single('file')] },
    { method: 'post', path: '/v1/events/:eventId/certificates/:id/test', handler: controller.test, middlewares: [operar, limiteEnviosMasivos, validateBody(probarEnvioSchema)] },
    { method: 'post', path: '/v1/events/:eventId/certificates/:id/annul', handler: controller.annul, middlewares: [gestionar, limiteCargaCertificados, validateBody(anularCertificadoSchema)] },

    // Públicas, sin sesión. El DNI va en el cuerpo; los intentos fallidos topan por IP
    { method: 'post', path: '/v1/public/certificates/lookup', handler: publico.lookup, middlewares: [limiteIntentosDni, limiteConsultaCertificados] },
    { method: 'get', path: '/v1/public/certificates/:codigo', handler: publico.show, middlewares: [limiteConsultaCertificados] },
    { method: 'get', path: '/v1/public/certificates/:codigo/file', handler: publico.file, middlewares: [limiteDescargaCertificadoPublico] },

    // Portal del inscrito: solo los suyos con PDF
    { method: 'get', path: '/v1/me/certificates', handler: publico.mine, middlewares: [requireParticipante, limitePortal] },
    { method: 'get', path: '/v1/me/certificates/:id/file', handler: publico.mineFile, middlewares: [requireParticipante, limiteCredencialPortal] },
]

export default buildRouter(routes)

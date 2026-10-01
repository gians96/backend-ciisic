import * as controller from '../controllers/participant-portal'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireParticipante } from '../../../middlewares/auth'
import { limiteCredencialPortal, limiteFotoPortal, limitePortal } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { fotoUpload } from '../upload'
import { actualizarPerfilSchema } from '../validation'

// Portal del inscrito (specs 011 y 014): sesión de participante (Google o código por correo).
// Orden: sesión → limitador por participante → cuerpo o archivo.
const sesion = [requireParticipante, limitePortal]

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/me', handler: controller.me, middlewares: sesion },
    { method: 'patch', path: '/v1/me/profile', handler: controller.updateProfile, middlewares: [...sesion, validateBody(actualizarPerfilSchema)] },
    { method: 'get', path: '/v1/me/photo', handler: controller.photo, middlewares: sesion },
    { method: 'put', path: '/v1/me/photo', handler: controller.uploadPhoto, middlewares: [requireParticipante, limiteFotoPortal, fotoUpload.single('file')] },
    { method: 'delete', path: '/v1/me/photo', handler: controller.deletePhoto, middlewares: sesion },
    { method: 'get', path: '/v1/me/inscriptions', handler: controller.inscriptions, middlewares: sesion },
    { method: 'get', path: '/v1/me/inscriptions/:id/badge', handler: controller.badge, middlewares: sesion },
    { method: 'get', path: '/v1/me/inscriptions/:id/credential', handler: controller.credential, middlewares: [requireParticipante, limiteCredencialPortal] },
    { method: 'get', path: '/v1/me/attendances', handler: controller.attendances, middlewares: sesion },
    // Certificados (spec 015): solo los firmados propios
    { method: 'get', path: '/v1/me/certificates', handler: controller.certificates, middlewares: sesion },
    { method: 'get', path: '/v1/me/certificates/:id/file', handler: controller.certificateFile, middlewares: [requireParticipante, limiteCredencialPortal] },
]

export default buildRouter(routes)

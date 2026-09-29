import * as controller from '../controllers/inscription'
import { AppRoute, buildRouter } from '../../../core/routes'
import { upload, validateUploadedFileContent } from '../../../middlewares/upload'
import { verifyAdminRole, verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { cambiarEstadoLegacySchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso). El token se valida antes de
    // recibir el archivo.
    {
        method: 'post',
        path: '/v1/site/inscriptions',
        handler: controller.publicCreate,
        middlewares: [requireTokenEvento, limiteInscripcion, upload.single('voucher'), validateUploadedFileContent],
    },

    // Legacy (landing anterior y herramientas previas; evento principal)
    { method: 'post', path: '/v1/inscription', handler: controller.legacyCreate, middlewares: [rutaLegacy, limiteInscripcion, upload.single('file'), validateUploadedFileContent] },
    { method: 'get', path: '/v1/inscription', handler: controller.legacyList, middlewares: [rutaLegacy, verifyAdminRole] },
    { method: 'get', path: '/v1/inscription/:id', handler: controller.legacyFind, middlewares: [rutaLegacy, verifyAdminRole] },
    { method: 'put', path: '/v1/inscription/:id/status', handler: controller.legacyUpdateStatus, middlewares: [rutaLegacy, verifyAdminRole, validateBody(cambiarEstadoLegacySchema)] },
    { method: 'delete', path: '/v1/inscription/:id', handler: controller.remove, middlewares: [rutaLegacy, verifySuperAdminRole] },

    // Administración
    { method: 'get', path: '/v1/events/:eventId/inscriptions', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/events/:eventId/inscriptions/export', handler: controller.exportCsv, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/inscriptions/:id', handler: controller.find, middlewares: [verifyAdminRole] },
    { method: 'patch', path: '/v1/inscriptions/:id/status', handler: controller.updateStatus, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/inscriptions/:id/resend-credential', handler: controller.resendCredential, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/inscriptions/:id/voucher', handler: controller.voucher, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/inscriptions/:id/credential', handler: controller.credential, middlewares: [verifyAdminRole] },
    { method: 'delete', path: '/v1/inscriptions/:id', handler: controller.remove, middlewares: [verifySuperAdminRole] },
]

export default buildRouter(routes)

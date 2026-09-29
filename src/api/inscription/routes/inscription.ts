import * as controller from '../controllers/inscription'
import { AppRoute, buildRouter } from '../../../core/routes'
import { upload, validateUploadedFileContent } from '../../../middlewares/upload'
import { verifyAdminRole, verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion } from '../../../middlewares/rate-limit'
import { cambiarEstadoLegacySchema } from '../validation'

const routes: AppRoute[] = [
    // Público (landing)
    {
        method: 'post',
        path: '/v1/public/events/:codigo/inscriptions',
        handler: controller.publicCreate,
        middlewares: [limiteInscripcion, upload.single('voucher'), validateUploadedFileContent],
    },

    // Legacy (landing anterior y herramientas previas; evento principal)
    { method: 'post', path: '/v1/inscription', handler: controller.legacyCreate, middlewares: [limiteInscripcion, upload.single('file'), validateUploadedFileContent] },
    { method: 'get', path: '/v1/inscription', handler: controller.legacyList, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/inscription/:id', handler: controller.legacyFind, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/inscription/:id/status', handler: controller.legacyUpdateStatus, middlewares: [verifyAdminRole, validateBody(cambiarEstadoLegacySchema)] },
    { method: 'delete', path: '/v1/inscription/:id', handler: controller.remove, middlewares: [verifySuperAdminRole] },

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

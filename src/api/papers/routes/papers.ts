import { buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { limitePonencias } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { paperUpload } from '../upload'
import * as controller from '../controllers/papers'

export default buildRouter([
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'post', path: '/v1/site/papers', middlewares: [requireTokenEvento, limitePonencias, paperUpload.single('file')], handler: controller.publicCreate },
    // Legacy (evento principal)
    { method: 'post', path: '/v1/papers', middlewares: [rutaLegacy, limitePonencias, paperUpload.single('file')], handler: controller.create },
    { method: 'get', path: '/v1/papers', middlewares: [rutaLegacy, verifyAdminRole], handler: controller.list },
    // Administración
    { method: 'get', path: '/v1/events/:eventId/papers', middlewares: [verifyAdminRole], handler: controller.listByEvent },
    { method: 'get', path: '/v1/papers/:id/file', middlewares: [verifyAdminRole], handler: controller.download },
])

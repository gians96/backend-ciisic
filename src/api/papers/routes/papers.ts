import { buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { limitePonencias } from '../../../middlewares/rate-limit'
import { paperUpload } from '../upload'
import * as controller from '../controllers/papers'

export default buildRouter([
    // Público (landing)
    { method: 'post', path: '/v1/public/events/:codigo/papers', middlewares: [limitePonencias, paperUpload.single('file')], handler: controller.publicCreate },
    // Legacy (evento principal)
    { method: 'post', path: '/v1/papers', middlewares: [limitePonencias, paperUpload.single('file')], handler: controller.create },
    { method: 'get', path: '/v1/papers', middlewares: [verifyAdminRole], handler: controller.list },
    // Administración
    { method: 'get', path: '/v1/events/:eventId/papers', middlewares: [verifyAdminRole], handler: controller.listByEvent },
    { method: 'get', path: '/v1/papers/:id/file', middlewares: [verifyAdminRole], handler: controller.download },
])

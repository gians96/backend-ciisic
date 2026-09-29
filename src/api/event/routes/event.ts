import * as controller from '../controllers/event'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica } from '../../../middlewares/rate-limit'
import { actualizarEventoSchema, crearEventoSchema } from '../validation'

const routes: AppRoute[] = [
    // Público (landing)
    { method: 'get', path: '/v1/public/events/:codigo', handler: controller.publicFind, middlewares: [limiteLecturaPublica] },

    // Administración
    { method: 'get', path: '/v1/events', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/events', handler: controller.create, middlewares: [verifyAdminRole, validateBody(crearEventoSchema)] },
    { method: 'get', path: '/v1/events/:id', handler: controller.find, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/events/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarEventoSchema)] },
    { method: 'delete', path: '/v1/events/:id', handler: controller.remove, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/events/:id/summary', handler: controller.summary, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

import * as controller from '../controllers/event'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { actualizarEventoSchema, crearEventoSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'get', path: '/v1/site/event', handler: controller.publicFind, middlewares: [requireTokenEvento, limiteLecturaPublica] },

    // Administración
    { method: 'get', path: '/v1/events', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/events', handler: controller.create, middlewares: [verifyAdminRole, validateBody(crearEventoSchema)] },
    { method: 'get', path: '/v1/events/:id', handler: controller.find, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/events/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarEventoSchema)] },
    { method: 'delete', path: '/v1/events/:id', handler: controller.remove, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/events/:id/summary', handler: controller.summary, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

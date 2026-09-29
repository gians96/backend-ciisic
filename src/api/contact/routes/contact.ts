import * as controller from '../controllers/contact'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteContacto } from '../../../middlewares/rate-limit'
import { actualizarMensajeSchema, createContactSchema, crearMensajeSchema } from '../validation'

const routes: AppRoute[] = [
    // Público (landing)
    { method: 'post', path: '/v1/public/events/:codigo/contact', handler: controller.publicCreate, middlewares: [limiteContacto, validateBody(crearMensajeSchema)] },

    // Legacy
    { method: 'post', path: '/v1/contact', handler: controller.create, middlewares: [limiteContacto, validateBody(createContactSchema)] },
    { method: 'get', path: '/v1/contact', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/contact/:id', handler: controller.find, middlewares: [verifyAdminRole] },
    { method: 'delete', path: '/v1/contact/:id', handler: controller.remove, middlewares: [verifyAdminRole] },

    // Administración
    { method: 'get', path: '/v1/events/:eventId/contact-messages', handler: controller.listByEvent, middlewares: [verifyAdminRole] },
    { method: 'patch', path: '/v1/contact-messages/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarMensajeSchema)] },
    { method: 'delete', path: '/v1/contact-messages/:id', handler: controller.remove, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

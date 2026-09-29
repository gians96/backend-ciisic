import * as controller from '../controllers/contact'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteContacto } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { actualizarMensajeSchema, createContactSchema, crearMensajeSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'post', path: '/v1/site/contact', handler: controller.publicCreate, middlewares: [requireTokenEvento, limiteContacto, validateBody(crearMensajeSchema)] },

    // Legacy
    { method: 'post', path: '/v1/contact', handler: controller.create, middlewares: [rutaLegacy, limiteContacto, validateBody(createContactSchema)] },
    { method: 'get', path: '/v1/contact', handler: controller.list, middlewares: [rutaLegacy, verifyAdminRole] },
    { method: 'get', path: '/v1/contact/:id', handler: controller.find, middlewares: [rutaLegacy, verifyAdminRole] },
    { method: 'delete', path: '/v1/contact/:id', handler: controller.remove, middlewares: [rutaLegacy, verifyAdminRole] },

    // Administración
    { method: 'get', path: '/v1/events/:eventId/contact-messages', handler: controller.listByEvent, middlewares: [verifyAdminRole] },
    { method: 'patch', path: '/v1/contact-messages/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarMensajeSchema)] },
    { method: 'delete', path: '/v1/contact-messages/:id', handler: controller.remove, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

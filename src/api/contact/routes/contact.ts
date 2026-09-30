import * as controller from '../controllers/contact'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteContacto, limiteTokenContacto } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { eventoDelParametro, eventoDeMensaje } from '../../../core/resolutores-evento'
import { actualizarMensajeSchema, createContactSchema, crearMensajeSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'post', path: '/v1/site/contact', handler: controller.publicCreate, middlewares: [requireTokenEvento, limiteContacto, limiteTokenContacto, validateBody(crearMensajeSchema)] },

    // Legacy
    { method: 'post', path: '/v1/contact', handler: controller.create, middlewares: [rutaLegacy, limiteContacto, validateBody(createContactSchema)] },
    { method: 'get', path: '/v1/contact', handler: controller.list, middlewares: [rutaLegacy, requirePermiso('legacy.usar')] },
    { method: 'get', path: '/v1/contact/:id', handler: controller.find, middlewares: [rutaLegacy, requirePermiso('legacy.usar')] },
    { method: 'delete', path: '/v1/contact/:id', handler: controller.remove, middlewares: [rutaLegacy, requirePermiso('legacy.usar')] },

    // Administración. Un mensaje antiguo sin evento no es de ninguna cuenta por evento (la guarda
    // responde 404 a esas cuentas).
    { method: 'get', path: '/v1/events/:eventId/contact-messages', handler: controller.listByEvent, middlewares: [requirePermiso('mensajes.ver', { evento: eventoDelParametro('eventId') })] },
    {
        method: 'patch',
        path: '/v1/contact-messages/:id',
        handler: controller.update,
        middlewares: [requirePermiso('mensajes.ver', { evento: eventoDeMensaje }), validateBody(actualizarMensajeSchema)],
    },
    { method: 'delete', path: '/v1/contact-messages/:id', handler: controller.remove, middlewares: [requirePermiso('mensajes.eliminar', { evento: eventoDeMensaje })] },
]

export default buildRouter(routes)

import * as controller from '../controllers/event'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireActor, requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { actualizarEventoSchema, crearEventoSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'get', path: '/v1/site/event', handler: controller.publicFind, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },

    // Administración. La lista la usa todo el staff: el controlador filtra por los eventos del actor.
    { method: 'get', path: '/v1/events', handler: controller.list, middlewares: [requireActor] },
    { method: 'post', path: '/v1/events', handler: controller.create, middlewares: [requirePermiso('eventos.configurar'), validateBody(crearEventoSchema)] },
    { method: 'get', path: '/v1/events/:id', handler: controller.find, middlewares: [requirePermiso('eventos.configurar')] },
    { method: 'put', path: '/v1/events/:id', handler: controller.update, middlewares: [requirePermiso('eventos.configurar'), validateBody(actualizarEventoSchema)] },
    { method: 'delete', path: '/v1/events/:id', handler: controller.remove, middlewares: [requirePermiso('eventos.eliminar')] },
    { method: 'get', path: '/v1/events/:id/summary', handler: controller.summary, middlewares: [requirePermiso('resumen.ver', { evento: eventoDelParametro('id') })] },
]

export default buildRouter(routes)

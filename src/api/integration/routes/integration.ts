import * as controller from '../controllers/integration'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { actualizarIntegracionSchema, crearIntegracionSchema } from '../validation'

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/integrations', handler: controller.list, middlewares: [requirePermiso('eventos.configurar')] },
    { method: 'post', path: '/v1/events/:eventId/integrations', handler: controller.create, middlewares: [requirePermiso('eventos.configurar'), validateBody(crearIntegracionSchema)] },
    // Resumen Semana Sistémica: parte del resumen del evento (sin «pagos.ver», sin montos)
    {
        method: 'get',
        path: '/v1/events/:eventId/integrations/sports-summary',
        handler: controller.sportsSummary,
        middlewares: [requirePermiso('resumen.ver', { evento: eventoDelParametro('eventId') })],
    },
    { method: 'put', path: '/v1/integrations/:id', handler: controller.update, middlewares: [requirePermiso('eventos.configurar'), validateBody(actualizarIntegracionSchema)] },
    { method: 'delete', path: '/v1/integrations/:id', handler: controller.remove, middlewares: [requirePermiso('eventos.configurar')] },
    { method: 'post', path: '/v1/integrations/:id/test', handler: controller.test, middlewares: [requirePermiso('eventos.configurar')] },
]

export default buildRouter(routes)

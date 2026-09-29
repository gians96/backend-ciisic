import * as controller from '../controllers/integration'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarIntegracionSchema, crearIntegracionSchema } from '../validation'

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/integrations', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/events/:eventId/integrations', handler: controller.create, middlewares: [verifyAdminRole, validateBody(crearIntegracionSchema)] },
    { method: 'get', path: '/v1/events/:eventId/integrations/sports-summary', handler: controller.sportsSummary, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/integrations/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarIntegracionSchema)] },
    { method: 'delete', path: '/v1/integrations/:id', handler: controller.remove, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/integrations/:id/test', handler: controller.test, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

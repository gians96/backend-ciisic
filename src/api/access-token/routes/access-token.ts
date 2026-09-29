import * as controller from '../controllers/access-token'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { crearTokenAccesoSchema } from '../validation'

// Tokens de acceso del sitio de cada evento (spec 007): solo SuperAdmin.
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/access-tokens', handler: controller.list, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/events/:eventId/access-tokens', handler: controller.create, middlewares: [verifySuperAdminRole, validateBody(crearTokenAccesoSchema)] },
    { method: 'delete', path: '/v1/access-tokens/:id', handler: controller.revoke, middlewares: [verifySuperAdminRole] },
]

export default buildRouter(routes)

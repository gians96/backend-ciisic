import * as controller from '../controllers/delegation'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarDelegacionSchema, crearDelegacionSchema } from '../validation'

// Delegaciones (spec 018): solo cuentas globales (Owner y Administrador del sistema)
const gestionar = requirePermiso('delegaciones.gestionar')

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/delegations', handler: controller.list, middlewares: [gestionar] },
    { method: 'post', path: '/v1/events/:eventId/delegations', handler: controller.create, middlewares: [gestionar, validateBody(crearDelegacionSchema)] },
    { method: 'get', path: '/v1/delegations/:id', handler: controller.find, middlewares: [gestionar] },
    { method: 'patch', path: '/v1/delegations/:id', handler: controller.update, middlewares: [gestionar, validateBody(actualizarDelegacionSchema)] },
    { method: 'get', path: '/v1/delegations/:id/members', handler: controller.members, middlewares: [gestionar] },
]

export default buildRouter(routes)

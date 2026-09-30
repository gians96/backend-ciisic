import * as controller from '../controllers/access-token'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { crearTokenAccesoSchema } from '../validation'

// Tokens de acceso del sitio de cada evento (spec 007): son parte de la configuración del evento
// (spec 013: Owner y Administrador del sistema).
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/access-tokens', handler: controller.list, middlewares: [requirePermiso('eventos.configurar')] },
    { method: 'post', path: '/v1/events/:eventId/access-tokens', handler: controller.create, middlewares: [requirePermiso('eventos.configurar'), validateBody(crearTokenAccesoSchema)] },
    { method: 'delete', path: '/v1/access-tokens/:id', handler: controller.revoke, middlewares: [requirePermiso('eventos.configurar')] },
]

export default buildRouter(routes)

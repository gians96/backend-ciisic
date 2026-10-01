import * as controller from '../controllers/participant'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarParticipanteSchema, crearParticipanteSchema } from '../validation'

// Personas de todos los eventos: solo las cuentas globales (spec 013)
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/participants', handler: controller.list, middlewares: [requirePermiso('participantes.gestionar')] },
    { method: 'post', path: '/v1/participants', handler: controller.create, middlewares: [requirePermiso('participantes.gestionar'), validateBody(crearParticipanteSchema)] },
    { method: 'get', path: '/v1/participants/:id', handler: controller.find, middlewares: [requirePermiso('participantes.gestionar')] },
    { method: 'put', path: '/v1/participants/:id', handler: controller.update, middlewares: [requirePermiso('participantes.gestionar'), validateBody(actualizarParticipanteSchema)] },
]

export default buildRouter(routes)

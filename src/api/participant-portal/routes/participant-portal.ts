import * as controller from '../controllers/participant-portal'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireParticipante } from '../../../middlewares/auth'
import { limiteCredencialPortal, limitePortal } from '../../../middlewares/rate-limit'

// Portal del inscrito (spec 011): sesión de participante obtenida con Google
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/me', handler: controller.me, middlewares: [requireParticipante, limitePortal] },
    { method: 'get', path: '/v1/me/inscriptions', handler: controller.inscriptions, middlewares: [requireParticipante, limitePortal] },
    { method: 'get', path: '/v1/me/inscriptions/:id/credential', handler: controller.credential, middlewares: [requireParticipante, limiteCredencialPortal] },
]

export default buildRouter(routes)

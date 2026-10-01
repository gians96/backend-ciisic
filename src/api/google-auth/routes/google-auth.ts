import * as controller from '../controllers/google-auth'
import { AppRoute, buildRouter } from '../../../core/routes'
import { validateBody } from '../../../middlewares/validate'
import { limiteLoginGoogle, limiteTokenGoogle, limiteVerificacion } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { loginGoogleSchema, verificacionGoogleSchema } from '../validation'

// Acceso con Google (spec 010)
const routes: AppRoute[] = [
    // Panel: administradores y participantes (portal)
    { method: 'post', path: '/v1/auth/google', handler: controller.login, middlewares: [limiteLoginGoogle, validateBody(loginGoogleSchema)] },
    // Landing del evento: verificación opcional del correo al inscribirse
    {
        method: 'post',
        path: '/v1/site/google-verification',
        handler: controller.siteVerification,
        middlewares: [requireTokenEvento, limiteVerificacion, limiteTokenGoogle, validateBody(verificacionGoogleSchema)],
    },
]

export default buildRouter(routes)

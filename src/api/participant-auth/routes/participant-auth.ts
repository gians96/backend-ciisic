import * as controller from '../controllers/participant-auth'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireActor } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteSolicitudCodigo, limiteSwitch, limiteVerificacionCodigo } from '../../../middlewares/rate-limit'
import { solicitarCodigoSchema, verificarCodigoSchema } from '../validation'

// Acceso al portal del participante con un código por correo y paso del staff a su portal (spec 014)
const routes: AppRoute[] = [
    // Públicas: los topes por correo y por IP van en la BD; el limitador es por visitante
    { method: 'post', path: '/v1/auth/participant/code', handler: controller.requestCode, middlewares: [limiteSolicitudCodigo, validateBody(solicitarCodigoSchema)] },
    { method: 'post', path: '/v1/auth/participant/code/verify', handler: controller.verifyCode, middlewares: [limiteVerificacionCodigo, validateBody(verificarCodigoSchema)] },
    // Cualquier cuenta de staff activa que entró con Google (el servicio exige el método)
    { method: 'post', path: '/v1/auth/participant/switch', handler: controller.switchToPortal, middlewares: [requireActor, limiteSwitch] },
]

export default buildRouter(routes)

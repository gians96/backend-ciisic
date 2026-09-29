import * as controller from '../controllers/system-settings'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { actualizarConfiguracionSchema } from '../validation'

const routes: AppRoute[] = [
    // Configuración del sistema (spec 008): solo SuperAdmin
    { method: 'get', path: '/v1/settings', handler: controller.find, middlewares: [verifySuperAdminRole] },
    { method: 'put', path: '/v1/settings', handler: controller.update, middlewares: [verifySuperAdminRole, validateBody(actualizarConfiguracionSchema)] },
    { method: 'post', path: '/v1/settings/undc-api/test', handler: controller.testUndc, middlewares: [verifySuperAdminRole] },

    // Configuración pública: el panel (sin sesión) y la landing (con su token)
    { method: 'get', path: '/v1/auth/config', handler: controller.publicConfig, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/site/config', handler: controller.publicConfig, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
]

export default buildRouter(routes)

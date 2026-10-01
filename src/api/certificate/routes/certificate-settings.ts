import * as controller from '../controllers/configuracion'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarConfiguracionCertificadosSchema } from '../validation/configuracion'

/**
 * Configuración de certificados (spec 015): proveedor del código, prefijo y confirmación, con
 * `certificados.gestionar`. Las credenciales de la API UNDC van en Sistema (`/v1/settings`, Owner).
 */
const gestionar = requirePermiso('certificados.gestionar')

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/certificate-settings', handler: controller.find, middlewares: [gestionar] },
    { method: 'put', path: '/v1/certificate-settings', handler: controller.update, middlewares: [gestionar, validateBody(actualizarConfiguracionCertificadosSchema)] },
]

export default buildRouter(routes)

import * as controller from '../controllers/email-credential'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarCredencialSchema, crearCredencialSchema, enviarPruebaSchema } from '../validation'

// Credenciales de correo saliente (spec 006): solo SuperAdmin.
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/email-credentials', handler: controller.list, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/email-credentials', handler: controller.create, middlewares: [verifySuperAdminRole, validateBody(crearCredencialSchema)] },
    { method: 'put', path: '/v1/email-credentials/:id', handler: controller.update, middlewares: [verifySuperAdminRole, validateBody(actualizarCredencialSchema)] },
    { method: 'delete', path: '/v1/email-credentials/:id', handler: controller.remove, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/email-credentials/:id/test', handler: controller.test, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/email-credentials/:id/send-test', handler: controller.sendTest, middlewares: [verifySuperAdminRole, validateBody(enviarPruebaSchema)] },
]

export default buildRouter(routes)

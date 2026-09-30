import * as controller from '../controllers/email-credential'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarCredencialSchema, crearCredencialSchema, enviarPruebaSchema } from '../validation'

// Credenciales de correo saliente (spec 006): Owner y Administrador del sistema (spec 013).
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/email-credentials', handler: controller.list, middlewares: [requirePermiso('correo.configurar')] },
    { method: 'post', path: '/v1/email-credentials', handler: controller.create, middlewares: [requirePermiso('correo.configurar'), validateBody(crearCredencialSchema)] },
    { method: 'put', path: '/v1/email-credentials/:id', handler: controller.update, middlewares: [requirePermiso('correo.configurar'), validateBody(actualizarCredencialSchema)] },
    { method: 'delete', path: '/v1/email-credentials/:id', handler: controller.remove, middlewares: [requirePermiso('correo.configurar')] },
    { method: 'post', path: '/v1/email-credentials/:id/test', handler: controller.test, middlewares: [requirePermiso('correo.configurar')] },
    { method: 'post', path: '/v1/email-credentials/:id/send-test', handler: controller.sendTest, middlewares: [requirePermiso('correo.configurar'), validateBody(enviarPruebaSchema)] },
]

export default buildRouter(routes)

import * as controller from '../controllers/document-lookup'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteConsultaDocumento } from '../../../middlewares/rate-limit'
import { actualizarTokenSchema, crearTokenSchema, probarTokenSchema } from '../validation'

const routes: AppRoute[] = [
    // Público (landing) y legacy
    { method: 'get', path: '/v1/public/document-lookup/dni/:numero', handler: controller.publicDni, middlewares: [limiteConsultaDocumento] },
    { method: 'get', path: '/v1/reniec/dni', handler: controller.legacyReniec, middlewares: [limiteConsultaDocumento] },

    // Administración: consulta manual y pool de tokens
    { method: 'get', path: '/v1/document-lookup/dni/:numero', handler: controller.adminDni, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/lookup-tokens', handler: controller.listTokens, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/lookup-tokens', handler: controller.createToken, middlewares: [verifyAdminRole, validateBody(crearTokenSchema)] },
    { method: 'get', path: '/v1/lookup-tokens/usage', handler: controller.usage, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/lookup-tokens/logs', handler: controller.logs, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/lookup-tokens/:id', handler: controller.updateToken, middlewares: [verifyAdminRole, validateBody(actualizarTokenSchema)] },
    { method: 'delete', path: '/v1/lookup-tokens/:id', handler: controller.removeToken, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/lookup-tokens/:id/reset', handler: controller.resetToken, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/lookup-tokens/:id/test', handler: controller.testToken, middlewares: [verifyAdminRole, validateBody(probarTokenSchema)] },
]

export default buildRouter(routes)

import * as controller from '../controllers/document-lookup'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteConsultaDocumento, limiteTokenDni, limiteTokenDniDiario } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { actualizarTokenSchema, crearTokenSchema, probarTokenSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso): consume el pool de tokens DNI
    { method: 'get', path: '/v1/site/document-lookup/dni/:numero', handler: controller.publicDni, middlewares: [requireTokenEvento, limiteConsultaDocumento, limiteTokenDni, limiteTokenDniDiario] },

    // Administración: consulta manual y pool de tokens (Owner y Administrador del sistema)
    { method: 'get', path: '/v1/document-lookup/dni/:numero', handler: controller.adminDni, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'get', path: '/v1/lookup-tokens', handler: controller.listTokens, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'post', path: '/v1/lookup-tokens', handler: controller.createToken, middlewares: [requirePermiso('consultas_dni.gestionar'), validateBody(crearTokenSchema)] },
    { method: 'get', path: '/v1/lookup-tokens/usage', handler: controller.usage, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'get', path: '/v1/lookup-tokens/logs', handler: controller.logs, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'put', path: '/v1/lookup-tokens/:id', handler: controller.updateToken, middlewares: [requirePermiso('consultas_dni.gestionar'), validateBody(actualizarTokenSchema)] },
    { method: 'delete', path: '/v1/lookup-tokens/:id', handler: controller.removeToken, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'post', path: '/v1/lookup-tokens/:id/reset', handler: controller.resetToken, middlewares: [requirePermiso('consultas_dni.gestionar')] },
    { method: 'post', path: '/v1/lookup-tokens/:id/test', handler: controller.testToken, middlewares: [requirePermiso('consultas_dni.gestionar'), validateBody(probarTokenSchema)] },
]

export default buildRouter(routes)

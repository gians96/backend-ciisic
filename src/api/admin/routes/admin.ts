import * as adminController from '../controllers/admin'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireSesion, verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLogin } from '../../../middlewares/rate-limit'
import { createAdminSchema, loginSchema, updateAdminSchema } from '../validation'

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/admin', handler: adminController.list, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/admin', handler: adminController.create, middlewares: [verifySuperAdminRole, validateBody(createAdminSchema)] },
    { method: 'get', path: '/v1/admin/:id', handler: adminController.find, middlewares: [verifySuperAdminRole] },
    { method: 'put', path: '/v1/admin/:id', handler: adminController.update, middlewares: [verifySuperAdminRole, validateBody(updateAdminSchema)] },
    { method: 'delete', path: '/v1/admin/:id', handler: adminController.remove, middlewares: [verifySuperAdminRole] },
    { method: 'post', path: '/v1/auth/login', handler: adminController.login, middlewares: [limiteLogin, validateBody(loginSchema)] },
    { method: 'get', path: '/v1/auth/session', handler: adminController.session, middlewares: [requireSesion] },
]

export default buildRouter(routes)

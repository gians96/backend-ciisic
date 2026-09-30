import * as adminController from '../controllers/admin'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requireActor, requirePermiso, requireSesion } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLogin, limiteRenovacionSesion } from '../../../middlewares/rate-limit'
import { createAdminSchema, loginSchema, updateAdminSchema } from '../validation'

// Equipo y administradores: el Owner gestiona todas las cuentas y el Administrador del sistema solo
// las de Tesorero y Comisión (el servicio aplica la delegación)
const gestionarEquipo = requirePermiso('administradores.gestionar')

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/admin', handler: adminController.list, middlewares: [gestionarEquipo] },
    { method: 'post', path: '/v1/admin', handler: adminController.create, middlewares: [gestionarEquipo, validateBody(createAdminSchema)] },
    { method: 'get', path: '/v1/admin/:id', handler: adminController.find, middlewares: [gestionarEquipo] },
    { method: 'put', path: '/v1/admin/:id', handler: adminController.update, middlewares: [gestionarEquipo, validateBody(updateAdminSchema)] },
    { method: 'delete', path: '/v1/admin/:id', handler: adminController.remove, middlewares: [gestionarEquipo] },
    { method: 'post', path: '/v1/auth/login', handler: adminController.login, middlewares: [limiteLogin, validateBody(loginSchema)] },
    { method: 'get', path: '/v1/auth/session', handler: adminController.session, middlewares: [requireSesion] },
    // Renovación de la sesión del staff (spec 013): cualquier cuenta activa, con límite por cuenta
    { method: 'post', path: '/v1/auth/refresh', handler: adminController.refresh, middlewares: [requireActor, limiteRenovacionSesion] },
]

export default buildRouter(routes)

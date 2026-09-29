import * as controller from '../controllers/registration-type'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica } from '../../../middlewares/rate-limit'
import { actualizarCategoriaSchema, actualizarTipoSchema, crearCategoriaSchema, crearTipoSchema } from '../validation'

const routes: AppRoute[] = [
    // Público (landing)
    { method: 'get', path: '/v1/public/events/:codigo/registration-types', handler: controller.publicList, middlewares: [limiteLecturaPublica] },

    // Legacy: landing actual (evento principal)
    { method: 'get', path: '/v1/registration-types', handler: controller.legacyList, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/registration-types/:id', handler: controller.legacyFind, middlewares: [limiteLecturaPublica] },

    // Administración
    { method: 'get', path: '/v1/events/:eventId/registration-categories', handler: controller.listCategories, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/events/:eventId/registration-categories', handler: controller.createCategory, middlewares: [verifyAdminRole, validateBody(crearCategoriaSchema)] },
    { method: 'put', path: '/v1/registration-categories/:id', handler: controller.updateCategory, middlewares: [verifyAdminRole, validateBody(actualizarCategoriaSchema)] },
    { method: 'delete', path: '/v1/registration-categories/:id', handler: controller.removeCategory, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/registration-categories/:id/types', handler: controller.createType, middlewares: [verifyAdminRole, validateBody(crearTipoSchema)] },
    { method: 'put', path: '/v1/registration-types/:id', handler: controller.updateType, middlewares: [verifyAdminRole, validateBody(actualizarTipoSchema)] },
    { method: 'delete', path: '/v1/registration-types/:id', handler: controller.removeType, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

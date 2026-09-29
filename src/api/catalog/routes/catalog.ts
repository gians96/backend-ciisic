import * as controller from '../controllers/catalog'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole, verifySuperAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica } from '../../../middlewares/rate-limit'
import { namedSchema, namedUpdateSchema } from '../../sharedValidation'

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/classification', handler: controller.listClassifications, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/classification/:id', handler: controller.findClassification, middlewares: [limiteLecturaPublica] },
    { method: 'post', path: '/v1/classification', handler: controller.createClassification, middlewares: [verifyAdminRole, validateBody(namedSchema)] },
    { method: 'put', path: '/v1/classification/:id', handler: controller.updateClassification, middlewares: [verifyAdminRole, validateBody(namedUpdateSchema)] },
    { method: 'delete', path: '/v1/classification/:id', handler: controller.removeClassification, middlewares: [verifyAdminRole] },

    { method: 'get', path: '/v1/document-type', handler: controller.listDocumentTypes, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/inscription-state', handler: controller.listInscriptionStates, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/roles', handler: controller.listRoles, middlewares: [verifySuperAdminRole] },

    // Legacy (landing anterior)
    { method: 'get', path: '/v1/deposit-method', handler: controller.emptyList, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/payment-type', handler: controller.emptyList, middlewares: [limiteLecturaPublica] },
]

export default buildRouter(routes)

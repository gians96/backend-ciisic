import * as controller from '../controllers/catalog'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { namedSchema, namedUpdateSchema } from '../../sharedValidation'

const configurarCatalogos = requirePermiso('catalogos.configurar')

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'get', path: '/v1/site/catalogs', handler: controller.siteCatalogs, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },

    { method: 'get', path: '/v1/classification', handler: controller.listClassifications, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/classification/:id', handler: controller.findClassification, middlewares: [limiteLecturaPublica] },
    { method: 'post', path: '/v1/classification', handler: controller.createClassification, middlewares: [configurarCatalogos, validateBody(namedSchema)] },
    { method: 'put', path: '/v1/classification/:id', handler: controller.updateClassification, middlewares: [configurarCatalogos, validateBody(namedUpdateSchema)] },
    { method: 'delete', path: '/v1/classification/:id', handler: controller.removeClassification, middlewares: [configurarCatalogos] },

    { method: 'get', path: '/v1/document-type', handler: controller.listDocumentTypes, middlewares: [limiteLecturaPublica] },
    { method: 'get', path: '/v1/inscription-state', handler: controller.listInscriptionStates, middlewares: [limiteLecturaPublica] },
    // Roles que el actor puede asignar, con sus permisos (formulario del equipo)
    { method: 'get', path: '/v1/roles', handler: controller.listRoles, middlewares: [requirePermiso('administradores.gestionar')] },

    // Legacy (landing anterior)
    { method: 'get', path: '/v1/deposit-method', handler: controller.emptyList, middlewares: [rutaLegacy, limiteLecturaPublica] },
    { method: 'get', path: '/v1/payment-type', handler: controller.emptyList, middlewares: [rutaLegacy, limiteLecturaPublica] },
]

export default buildRouter(routes)

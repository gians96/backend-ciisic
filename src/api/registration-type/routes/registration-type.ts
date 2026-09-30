import * as controller from '../controllers/registration-type'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteLecturaPublica, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { actualizarCategoriaSchema, actualizarTipoSchema, crearCategoriaSchema, crearTipoSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'get', path: '/v1/site/registration-types', handler: controller.publicList, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },

    // Legacy: landing anterior (evento principal)
    { method: 'get', path: '/v1/registration-types', handler: controller.legacyList, middlewares: [rutaLegacy, limiteLecturaPublica] },
    { method: 'get', path: '/v1/registration-types/:id', handler: controller.legacyFind, middlewares: [rutaLegacy, limiteLecturaPublica] },

    // Administración. La lista también la usa la pantalla de inscripciones (filtro por tipo): sin
    // «pagos.ver» los precios van en null.
    {
        method: 'get',
        path: '/v1/events/:eventId/registration-categories',
        handler: controller.listCategories,
        middlewares: [requirePermiso(['eventos.configurar', 'inscripciones.ver'], { evento: eventoDelParametro('eventId') })],
    },
    { method: 'post', path: '/v1/events/:eventId/registration-categories', handler: controller.createCategory, middlewares: [requirePermiso('eventos.configurar'), validateBody(crearCategoriaSchema)] },
    { method: 'put', path: '/v1/registration-categories/:id', handler: controller.updateCategory, middlewares: [requirePermiso('eventos.configurar'), validateBody(actualizarCategoriaSchema)] },
    { method: 'delete', path: '/v1/registration-categories/:id', handler: controller.removeCategory, middlewares: [requirePermiso('eventos.configurar')] },
    { method: 'post', path: '/v1/registration-categories/:id/types', handler: controller.createType, middlewares: [requirePermiso('eventos.configurar'), validateBody(crearTipoSchema)] },
    { method: 'put', path: '/v1/registration-types/:id', handler: controller.updateType, middlewares: [requirePermiso('eventos.configurar'), validateBody(actualizarTipoSchema)] },
    { method: 'delete', path: '/v1/registration-types/:id', handler: controller.removeType, middlewares: [requirePermiso('eventos.configurar')] },
]

export default buildRouter(routes)

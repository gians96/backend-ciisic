import * as controller from '../controllers/delegation'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion, limiteLecturaPublica, limiteTokenInscripcion, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { upload, validateUploadedFileContent } from '../../../middlewares/upload'
import { eventoDeDelegacion, eventoDelParametro } from '../../../core/resolutores-evento'
import { crearDelegacionSchema, inscribirEnDelegacionSchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (spec 018): el evento sale del token de acceso y la delegación se crea con
    // la tarifa del evento. El pago es conjunto: un solo voucher para todo el grupo.
    { method: 'get', path: '/v1/site/delegations/tarifa', handler: controller.publicTarifa, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    { method: 'get', path: '/v1/site/delegations/link/:codigoLink', handler: controller.publicFind, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    {
        method: 'post',
        path: '/v1/site/delegations',
        handler: controller.publicCreate,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, upload.single('voucher'), validateUploadedFileContent],
    },

    // Administración: la gestión es configuración del evento (cuentas globales)
    { method: 'get', path: '/v1/events/:eventId/delegations', handler: controller.list, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDelParametro('eventId') })] },
    { method: 'post', path: '/v1/events/:eventId/delegations', handler: controller.create, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDelParametro('eventId') }), validateBody(crearDelegacionSchema)] },
    { method: 'get', path: '/v1/delegations/:id', handler: controller.find, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion })] },
    { method: 'get', path: '/v1/delegations/:id/voucher', handler: controller.voucher, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion })] },
    {
        method: 'post',
        path: '/v1/delegations/:id/inscriptions',
        handler: controller.bulkInscriptions,
        middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion }), validateBody(inscribirEnDelegacionSchema)],
    },
]

export default buildRouter(routes)

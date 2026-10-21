import * as controller from '../controllers/delegation'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion, limiteLecturaPublica, limiteTokenInscripcion, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { MAX_VOUCHERS_POR_ENVIO, uploadVarios, validateUploadedFilesContent } from '../../../middlewares/upload'
import { eventoDeDelegacion, eventoDelParametro } from '../../../core/resolutores-evento'
import { crearDelegacionSchema, editarDelegacionSchema, inscribirEnDelegacionSchema } from '../validation'

/** Hasta `MAX_VOUCHERS_POR_ENVIO` vouchers en el campo `vouchers`, con la firma de cada archivo comprobada. */
const vouchers = [uploadVarios.array('vouchers', MAX_VOUCHERS_POR_ENVIO), validateUploadedFilesContent]

const routes: AppRoute[] = [
    // API del sitio (specs 021 y 023): el evento sale del token de acceso. La delegación se crea con
    // la tarifa de su modalidad y paga con uno o varios vouchers; con su link el delegado solo agrega
    // (integrantes y vouchers), nunca borra ni cambia lo ya enviado.
    { method: 'get', path: '/v1/site/delegations/tarifa', handler: controller.publicTarifa, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    { method: 'get', path: '/v1/site/delegations/link/:codigoLink', handler: controller.publicFind, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    {
        method: 'post',
        path: '/v1/site/delegations',
        handler: controller.publicCreate,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, ...vouchers],
    },
    {
        method: 'post',
        path: '/v1/site/delegations/link/:codigoLink/participants',
        handler: controller.publicAddParticipants,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, validateBody(inscribirEnDelegacionSchema)],
    },
    {
        method: 'post',
        path: '/v1/site/delegations/link/:codigoLink/payments',
        handler: controller.publicAddPayments,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, ...vouchers],
    },

    // Administración: la gestión es configuración del evento (cuentas globales); revisar pagos y
    // aprobar al grupo también lo hace quien valida inscripciones (Tesorero y Comisión de sus eventos)
    { method: 'get', path: '/v1/events/:eventId/delegations', handler: controller.list, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDelParametro('eventId') })] },
    { method: 'post', path: '/v1/events/:eventId/delegations', handler: controller.create, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDelParametro('eventId') }), validateBody(crearDelegacionSchema)] },
    { method: 'get', path: '/v1/delegations/:id', handler: controller.find, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion })] },
    { method: 'put', path: '/v1/delegations/:id', handler: controller.update, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion }), validateBody(editarDelegacionSchema)] },
    {
        method: 'post',
        path: '/v1/delegations/:id/inscriptions',
        handler: controller.bulkInscriptions,
        middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion }), validateBody(inscribirEnDelegacionSchema)],
    },
    { method: 'delete', path: '/v1/delegations/:id/inscriptions/:inscriptionId', handler: controller.removeInscription, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion })] },
    { method: 'post', path: '/v1/delegations/:id/approve', handler: controller.approve, middlewares: [requirePermiso(['eventos.configurar', 'inscripciones.validar'], { evento: eventoDeDelegacion })] },
    { method: 'post', path: '/v1/delegations/:id/payments', handler: controller.addPayments, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion }), ...vouchers] },
    { method: 'patch', path: '/v1/delegations/:id/payments/:paymentId', handler: controller.paymentState, middlewares: [requirePermiso(['eventos.configurar', 'inscripciones.validar'], { evento: eventoDeDelegacion })] },
    { method: 'delete', path: '/v1/delegations/:id/payments/:paymentId', handler: controller.removePayment, middlewares: [requirePermiso('eventos.configurar', { evento: eventoDeDelegacion })] },
    // El voucher también lo ve quien revisa pagos
    { method: 'get', path: '/v1/delegations/:id/payments/:paymentId/voucher', handler: controller.paymentVoucher, middlewares: [requirePermiso(['eventos.configurar', 'pagos.ver'], { evento: eventoDeDelegacion })] },
]

export default buildRouter(routes)

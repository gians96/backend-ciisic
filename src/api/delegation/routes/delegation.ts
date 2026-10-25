import * as controller from '../controllers/delegation'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion, limiteLecturaPublica, limiteTokenInscripcion, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { MAX_VOUCHERS_POR_ENVIO, uploadVarios, validateUploadedFilesContent } from '../../../middlewares/upload'
import { eventoDeDelegacion, eventoDelParametro } from '../../../core/resolutores-evento'
import {
    cambiarPlanSchema, configDelegacionSchema, crearDelegacionSchema, editarDelegacionSchema, inscribirEnDelegacionSchema, inscribirseSchema, regenerarLinkSchema,
} from '../validation'

/** Hasta `MAX_VOUCHERS_POR_ENVIO` vouchers en el campo `vouchers`, con la firma de cada archivo comprobada. */
const vouchers = [uploadVarios.array('vouchers', MAX_VOUCHERS_POR_ENVIO), validateUploadedFilesContent]

const delEvento = { evento: eventoDelParametro('eventId') }
const delDelegacion = { evento: eventoDeDelegacion }

const routes: AppRoute[] = [
    // API del sitio (specs 021, 023 y 029): el evento sale del token de acceso. Las delegaciones las crea el staff;
    // con su link el delegado solo agrega (integrantes con su plan y vouchers) y, con el link individual, cada
    // integrante se inscribe solo. Nunca se borra ni se cambia lo ya enviado.
    { method: 'get', path: '/v1/site/delegations/link/:codigoLink', handler: controller.publicFind, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
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
    { method: 'get', path: '/v1/site/delegations/join/:codigoInscripcion', handler: controller.publicJoinFind, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    {
        method: 'post',
        path: '/v1/site/delegations/join/:codigoInscripcion/participants',
        handler: controller.publicJoin,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, validateBody(inscribirseSchema)],
    },

    // Administración (spec 029). Ver: Tesorero y la Comisión elegida; inscribir (integrantes, datos del grupo, vouchers):
    // la Comisión elegida; gestionar (planes, precios, dominio, links): solo Owner y Administrador. Validar vouchers y
    // aprobar al grupo es de quien valida inscripciones (Tesorero), que también puede borrar un voucher no verificado.
    // Los tres son por evento salvo `gestionar` (global).
    { method: 'get', path: '/v1/events/:eventId/delegations', handler: controller.list, middlewares: [requirePermiso('delegaciones.ver', delEvento)] },
    {
        method: 'post',
        path: '/v1/events/:eventId/delegations',
        handler: controller.create,
        middlewares: [requirePermiso(['delegaciones.gestionar', 'delegaciones.inscribir'], delEvento), validateBody(crearDelegacionSchema)],
    },
    { method: 'get', path: '/v1/delegations/:id', handler: controller.find, middlewares: [requirePermiso('delegaciones.ver', delDelegacion)] },
    { method: 'put', path: '/v1/delegations/:id', handler: controller.update, middlewares: [requirePermiso('delegaciones.inscribir', delDelegacion), validateBody(editarDelegacionSchema)] },
    { method: 'put', path: '/v1/delegations/:id/config', handler: controller.config, middlewares: [requirePermiso('delegaciones.gestionar', delDelegacion), validateBody(configDelegacionSchema)] },
    {
        method: 'post',
        path: '/v1/delegations/:id/links/regenerate',
        handler: controller.regenerateLink,
        middlewares: [requirePermiso('delegaciones.gestionar', delDelegacion), validateBody(regenerarLinkSchema)],
    },
    {
        method: 'post',
        path: '/v1/delegations/:id/inscriptions',
        handler: controller.bulkInscriptions,
        middlewares: [requirePermiso('delegaciones.inscribir', delDelegacion), validateBody(inscribirEnDelegacionSchema)],
    },
    {
        method: 'patch',
        path: '/v1/delegations/:id/inscriptions/:inscriptionId',
        handler: controller.changePlan,
        middlewares: [requirePermiso('delegaciones.inscribir', delDelegacion), validateBody(cambiarPlanSchema)],
    },
    { method: 'delete', path: '/v1/delegations/:id/inscriptions/:inscriptionId', handler: controller.removeInscription, middlewares: [requirePermiso('delegaciones.inscribir', delDelegacion)] },
    { method: 'post', path: '/v1/delegations/:id/approve', handler: controller.approve, middlewares: [requirePermiso('inscripciones.validar', delDelegacion)] },
    { method: 'post', path: '/v1/delegations/:id/payments', handler: controller.addPayments, middlewares: [requirePermiso('delegaciones.inscribir', delDelegacion), ...vouchers] },
    { method: 'patch', path: '/v1/delegations/:id/payments/:paymentId', handler: controller.paymentState, middlewares: [requirePermiso('inscripciones.validar', delDelegacion)] },
    // Borrar un voucher (el servicio rechaza los verificados) lo hace quien configura o quien revisa los pagos (Tesorero)
    {
        method: 'delete',
        path: '/v1/delegations/:id/payments/:paymentId',
        handler: controller.removePayment,
        middlewares: [requirePermiso(['delegaciones.gestionar', 'inscripciones.validar'], delDelegacion)],
    },
    // El voucher lo ve quien revisa pagos
    { method: 'get', path: '/v1/delegations/:id/payments/:paymentId/voucher', handler: controller.paymentVoucher, middlewares: [requirePermiso('pagos.ver', delDelegacion)] },
]

export default buildRouter(routes)

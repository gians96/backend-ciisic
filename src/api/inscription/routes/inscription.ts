import * as controller from '../controllers/inscription'
import { AppRoute, buildRouter } from '../../../core/routes'
import { upload, validateUploadedFileContent } from '../../../middlewares/upload'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { limiteInscripcion, limiteReenvioCredencial, limiteTokenInscripcion } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { eventoDeInscripcion, eventoDelParametro } from '../../../core/resolutores-evento'
import { cambiarEstadoLegacySchema } from '../validation'

const routes: AppRoute[] = [
    // API del sitio (landing del evento, con su token de acceso). El token se valida antes de
    // recibir el archivo.
    {
        method: 'post',
        path: '/v1/site/inscriptions',
        handler: controller.publicCreate,
        middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, upload.single('voucher'), validateUploadedFileContent],
    },

    // Legacy (landing anterior y herramientas previas; evento principal)
    { method: 'post', path: '/v1/inscription', handler: controller.legacyCreate, middlewares: [rutaLegacy, limiteInscripcion, upload.single('file'), validateUploadedFileContent] },
    { method: 'get', path: '/v1/inscription', handler: controller.legacyList, middlewares: [rutaLegacy, requirePermiso('legacy.usar')] },
    { method: 'get', path: '/v1/inscription/:id', handler: controller.legacyFind, middlewares: [rutaLegacy, requirePermiso('legacy.usar')] },
    { method: 'put', path: '/v1/inscription/:id/status', handler: controller.legacyUpdateStatus, middlewares: [rutaLegacy, requirePermiso('legacy.usar'), validateBody(cambiarEstadoLegacySchema)] },
    { method: 'delete', path: '/v1/inscription/:id', handler: controller.remove, middlewares: [rutaLegacy, requirePermiso('inscripciones.eliminar')] },

    // Administración. Las cuentas por evento (Tesorero, Comisión) solo acceden a las inscripciones
    // de sus eventos; los montos y datos de pago dependen de «pagos.ver» (ver el controlador).
    { method: 'get', path: '/v1/events/:eventId/inscriptions', handler: controller.list, middlewares: [requirePermiso('inscripciones.ver', { evento: eventoDelParametro('eventId') })] },
    { method: 'get', path: '/v1/events/:eventId/inscriptions/export', handler: controller.exportCsv, middlewares: [requirePermiso('inscripciones.exportar', { evento: eventoDelParametro('eventId') })] },
    { method: 'get', path: '/v1/inscriptions/:id', handler: controller.find, middlewares: [requirePermiso('inscripciones.ver', { evento: eventoDeInscripcion })] },
    { method: 'patch', path: '/v1/inscriptions/:id/status', handler: controller.updateStatus, middlewares: [requirePermiso('inscripciones.validar', { evento: eventoDeInscripcion })] },
    {
        method: 'post',
        path: '/v1/inscriptions/:id/resend-credential',
        handler: controller.resendCredential,
        middlewares: [requirePermiso('credenciales.reenviar', { evento: eventoDeInscripcion }), limiteReenvioCredencial],
    },
    { method: 'get', path: '/v1/inscriptions/:id/voucher', handler: controller.voucher, middlewares: [requirePermiso('pagos.ver', { evento: eventoDeInscripcion })] },
    { method: 'get', path: '/v1/inscriptions/:id/credential', handler: controller.credential, middlewares: [requirePermiso('inscripciones.ver', { evento: eventoDeInscripcion })] },
    { method: 'delete', path: '/v1/inscriptions/:id', handler: controller.remove, middlewares: [requirePermiso('inscripciones.eliminar')] },
]

export default buildRouter(routes)

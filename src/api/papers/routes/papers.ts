import { buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limitePonencias, limiteTokenPonencias } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { rutaLegacy } from '../../../middlewares/legacy'
import { eventoDelParametro, eventoDePonencia } from '../../../core/resolutores-evento'
import { paperUpload } from '../upload'
import * as controller from '../controllers/papers'

export default buildRouter([
    // API del sitio (landing del evento, con su token de acceso)
    { method: 'post', path: '/v1/site/papers', middlewares: [requireTokenEvento, limitePonencias, limiteTokenPonencias, paperUpload.single('file')], handler: controller.publicCreate },
    // Legacy (evento principal)
    { method: 'post', path: '/v1/papers', middlewares: [rutaLegacy, limitePonencias, paperUpload.single('file')], handler: controller.create },
    { method: 'get', path: '/v1/papers', middlewares: [rutaLegacy, requirePermiso('legacy.usar')], handler: controller.list },
    // Administración (las cuentas por evento, solo las ponencias de sus eventos)
    { method: 'get', path: '/v1/events/:eventId/papers', middlewares: [requirePermiso('ponencias.ver', { evento: eventoDelParametro('eventId') })], handler: controller.listByEvent },
    { method: 'get', path: '/v1/papers/:id/file', middlewares: [requirePermiso('ponencias.ver', { evento: eventoDePonencia })], handler: controller.download },
])

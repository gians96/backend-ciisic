import * as controller from '../controllers/payment-qr'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { limiteLecturaPublica, limiteTokenLectura } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { qrUpload } from '../upload'

const routes: AppRoute[] = [
    // API del sitio: solo los QR que usa el evento del token
    { method: 'get', path: '/v1/site/payment-qr/:archivo', handler: controller.siteFile, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },

    // Administración (panel → Eventos → Datos de pago)
    { method: 'post', path: '/v1/payment-qr', handler: controller.upload, middlewares: [verifyAdminRole, qrUpload.single('file')] },
    { method: 'get', path: '/v1/payment-qr/:archivo', handler: controller.adminFile, middlewares: [verifyAdminRole] },
]

export default buildRouter(routes)

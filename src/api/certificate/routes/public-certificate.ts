import * as controller from '../controllers/public-certificate'
import { AppRoute, buildRouter } from '../../../core/routes'
import { limiteVerificacionCertificado } from '../../../middlewares/rate-limit'

/**
 * Familia pública `/v1/public/*` (spec 015; enmienda de los principios III y IV de la constitución):
 * sin sesión ni token, siempre con límite por IP y un tope global de fallos (códigos que no existen,
 * en el servicio: quien verifica un código real nunca queda cortado). Solo lectura y solo datos que el
 * titular ya muestra en su certificado impreso.
 */
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/public/certificates/:codigo', handler: controller.verify, middlewares: [limiteVerificacionCertificado] },
]

export default buildRouter(routes)

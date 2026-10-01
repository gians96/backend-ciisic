import * as controller from '../controllers/certificate-signed'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limiteCargaFirmados } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { eventoDeCertificado, eventoDelParametro } from '../../../core/resolutores-evento'
import { MAX_ARCHIVOS_CARGA_FIRMADOS, MAX_BYTES_CARGA_FIRMADOS } from '../../../core/almacenamiento'
import { firmadosUpload, firmadoUpload, limiteContenido, MAX_BYTES_REEMPLAZO_FIRMADO, turnoCargaFirmados } from '../upload-firmados'
import { anularCertificadoSchema, cargaFirmadosSchema, reemplazarFirmadoSchema } from '../validation/firmados'

/**
 * Firmados y anulación de certificados (spec 015).
 * Orden: guarda → límite por cuenta → `Content-Length` → turno (2 cargas a la vez en el proceso) →
 * archivo (en memoria) → campos.
 * - Subir firmados (tandas o uno): `certificados.operar` en el evento; reemplazar un FIRMADO o forzar
 *   uno que no coincide lo decide el servicio y exige `certificados.gestionar`.
 * - Quitar un firmado y anular: `certificados.gestionar` (global).
 */
const routes: AppRoute[] = [
    {
        method: 'post',
        path: '/v1/events/:eventId/certificates/signed',
        handler: controller.uploadSigned,
        middlewares: [
            requirePermiso('certificados.operar', { evento: eventoDelParametro('eventId') }),
            limiteCargaFirmados,
            limiteContenido(MAX_BYTES_CARGA_FIRMADOS),
            turnoCargaFirmados,
            firmadosUpload.array('files', MAX_ARCHIVOS_CARGA_FIRMADOS),
            validateBody(cargaFirmadosSchema),
        ],
    },
    {
        method: 'put',
        path: '/v1/certificates/:id/signed',
        handler: controller.replaceSigned,
        middlewares: [
            requirePermiso('certificados.operar', { evento: eventoDeCertificado }),
            limiteCargaFirmados,
            limiteContenido(MAX_BYTES_REEMPLAZO_FIRMADO),
            turnoCargaFirmados,
            firmadoUpload.single('file'),
            validateBody(reemplazarFirmadoSchema),
        ],
    },
    { method: 'delete', path: '/v1/certificates/:id/signed', handler: controller.removeSigned, middlewares: [requirePermiso('certificados.gestionar')] },
    { method: 'post', path: '/v1/certificates/:id/annul', handler: controller.annul, middlewares: [requirePermiso('certificados.gestionar'), validateBody(anularCertificadoSchema)] },
]

export default buildRouter(routes)

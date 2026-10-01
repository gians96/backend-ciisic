import * as controller from '../controllers/certificate'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { eventoDeCertificado, eventoDelParametro } from '../../../core/resolutores-evento'
import {
    desdeInscripcionesSchema,
    editarCertificadoSchema,
    emitirCertificadoSchema,
    generarCertificadosSchema,
    importarCertificadosSchema,
    limiteFilasImportacion,
} from '../validation/certificados'

/**
 * Emisión, generación y descargas de certificados (spec 015).
 * - Ver (listado, detalle, firmado): `certificados.ver` en el evento.
 * - Generar y descargar para firmar (individual o ZIP): `certificados.operar` en el evento; descargar
 *   para firmar exige además el proveedor del código confirmado (409 `PROVIDER_NOT_CONFIRMED`).
 * - Emitir, editar y borrar: `certificados.gestionar` (global: Owner y Administrador).
 */
const delEvento = eventoDelParametro('eventId')
const gestionar = requirePermiso('certificados.gestionar')

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/certificates', handler: controller.list, middlewares: [requirePermiso('certificados.ver', { evento: delEvento })] },
    { method: 'get', path: '/v1/events/:eventId/certificates/zip', handler: controller.zip, middlewares: [requirePermiso('certificados.operar', { evento: delEvento })] },
    { method: 'post', path: '/v1/events/:eventId/certificates', handler: controller.create, middlewares: [gestionar, validateBody(emitirCertificadoSchema)] },
    { method: 'post', path: '/v1/events/:eventId/certificates/from-inscriptions', handler: controller.fromInscriptions, middlewares: [gestionar, validateBody(desdeInscripcionesSchema)] },
    { method: 'post', path: '/v1/events/:eventId/certificates/import', handler: controller.importList, middlewares: [gestionar, limiteFilasImportacion, validateBody(importarCertificadosSchema)] },
    { method: 'post', path: '/v1/events/:eventId/certificates/generate', handler: controller.generate, middlewares: [requirePermiso('certificados.operar', { evento: delEvento }), validateBody(generarCertificadosSchema)] },

    { method: 'get', path: '/v1/certificates/:id', handler: controller.find, middlewares: [requirePermiso('certificados.ver', { evento: eventoDeCertificado })] },
    { method: 'put', path: '/v1/certificates/:id', handler: controller.update, middlewares: [gestionar, validateBody(editarCertificadoSchema)] },
    { method: 'delete', path: '/v1/certificates/:id', handler: controller.remove, middlewares: [gestionar] },
    // generado: además `certificados.operar` (lo comprueba el servicio); firmado: basta ver
    { method: 'get', path: '/v1/certificates/:id/file', handler: controller.file, middlewares: [requirePermiso('certificados.ver', { evento: eventoDeCertificado })] },
]

export default buildRouter(routes)

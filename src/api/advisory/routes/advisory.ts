import * as controller from '../controllers/advisory'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limiteCargaPadron, limiteDescargaReportes, limiteLecturaReportes } from '../../../middlewares/rate-limit'
import { uploadExcel } from '../../../middlewares/upload'
import { eventoDelParametro } from '../../../core/resolutores-evento'

const evento = { evento: eventoDelParametro('eventId') }

// Seguimiento de estudiantes por asesor (spec 025). Las cuentas por evento (Tesorero, Comisión) solo
// acceden a sus eventos; los montos dependen de «pagos.ver» (ver el controlador). La carga del padrón
// es de las cuentas globales.
const routes: AppRoute[] = [
    { method: 'get', path: '/v1/events/:eventId/advisory/summary', handler: controller.summary, middlewares: [requirePermiso('reportes.ver', evento), limiteLecturaReportes] },
    { method: 'get', path: '/v1/events/:eventId/advisory/students', handler: controller.students, middlewares: [requirePermiso('reportes.ver', evento), limiteLecturaReportes] },
    { method: 'get', path: '/v1/events/:eventId/advisory/export', handler: controller.exportFile, middlewares: [requirePermiso('reportes.exportar', evento), limiteDescargaReportes] },
    {
        method: 'post',
        path: '/v1/events/:eventId/advisory/import',
        handler: controller.importPadron,
        middlewares: [requirePermiso('reportes.gestionar'), limiteCargaPadron, uploadExcel.single('file')],
    },
]

export default buildRouter(routes)

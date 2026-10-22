import * as controller from '../controllers/advisory'
import * as enlaces from '../controllers/enlaces'
import * as enlacesCiclo from '../controllers/enlaces-ciclo'
import * as publico from '../controllers/publico'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import {
    limiteCargaPadron, limiteDescargaDocente, limiteDescargaReportes, limiteEnlacesAsesores, limiteLecturaReportes, limiteVistaDocente,
} from '../../../middlewares/rate-limit'
import { uploadExcel } from '../../../middlewares/upload'
import { validateBody } from '../../../middlewares/validate'
import { eventoDelParametro } from '../../../core/resolutores-evento'
import { crearEnlacesCicloSchema, crearEnlacesSchema } from '../validation'

const evento = { evento: eventoDelParametro('eventId') }

// Seguimiento de estudiantes por asesor (spec 025). Las cuentas por evento (Tesorero, Comisión) solo
// acceden a sus eventos; los montos dependen de «pagos.ver» (ver el controlador). La carga del padrón y los
// enlaces de los docentes (spec 026) son de las cuentas globales.
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

    // Enlaces públicos por docente (spec 026): administración. El enlace es una credencial, así que verlo, crearlo,
    // renovarlo y desactivarlo es de quien gestiona el padrón.
    { method: 'get', path: '/v1/events/:eventId/advisory/links', handler: enlaces.listLinks, middlewares: [requirePermiso('reportes.gestionar'), limiteLecturaReportes] },
    { method: 'post', path: '/v1/events/:eventId/advisory/links', handler: enlaces.createLinks, middlewares: [requirePermiso('reportes.gestionar'), limiteEnlacesAsesores, validateBody(crearEnlacesSchema)] },
    { method: 'delete', path: '/v1/events/:eventId/advisory/links/:asesorId', handler: enlaces.revokeLink, middlewares: [requirePermiso('reportes.gestionar'), limiteEnlacesAsesores] },

    // Enlaces públicos por ciclo (spec 027): la misma administración, para el ciclo completo
    { method: 'get', path: '/v1/events/:eventId/advisory/cycle-links', handler: enlacesCiclo.listCycleLinks, middlewares: [requirePermiso('reportes.gestionar'), limiteLecturaReportes] },
    { method: 'post', path: '/v1/events/:eventId/advisory/cycle-links', handler: enlacesCiclo.createCycleLinks, middlewares: [requirePermiso('reportes.gestionar'), limiteEnlacesAsesores, validateBody(crearEnlacesCicloSchema)] },
    { method: 'delete', path: '/v1/events/:eventId/advisory/cycle-links/:ciclo', handler: enlacesCiclo.revokeCycleLink, middlewares: [requirePermiso('reportes.gestionar'), limiteEnlacesAsesores] },

    // Vista pública del docente (spec 026): sin sesión, con el token del enlace en `X-Link-Token`
    { method: 'get', path: '/v1/public/advisor', handler: publico.view, middlewares: [limiteVistaDocente] },
    { method: 'get', path: '/v1/public/advisor/export', handler: publico.exportFile, middlewares: [limiteDescargaDocente] },

    // Vista pública del ciclo (spec 027): igual, con el token del enlace del ciclo
    { method: 'get', path: '/v1/public/cycle', handler: publico.cycleView, middlewares: [limiteVistaDocente] },
    { method: 'get', path: '/v1/public/cycle/export', handler: publico.cycleExportFile, middlewares: [limiteDescargaDocente] },
]

export default buildRouter(routes)

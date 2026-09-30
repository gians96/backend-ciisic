import * as controller from '../controllers/activity'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limiteMarcarAsistencia } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { eventoDeActividad, eventoDeAsistencia, eventoDelParametro } from '../../../core/resolutores-evento'
import { actualizarActividadSchema, asistenciaLegacySchema, crearActividadSchema, exportLegacySchema, registrarAsistenciaSchema } from '../validation'
import { rutaLegacy } from '../../../middlewares/legacy'

const configurar = requirePermiso('eventos.configurar')
const legacy = requirePermiso('legacy.usar')

const routes: AppRoute[] = [
    // Actividades del evento (quien marca asistencia necesita verlas para elegir una)
    { method: 'get', path: '/v1/events/:eventId/activities', handler: controller.list, middlewares: [requirePermiso(['asistencia.ver', 'eventos.configurar'], { evento: eventoDelParametro('eventId') })] },
    { method: 'post', path: '/v1/events/:eventId/activities', handler: controller.create, middlewares: [configurar, validateBody(crearActividadSchema)] },
    { method: 'put', path: '/v1/activities/:id', handler: controller.update, middlewares: [configurar, validateBody(actualizarActividadSchema)] },
    { method: 'delete', path: '/v1/activities/:id', handler: controller.remove, middlewares: [configurar] },

    // Asistencia (cuentas por evento: solo en sus eventos)
    { method: 'get', path: '/v1/activities/:id/attendances', handler: controller.listAttendances, middlewares: [requirePermiso('asistencia.ver', { evento: eventoDeActividad })] },
    { method: 'post', path: '/v1/activities/:id/attendances', handler: controller.createAttendance, middlewares: [requirePermiso('asistencia.marcar', { evento: eventoDeActividad }), limiteMarcarAsistencia, validateBody(registrarAsistenciaSchema)] },
    { method: 'delete', path: '/v1/attendances/:id', handler: controller.removeAttendance, middlewares: [requirePermiso('asistencia.anular', { evento: eventoDeAsistencia })] },
    { method: 'get', path: '/v1/events/:eventId/attendances/export', handler: controller.exportAttendance, middlewares: [requirePermiso('asistencia.exportar', { evento: eventoDelParametro('eventId') })] },

    // Legacy (id_evento = actividad, id_usuario = participante)
    { method: 'post', path: '/v1/attendances/export', handler: controller.legacyExport, middlewares: [rutaLegacy, legacy, validateBody(exportLegacySchema)] },
    { method: 'post', path: '/v1/attendances/overtime', handler: controller.legacyOvertime, middlewares: [rutaLegacy, legacy, validateBody(asistenciaLegacySchema)] },
    { method: 'post', path: '/v1/attendances', handler: controller.legacyCreate, middlewares: [rutaLegacy, legacy, validateBody(asistenciaLegacySchema)] },
    { method: 'get', path: '/v1/attendances/:id', handler: controller.legacyFind, middlewares: [rutaLegacy, legacy] },
]

export default buildRouter(routes)

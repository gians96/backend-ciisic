import * as controller from '../controllers/activity'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'
import { actualizarActividadSchema, asistenciaLegacySchema, crearActividadSchema, exportLegacySchema, registrarAsistenciaSchema } from '../validation'
import { rutaLegacy } from '../../../middlewares/legacy'

const routes: AppRoute[] = [
    // Actividades del evento
    { method: 'get', path: '/v1/events/:eventId/activities', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/events/:eventId/activities', handler: controller.create, middlewares: [verifyAdminRole, validateBody(crearActividadSchema)] },
    { method: 'put', path: '/v1/activities/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarActividadSchema)] },
    { method: 'delete', path: '/v1/activities/:id', handler: controller.remove, middlewares: [verifyAdminRole] },

    // Asistencia
    { method: 'get', path: '/v1/activities/:id/attendances', handler: controller.listAttendances, middlewares: [verifyAdminRole] },
    { method: 'post', path: '/v1/activities/:id/attendances', handler: controller.createAttendance, middlewares: [verifyAdminRole, validateBody(registrarAsistenciaSchema)] },
    { method: 'delete', path: '/v1/attendances/:id', handler: controller.removeAttendance, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/events/:eventId/attendances/export', handler: controller.exportAttendance, middlewares: [verifyAdminRole] },

    // Legacy (id_evento = actividad, id_usuario = participante)
    { method: 'post', path: '/v1/attendances/export', handler: controller.legacyExport, middlewares: [rutaLegacy, verifyAdminRole, validateBody(exportLegacySchema)] },
    { method: 'post', path: '/v1/attendances/overtime', handler: controller.legacyOvertime, middlewares: [rutaLegacy, verifyAdminRole, validateBody(asistenciaLegacySchema)] },
    { method: 'post', path: '/v1/attendances', handler: controller.legacyCreate, middlewares: [rutaLegacy, verifyAdminRole, validateBody(asistenciaLegacySchema)] },
    { method: 'get', path: '/v1/attendances/:id', handler: controller.legacyFind, middlewares: [rutaLegacy, verifyAdminRole] },
]

export default buildRouter(routes)

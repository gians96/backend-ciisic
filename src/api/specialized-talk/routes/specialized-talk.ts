import * as controller from '../controllers/specialized-talk'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { limiteAvisosPonencias, limiteCheckInPonencia, limiteDescargaResumenPonencias, limiteInscripcion, limiteLecturaPublica, limiteTokenInscripcion, limiteTokenLectura, limiteTokenVerificacionCongresista, limiteVerificacionCongresista } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { eventoDeInscripcionPonencia, eventoDelParametro, eventoDePonenciaEspecializada } from '../../../core/resolutores-evento'
import { accesoPonenciasSchema, actualizarPonenciaSchema, avisarSinCongresoSchema, cancelarSinCongresoSchema, crearPonenciaSchema, editarInscripcionSchema, elegibilidadSchema, inscripcionSitioSchema, personaSchema } from '../validation'

const gestionar = requirePermiso('especializadas.gestionar')

const routes: AppRoute[] = [
    // Ponencias del evento (quien ve inscritos necesita verlas para elegir una)
    { method: 'get', path: '/v1/events/:eventId/specialized-talks', handler: controller.list, middlewares: [requirePermiso(['especializadas.ver', 'especializadas.gestionar'], { evento: eventoDelParametro('eventId') })] },
    { method: 'post', path: '/v1/events/:eventId/specialized-talks', handler: controller.create, middlewares: [gestionar, validateBody(crearPonenciaSchema)] },
    { method: 'put', path: '/v1/specialized-talks/:id', handler: controller.update, middlewares: [gestionar, validateBody(actualizarPonenciaSchema)] },
    { method: 'delete', path: '/v1/specialized-talks/:id', handler: controller.remove, middlewares: [gestionar] },

    // Acceso libre del evento (spec 030): quien ve el programa lo consulta; solo quien lo gestiona lo cambia
    { method: 'get', path: '/v1/events/:eventId/specialized-talks/access', handler: controller.getAccess, middlewares: [requirePermiso(['especializadas.ver', 'especializadas.gestionar'], { evento: eventoDelParametro('eventId') })] },
    { method: 'put', path: '/v1/events/:eventId/specialized-talks/access', handler: controller.putAccess, middlewares: [gestionar, validateBody(accesoPonenciasSchema)] },

    // Resumen por persona (spec 031): una fila por persona con su situación actual en el congreso; cancelar y avisar a quien no puede estar inscrito
    { method: 'get', path: '/v1/events/:eventId/specialized-talk-attendees', handler: controller.attendees, middlewares: [requirePermiso('especializadas.ver', { evento: eventoDelParametro('eventId') })] },
    { method: 'get', path: '/v1/events/:eventId/specialized-talk-attendees/export', handler: controller.attendeesExport, middlewares: [requirePermiso('especializadas.ver', { evento: eventoDelParametro('eventId') }), limiteDescargaResumenPonencias] },
    { method: 'post', path: '/v1/events/:eventId/specialized-talk-attendees/cancel', handler: controller.cancelAttendees, middlewares: [requirePermiso('especializadas.inscribir', { evento: eventoDelParametro('eventId') }), limiteAvisosPonencias, validateBody(cancelarSinCongresoSchema)] },
    { method: 'post', path: '/v1/events/:eventId/specialized-talk-attendees/notify', handler: controller.notifyAttendees, middlewares: [requirePermiso('especializadas.inscribir', { evento: eventoDelParametro('eventId') }), limiteAvisosPonencias, validateBody(avisarSinCongresoSchema)] },

    // Inscripciones (cuentas por evento: solo en sus eventos)
    { method: 'get', path: '/v1/events/:eventId/specialized-talk-registrations', handler: controller.listRegistrations, middlewares: [requirePermiso('especializadas.ver', { evento: eventoDelParametro('eventId') })] },
    { method: 'post', path: '/v1/specialized-talks/:id/registrations', handler: controller.register, middlewares: [requirePermiso('especializadas.inscribir', { evento: eventoDePonenciaEspecializada }), validateBody(personaSchema)] },
    { method: 'patch', path: '/v1/specialized-talk-registrations/:id', handler: controller.updateRegistration, middlewares: [requirePermiso('especializadas.inscribir', { evento: eventoDeInscripcionPonencia }), validateBody(editarInscripcionSchema)] },

    // Asistencia en puerta
    { method: 'post', path: '/v1/specialized-talks/:id/check-in', handler: controller.checkIn, middlewares: [requirePermiso('especializadas.asistencia', { evento: eventoDePonenciaEspecializada }), limiteCheckInPonencia, validateBody(personaSchema)] },
    { method: 'delete', path: '/v1/specialized-talk-registrations/:id/attendance', handler: controller.removeAttendance, middlewares: [requirePermiso('especializadas.asistencia', { evento: eventoDeInscripcionPonencia })] },

    // API del sitio (el evento sale del token)
    { method: 'get', path: '/v1/site/specialized-talks', handler: controller.publicList, middlewares: [requireTokenEvento, limiteLecturaPublica, limiteTokenLectura] },
    { method: 'post', path: '/v1/site/specialized-talk-eligibility', handler: controller.eligibility, middlewares: [requireTokenEvento, limiteVerificacionCongresista, limiteTokenVerificacionCongresista, validateBody(elegibilidadSchema)] },
    { method: 'post', path: '/v1/site/specialized-talk-registrations', handler: controller.publicRegister, middlewares: [requireTokenEvento, limiteInscripcion, limiteTokenInscripcion, validateBody(inscripcionSitioSchema)] },
]

export default buildRouter(routes)

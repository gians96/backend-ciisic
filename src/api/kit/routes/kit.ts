import * as controller from '../controllers/kit'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limiteMarcarAsistencia } from '../../../middlewares/rate-limit'
import { eventoDeInscripcion, eventoDelParametro } from '../../../core/resolutores-evento'

/**
 * Entrega del kit (spec 037). Entregar y deshacer lo hace quien marca asistencia (`asistencia.marcar`): así funciona con
 * las cuentas de la puerta tal como están; ver cuántos kits van, `asistencia.ver`. Cuentas por evento: solo en sus eventos.
 */
const routes: AppRoute[] = [
    { method: 'put', path: '/v1/inscriptions/:id/kit', handler: controller.deliver, middlewares: [requirePermiso('asistencia.marcar', { evento: eventoDeInscripcion }), limiteMarcarAsistencia] },
    { method: 'delete', path: '/v1/inscriptions/:id/kit', handler: controller.undo, middlewares: [requirePermiso('asistencia.marcar', { evento: eventoDeInscripcion }), limiteMarcarAsistencia] },
    { method: 'get', path: '/v1/events/:eventId/kits/summary', handler: controller.summary, middlewares: [requirePermiso('asistencia.ver', { evento: eventoDelParametro('eventId') })] },
]

export default buildRouter(routes)

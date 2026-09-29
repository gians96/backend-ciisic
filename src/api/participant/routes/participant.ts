import * as yup from 'yup'
import * as controller from '../controllers/participant'
import { AppRoute, buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { validateBody } from '../../../middlewares/validate'

const actualizarParticipanteSchema = yup.object({
    nombres: yup.string().trim().min(2).max(120),
    apellidos: yup.string().trim().min(2).max(120),
    correo: yup.string().trim().lowercase().email().max(191),
    celular: yup.string().trim().matches(/^\+?\d{9,15}$/, 'Celular inválido'),
    desvincularGoogle: yup.boolean(),
}).required()

const routes: AppRoute[] = [
    { method: 'get', path: '/v1/participants', handler: controller.list, middlewares: [verifyAdminRole] },
    { method: 'get', path: '/v1/participants/:id', handler: controller.find, middlewares: [verifyAdminRole] },
    { method: 'put', path: '/v1/participants/:id', handler: controller.update, middlewares: [verifyAdminRole, validateBody(actualizarParticipanteSchema)] },
]

export default buildRouter(routes)

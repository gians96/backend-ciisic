import * as controller from '../controllers/student-verification'
import { AppRoute, buildRouter } from '../../../core/routes'
import { validateBody } from '../../../middlewares/validate'
import { limiteVerificacion } from '../../../middlewares/rate-limit'
import { requireTokenEvento } from '../../../middlewares/sitio'
import { verificarEstudianteSchema } from '../validation'

const routes: AppRoute[] = [
    {
        method: 'post',
        path: '/v1/site/student-verification',
        handler: controller.publicVerify,
        middlewares: [requireTokenEvento, limiteVerificacion, validateBody(verificarEstudianteSchema)],
    },
]

export default buildRouter(routes)

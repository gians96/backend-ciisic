import * as controller from '../controllers/student-verification'
import { AppRoute, buildRouter } from '../../../core/routes'
import { validateBody } from '../../../middlewares/validate'
import { limiteVerificacion } from '../../../middlewares/rate-limit'
import { verificarEstudianteSchema } from '../validation'

const routes: AppRoute[] = [
    {
        method: 'post',
        path: '/v1/public/events/:codigo/student-verification',
        handler: controller.publicVerify,
        middlewares: [limiteVerificacion, validateBody(verificarEstudianteSchema)],
    },
]

export default buildRouter(routes)

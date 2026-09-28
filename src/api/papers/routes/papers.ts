import rateLimit from 'express-rate-limit'
import { buildRouter } from '../../../core/routes'
import { verifyAdminRole } from '../../../middlewares/auth'
import { paperUpload } from '../upload'
import * as controller from '../controllers/papers'

const submissionLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'PAPER_RATE_LIMIT', message: 'Demasiados intentos. Intenta nuevamente en 15 minutos.' },
})

export default buildRouter([
  { method: 'post', path: '/v1/papers', middlewares: [submissionLimit, paperUpload.single('file')], handler: controller.create },
  { method: 'get', path: '/v1/papers', middlewares: [verifyAdminRole], handler: controller.list },
  { method: 'get', path: '/v1/papers/:id/file', middlewares: [verifyAdminRole], handler: controller.download },
])

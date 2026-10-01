import * as tipos from '../controllers/tipos'
import * as plantillas from '../controllers/plantillas'
import { AppRoute, buildRouter } from '../../../core/routes'
import { requirePermiso } from '../../../middlewares/auth'
import { limitador } from '../../../middlewares/rate-limit'
import { validateBody } from '../../../middlewares/validate'
import { plantillaUpload } from '../upload-plantilla'
import { crearTipoSchema, actualizarTipoSchema } from '../validation/tipos'
import { actualizarPlantillaSchema, crearPlantillaSchema, vistaPreviaSchema } from '../validation/plantillas'

/**
 * Tipos, fuentes y plantillas de certificado (spec 015). Todo es de `certificados.gestionar`
 * (global: Owner y Administrador), salvo leer los tipos, que también necesita quien ve u opera los
 * certificados de sus eventos (el catálogo es global y no tiene datos de nadie).
 */
const gestionar = requirePermiso('certificados.gestionar')

/** Vista previa: 30 por minuto por cuenta (cada una carga y estampa el PDF). Va tras la guarda, que deja `req.actor`. */
export const limiteVistaPrevia = limitador(60 * 1000, 30, 'Demasiadas vistas previas seguidas. Espera un minuto.', { clave: 'actor' })

const routes: AppRoute[] = [
    // Tipos de certificado (catálogo global; sin DELETE: se desactivan)
    { method: 'get', path: '/v1/certificate-types', handler: tipos.list, middlewares: [requirePermiso(['certificados.ver', 'certificados.gestionar'], { filtraPorActor: true })] },
    { method: 'post', path: '/v1/certificate-types', handler: tipos.create, middlewares: [gestionar, validateBody(crearTipoSchema)] },
    { method: 'put', path: '/v1/certificate-types/:id', handler: tipos.update, middlewares: [gestionar, validateBody(actualizarTipoSchema)] },

    // Fuentes incluidas para los campos
    { method: 'get', path: '/v1/certificate-fonts', handler: plantillas.fonts, middlewares: [gestionar] },

    // Plantillas por evento
    { method: 'get', path: '/v1/events/:eventId/certificate-templates', handler: plantillas.list, middlewares: [gestionar] },
    { method: 'post', path: '/v1/events/:eventId/certificate-templates', handler: plantillas.create, middlewares: [gestionar, plantillaUpload.single('file'), validateBody(crearPlantillaSchema)] },
    { method: 'get', path: '/v1/certificate-templates/:id', handler: plantillas.find, middlewares: [gestionar] },
    { method: 'put', path: '/v1/certificate-templates/:id', handler: plantillas.update, middlewares: [gestionar, validateBody(actualizarPlantillaSchema)] },
    { method: 'delete', path: '/v1/certificate-templates/:id', handler: plantillas.remove, middlewares: [gestionar] },
    { method: 'get', path: '/v1/certificate-templates/:id/design', handler: plantillas.design, middlewares: [gestionar] },
    { method: 'put', path: '/v1/certificate-templates/:id/design', handler: plantillas.replaceDesign, middlewares: [gestionar, plantillaUpload.single('file')] },
    { method: 'post', path: '/v1/certificate-templates/:id/preview', handler: plantillas.preview, middlewares: [gestionar, limiteVistaPrevia, validateBody(vistaPreviaSchema)] },
]

export default buildRouter(routes)

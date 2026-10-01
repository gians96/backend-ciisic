import { HttpError } from '../../../core/http-error'
import type { ProveedorCodigoCertificado } from './proveedor'

/**
 * Proveedor UNDC (certificados.undc.edu.pe): pendiente hasta tener acceso a su API. Todas las
 * operaciones responden 501 `CERTIFICATE_PROVIDER_PENDING`. Al implementarlo: credenciales con
 * `credencialesUndcCertificados()` (Sistema, solo Owner), URL validada con `validarUrlSaliente` y
 * `asegurarDestinoPublico` antes de cada llamada (core/url-saliente.ts), timeout de la configuración
 * y estado de la última prueba en `certificados_undc_ultimo_*`.
 */
export function proveedorPendiente(): HttpError {
    return new HttpError(501, 'CERTIFICATE_PROVIDER_PENDING', 'La API de certificados de la UNDC aún no está disponible: usa el proveedor local.')
}

export const proveedorUndc: ProveedorCodigoCertificado = {
    codigo: 'UNDC',
    async resolverImpresion() {
        throw proveedorPendiente()
    },
    async registrar() {
        throw proveedorPendiente()
    },
    async probarConexion() {
        throw proveedorPendiente()
    },
}

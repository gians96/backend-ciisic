import type { ProveedorCodigoCertificado } from './proveedor'
import { proveedorPendiente } from './undc'

/** Proveedor LOCAL: el código impreso es el propio código del certificado. No hay registro externo. */
export const proveedorLocal: ProveedorCodigoCertificado = {
    codigo: 'LOCAL',
    async resolverImpresion(certificado) {
        return { codigoImpreso: certificado.codigo, codigoExterno: null }
    },
    async registrar() {
        // El registro en la UNDC es el mismo pendiente, sea cual sea el proveedor del código
        throw proveedorPendiente()
    },
    async probarConexion() {
        // Nada que probar: el código se genera aquí
    },
}

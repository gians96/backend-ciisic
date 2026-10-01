import type { ProveedorCertificados } from '@prisma/client'
import { configuracionCertificados, type ConfiguracionCertificados } from '../../../core/configuracion-sistema'
import { HttpError } from '../../../core/http-error'
import { proveedorLocal } from './local'
import { proveedorUndc } from './undc'

/**
 * Adaptador del proveedor del código de los certificados (spec 015). LOCAL ahora; la API de
 * certificados.undc.edu.pe queda pendiente (`undc.ts` responde 501 `CERTIFICATE_PROVIDER_PENDING`).
 * Cuando exista: probar la conexión, registrar los firmados (`codigoExterno`) y, si la UNDC impone
 * su código, `resolverImpresion` lo devuelve para imprimirlo en lo que aún no se ha firmado.
 */
export interface CertificadoParaProveedor {
    id: number
    eventoId: number
    /** Código interno (local), fijo desde la emisión. */
    codigo: string
    codigoExterno: string | null
}

export interface ImpresionCertificado {
    /** Código que se imprime y va en la URL del QR. */
    codigoImpreso: string
    /** Código asignado por el sistema externo (UNDC), si lo hay. */
    codigoExterno: string | null
}

export interface ProveedorCodigoCertificado {
    readonly codigo: ProveedorCertificados
    /** Al generar: qué código se imprime. */
    resolverImpresion(certificado: CertificadoParaProveedor): Promise<ImpresionCertificado>
    /** Registra un certificado firmado en el sistema externo (`register-external`). */
    registrar(certificado: CertificadoParaProveedor): Promise<{ codigoExterno: string }>
    /** Prueba la conexión con el proveedor (Sistema). */
    probarConexion(): Promise<void>
}

export function proveedorPorCodigo(codigo: ProveedorCertificados): ProveedorCodigoCertificado {
    return codigo === 'UNDC' ? proveedorUndc : proveedorLocal
}

/** Proveedor configurado (`certificados_proveedor`, con la caché de 30 s de la configuración). */
export async function proveedorActivo(): Promise<ProveedorCodigoCertificado> {
    return proveedorPorCodigo((await configuracionCertificados()).proveedor)
}

/**
 * La descarga para firmar exige el proveedor confirmado (`certificados_proveedor_confirmado`): así
 * no se firma un código que después haya que cambiar por el de la UNDC. Si no: 409 `PROVIDER_NOT_CONFIRMED`.
 */
export async function exigirProveedorConfirmado(): Promise<ConfiguracionCertificados> {
    const configuracion = await configuracionCertificados()
    if (!configuracion.proveedorConfirmado) {
        throw new HttpError(409, 'PROVIDER_NOT_CONFIRMED', 'Confirma el proveedor del código de los certificados (Certificados → Configuración) antes de descargarlos para firmar.')
    }
    return configuracion
}

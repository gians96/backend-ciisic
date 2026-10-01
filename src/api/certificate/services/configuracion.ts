import type { ConfiguracionSistema, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict } from '../../../core/http-error'
import { fechaLima } from '../../../core/fechas'
import { configuracionCertificados, establecerConfiguracion, urlVerificacionCertificado } from '../../../core/configuracion-sistema'
import { proveedorPorCodigo } from '../codigos/proveedor'
import type { ActualizarConfiguracionCertificadosInput } from '../validation/configuracion'

/**
 * Configuración de certificados (spec 015) en las columnas `certificados_*` de la fila única de
 * `configuracion_sistema` (sin tabla aparte), con la misma caché de 30 s (`core/configuracion-sistema`).
 * - `certificados.gestionar`: proveedor del código, prefijo del código local y «proveedor
 *   confirmado» (sin confirmar no se descarga para firmar: 409 `PROVIDER_NOT_CONFIRMED`).
 * - Las credenciales de la API UNDC solo se ven y se editan en Sistema (`/v1/settings`, Owner).
 * - La URL de verificación no se guarda aquí: es `<url_panel>/verificar/<código>` y se congela en
 *   cada certificado al generarlo. Aquí solo se muestra (lectura).
 *
 * El código se asigna al EMITIR con el prefijo de ese momento y no cambia. El prefijo se bloquea
 * (409 `CERTIFICATE_SETTINGS_LOCKED`) en cuanto algún código quedó en un PDF (generado o firmado):
 * desde ahí los códigos del sistema ya circulan impresos. Los emitidos y aún no generados conservan
 * su prefijo si después se cambia (se informa en `certificadosConOtroPrefijo`).
 */

/** Ejemplo del formato local con el prefijo vigente (el correlativo y la parte aleatoria son fijos). */
const NUMERO_EJEMPLO = '000123'
const ALEATORIO_EJEMPLO = '7KQ2XM'

/** Certificados cuyo código ya está en un PDF: generados alguna vez (aunque luego se anularan) o con firmado. */
export const CERTIFICADOS_CON_PDF: Prisma.CertificadoWhereInput = {
    OR: [
        { generadoEn: { not: null } },
        { archivoGenerado: { not: null } },
        { archivoFirmado: { not: null } },
        { estado: { in: ['PREPARADO', 'EN_FIRMA', 'FIRMADO'] } },
    ],
}

export const PROVEEDORES = [
    { codigo: 'LOCAL', nombre: 'Código local del sistema', disponible: true },
    { codigo: 'UNDC', nombre: 'API de certificados de la UNDC (certificados.undc.edu.pe)', disponible: false },
] as const

async function leerFila(): Promise<ConfiguracionSistema> {
    // La migración crea la fila 1; el upsert la recrea si alguien la borró
    const fila = await prisma.configuracionSistema.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
    establecerConfiguracion(fila)
    return fila
}

async function conteos(prefijo: string) {
    const [generados, conOtroPrefijo] = await Promise.all([
        prisma.certificado.count({ where: CERTIFICADOS_CON_PDF }),
        prisma.certificado.count({ where: { estado: { not: 'ANULADO' }, NOT: { codigo: { startsWith: `${prefijo}-` } } } }),
    ])
    return { generados, conOtroPrefijo }
}

/** Lo que ve el panel. Usa la configuración recién guardada en la caché (`establecerConfiguracion`). */
async function aRespuesta(fila: ConfiguracionSistema) {
    const vigente = await configuracionCertificados()
    const { generados, conOtroPrefijo } = await conteos(vigente.prefijo)
    const ejemploCodigo = `${vigente.prefijo}-${fechaLima().slice(0, 4)}-${NUMERO_EJEMPLO}-${ALEATORIO_EJEMPLO}`
    return {
        proveedor: vigente.proveedor,
        prefijo: vigente.prefijo,
        proveedorConfirmado: vigente.proveedorConfirmado,
        /** `<url_panel>/verificar` (Sistema → URL del panel); `null` si falta: no se puede generar. */
        urlVerificacionBase: vigente.baseVerificacion,
        ejemploCodigo,
        ejemploUrlVerificacion: vigente.baseVerificacion ? urlVerificacionCertificado(vigente.baseVerificacion, ejemploCodigo) : null,
        prefijoBloqueado: generados > 0,
        certificadosGenerados: generados,
        /** Vigentes (no anulados) emitidos con otro prefijo: conservan su código. */
        certificadosConOtroPrefijo: conOtroPrefijo,
        proveedores: PROVEEDORES,
        undc: {
            /** Las credenciales se configuran en Sistema (solo Owner); aquí solo si están. */
            credencialesConfiguradas: Boolean(fila.certificadosUndcUrl && fila.certificadosUndcUsuario && fila.certificadosUndcSecretoCifrado),
            disponible: false,
        },
        actualizadoEn: fila.actualizadoEn,
    }
}

export type ConfiguracionCertificadosPublica = Awaited<ReturnType<typeof aRespuesta>>

export async function obtenerConfiguracionCertificados(): Promise<ConfiguracionCertificadosPublica> {
    return aRespuesta(await leerFila())
}

/**
 * Cambia proveedor, prefijo o confirmación. Cambiar el proveedor o el prefijo deja el código sin
 * confirmar, salvo que la misma solicitud lo confirme. Confirmar exige que el proveedor esté
 * disponible: LOCAL siempre; UNDC responde 501 `CERTIFICATE_PROVIDER_PENDING` mientras no haya API.
 */
export async function actualizarConfiguracionCertificados(input: ActualizarConfiguracionCertificadosInput, adminId?: number): Promise<ConfiguracionCertificadosPublica> {
    const fila = await leerFila()
    const data: Prisma.ConfiguracionSistemaUncheckedUpdateInput = {}
    const cambios: string[] = []

    if (input.prefijo !== undefined && input.prefijo !== fila.certificadosPrefijo) {
        const generados = await prisma.certificado.count({ where: CERTIFICADOS_CON_PDF })
        if (generados > 0) {
            throw conflict('CERTIFICATE_SETTINGS_LOCKED', `El prefijo ya no se puede cambiar: hay ${generados} ${generados === 1 ? 'certificado generado' : 'certificados generados'} con el prefijo ${fila.certificadosPrefijo}.`)
        }
        data.certificadosPrefijo = input.prefijo
        cambios.push('prefijo')
    }
    const proveedor = input.proveedor ?? fila.certificadosProveedor
    if (proveedor !== fila.certificadosProveedor) {
        data.certificadosProveedor = proveedor
        cambios.push('proveedor')
    }

    const confirmado = input.proveedorConfirmado ?? (cambios.length ? false : fila.certificadosProveedorConfirmado)
    // Se prueba al confirmar (o al cambiar algo dejándolo confirmado), nunca al quitar la confirmación
    if (confirmado && (!fila.certificadosProveedorConfirmado || cambios.length)) {
        await proveedorPorCodigo(proveedor).probarConexion()
    }
    if (confirmado !== fila.certificadosProveedorConfirmado) {
        data.certificadosProveedorConfirmado = confirmado
        cambios.push('proveedorConfirmado')
    }

    if (!cambios.length) return aRespuesta(fila)
    data.actualizadoPorId = adminId ?? null
    const actualizada = await prisma.configuracionSistema.update({ where: { id: 1 }, data })
    establecerConfiguracion(actualizada)
    console.log(`Configuración de certificados actualizada por el administrador ${adminId ?? '?'}: ${cambios.join(', ')}`)
    return aRespuesta(actualizada)
}

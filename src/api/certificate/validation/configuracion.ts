import * as yup from 'yup'
import { REGEX_PREFIJO } from '../codigos/codigo'

/**
 * Configuración de certificados que edita `certificados.gestionar` (spec 015): proveedor del código,
 * prefijo del código local y si el proveedor quedó confirmado. Las credenciales de la API UNDC van
 * en Sistema (`PUT /v1/settings`, solo Owner).
 */
export const PROVEEDORES_CERTIFICADOS = ['LOCAL', 'UNDC'] as const

export const actualizarConfiguracionCertificadosSchema = yup.object({
    proveedor: yup.string().oneOf([...PROVEEDORES_CERTIFICADOS], 'Proveedor desconocido: usa LOCAL o UNDC'),
    prefijo: yup.string().trim().transform((valor: unknown) => (typeof valor === 'string' ? valor.toUpperCase() : valor))
        .matches(REGEX_PREFIJO, 'El prefijo lleva de 2 a 20 letras (A-Z) o números, sin espacios ni guiones'),
    proveedorConfirmado: yup.boolean().typeError('proveedorConfirmado debe ser verdadero o falso'),
}).required()

export type ActualizarConfiguracionCertificadosInput = yup.InferType<typeof actualizarConfiguracionCertificadosSchema>

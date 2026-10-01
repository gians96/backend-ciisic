import * as yup from 'yup'
import { REGEX_CODIGO_ACCESO } from '../../core/codigos'

const correo = yup.string().trim().lowercase().email('Correo inválido').max(191).required()

export const solicitarCodigoSchema = yup.object({ correo }).required()

export const verificarCodigoSchema = yup.object({
    correo,
    // Se toleran espacios o guiones al copiar el código del correo ("123 456")
    codigo: yup.string()
        .transform((valor: unknown) => (typeof valor === 'string' ? valor.replace(/[\s-]/g, '') : valor))
        .matches(REGEX_CODIGO_ACCESO, 'El código tiene 6 dígitos')
        .required(),
}).required()

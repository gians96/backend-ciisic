import * as yup from 'yup'

const campos = {
    nombre: yup.string().trim().min(2).max(120),
    apiKey: yup.string().trim().min(10).max(500),
    remitenteCorreo: yup.string().trim().lowercase().email('Correo inválido').max(191),
    remitenteNombre: yup.string().trim().max(120).nullable(),
    esPredeterminada: yup.boolean(),
    activo: yup.boolean(),
}

export const crearCredencialSchema = yup.object({
    ...campos,
    nombre: campos.nombre.required(),
    apiKey: campos.apiKey.required(),
    remitenteCorreo: campos.remitenteCorreo.required(),
}).required()

export const actualizarCredencialSchema = yup.object(campos).required()

export const enviarPruebaSchema = yup.object({
    correo: yup.string().trim().lowercase().email('Correo inválido').max(191).required(),
}).required()

export type CrearCredencialInput = yup.InferType<typeof crearCredencialSchema>
export type ActualizarCredencialInput = yup.InferType<typeof actualizarCredencialSchema>

import * as yup from 'yup'

export const crearMensajeSchema = yup.object({
    nombres: yup.string().trim().min(2).max(80).required(),
    apellidos: yup.string().trim().min(2).max(80).required(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    asunto: yup.string().trim().min(3).max(150).required(),
    mensaje: yup.string().trim().min(10).max(2000).required(),
}).required()

/** Legacy: formulario de contacto de la landing anterior. */
export const createContactSchema = yup.object({
    firstName: yup.string().trim().min(2).max(80).required(),
    lastName: yup.string().trim().min(2).max(80).required(),
    email: yup.string().trim().lowercase().email().required(),
    subject: yup.string().trim().min(3).max(150).required(),
    message: yup.string().trim().min(10).max(2000).required(),
}).required()

export const actualizarMensajeSchema = yup.object({ leido: yup.boolean().required() }).required()

export type CrearMensajeInput = yup.InferType<typeof crearMensajeSchema>

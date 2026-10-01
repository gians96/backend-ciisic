import * as yup from 'yup'

/** Lo único que el inscrito edita (spec 014): nombres, documento y correo son su identidad y la llave de la sesión. */
export const actualizarPerfilSchema = yup.object({
    celular: yup.string().trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos').required('Ingresa tu celular'),
}).required()

export type ActualizarPerfilInput = yup.InferType<typeof actualizarPerfilSchema>

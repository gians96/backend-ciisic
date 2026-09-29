import * as yup from 'yup'

export const verificarEstudianteSchema = yup.object({
    correo: yup.string().trim().lowercase().email().max(191).required(),
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: yup.string().trim().required().when('tipoDocumento', {
        is: 'dni',
        then: (schema) => schema.matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos'),
        otherwise: (schema) => schema.matches(/^[A-Za-z0-9]{9,12}$/, 'Documento inválido'),
    }),
}).required()

export type VerificarEstudianteInput = yup.InferType<typeof verificarEstudianteSchema>

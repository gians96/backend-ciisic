import * as yup from 'yup'

export const namedSchema = yup.object({ nombre: yup.string().trim().min(2).max(120).required() }).required()
export const namedUpdateSchema = yup.object({ nombre: yup.string().trim().min(2).max(120) }).required()

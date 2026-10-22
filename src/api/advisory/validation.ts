import * as yup from 'yup'

/** Crear (o renovar) los enlaces públicos de los docentes: de los indicados o, sin lista, de todos (spec 026). */
export const crearEnlacesSchema = yup.object({
    asesorIds: yup.array().of(yup.number().integer().positive().required()).min(1, 'Indica al menos un asesor').max(200),
    regenerar: yup.boolean(),
}).default({})

export type CrearEnlacesInput = yup.InferType<typeof crearEnlacesSchema>

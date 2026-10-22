import * as yup from 'yup'

/** Crear (o renovar) los enlaces públicos de los docentes: de los indicados o, sin lista, de todos (spec 026). */
export const crearEnlacesSchema = yup.object({
    asesorIds: yup.array().of(yup.number().integer().positive().required()).min(1, 'Indica al menos un asesor').max(200),
    regenerar: yup.boolean(),
}).default({})

export type CrearEnlacesInput = yup.InferType<typeof crearEnlacesSchema>

/** Crear (o renovar) los enlaces públicos de los ciclos: de los indicados o, sin lista, de todos los del padrón (spec 027). */
export const crearEnlacesCicloSchema = yup.object({
    ciclos: yup.array().of(yup.string().trim().min(1).max(10).required()).min(1, 'Indica al menos un ciclo').max(30),
    regenerar: yup.boolean(),
}).default({})

export type CrearEnlacesCicloInput = yup.InferType<typeof crearEnlacesCicloSchema>

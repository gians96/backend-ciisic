import * as yup from 'yup'
import { normalizarDni } from './services/seguimiento'

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

const seccionSchema = yup.object({
    ciclo: yup.string().trim().min(1).max(10).required(),
    seccion: yup.string().trim().min(1).max(10).required(),
})

/** Crear o editar un docente (spec 028): nombre, DNI opcional (8 dígitos) y las secciones que atiende. */
export const docenteSchema = yup.object({
    nombre: yup.string().trim().min(3, 'Escribe el nombre del docente').max(200, 'Máximo 200 caracteres').required('Escribe el nombre del docente'),
    documento: yup.string().trim().max(20).nullable().test('dni', 'El DNI debe tener 8 dígitos', (valor) => !valor || normalizarDni(valor) !== null),
    secciones: yup.array().of(seccionSchema.required()).max(100).default([]),
})

export type DocenteInput = yup.InferType<typeof docenteSchema>

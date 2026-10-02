import * as yup from 'yup'
import { DISPONIBILIDADES_TIPO, type DisponibilidadTipo } from '../../core/catalogos'

const caracteristicasSchema = yup.array().of(yup.object({
    icon: yup.string().trim().max(80).required(),
    text: yup.string().trim().max(200).required(),
})).max(20).nullable()

const CODIGO_CATEGORIA = /^[A-Z0-9_]+$/
const CODIGO_TIPO = /^[a-z0-9_]+$/

const camposCategoria = {
    codigo: yup.string().trim().uppercase().matches(CODIGO_CATEGORIA, 'Use mayúsculas, números y guion bajo').max(40),
    nombre: yup.string().trim().min(2).max(120),
    descripcion: yup.string().trim().max(191).nullable(),
    caracteristicas: caracteristicasSchema,
    precioDesde: yup.number().min(0).max(99999999).nullable(),
    esEstudiantil: yup.boolean(),
    orden: yup.number().integer().min(0).max(1000),
}

export const crearCategoriaSchema = yup.object({
    ...camposCategoria,
    codigo: camposCategoria.codigo.required(),
    nombre: camposCategoria.nombre.required(),
}).required()

export const actualizarCategoriaSchema = yup.object(camposCategoria).required()

const camposTipo = {
    codigo: yup.string().trim().lowercase().matches(CODIGO_TIPO, 'Use minúsculas, números y guion bajo').max(80),
    nombre: yup.string().trim().min(2).max(120),
    etiqueta: yup.string().trim().max(40).nullable(),
    descripcion: yup.string().trim().max(1000).nullable(),
    caracteristicas: caracteristicasSchema,
    precio: yup.number().min(0).max(99999999),
    precioInstitucional: yup.number().min(0).max(99999999),
    // Spec 016: a quién se ofrece (sin enviar: TODOS al crear, se conserva al actualizar)
    disponiblePara: yup.mixed<DisponibilidadTipo>().oneOf([...DISPONIBILIDADES_TIPO], 'Elige a quién se ofrece: TODOS, INSTITUCIONAL o EXTERNOS'),
    activo: yup.boolean(),
    orden: yup.number().integer().min(0).max(1000),
}

function precioInstitucionalValido(value: { precio?: number, precioInstitucional?: number }) {
    if (value.precio === undefined || value.precioInstitucional === undefined) return true
    return value.precioInstitucional <= value.precio
}

export const crearTipoSchema = yup.object({
    ...camposTipo,
    codigo: camposTipo.codigo.required(),
    nombre: camposTipo.nombre.required(),
    precio: camposTipo.precio.required(),
    precioInstitucional: camposTipo.precioInstitucional.required(),
}).test('precios', 'El precio institucional no puede ser mayor que el precio regular', precioInstitucionalValido).required()

export const actualizarTipoSchema = yup.object(camposTipo)
    .test('precios', 'El precio institucional no puede ser mayor que el precio regular', precioInstitucionalValido)
    .required()

export type CrearCategoriaInput = yup.InferType<typeof crearCategoriaSchema>
export type ActualizarCategoriaInput = yup.InferType<typeof actualizarCategoriaSchema>
export type CrearTipoInput = yup.InferType<typeof crearTipoSchema>
export type ActualizarTipoInput = yup.InferType<typeof actualizarTipoSchema>

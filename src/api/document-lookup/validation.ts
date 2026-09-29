import * as yup from 'yup'

const PROVEEDORES = ['DECOLECTA', 'APIPERU'] as const
const PERIODOS = ['DIARIO', 'MENSUAL', 'ANUAL', 'NINGUNO'] as const

const campos = {
    proveedor: yup.string().oneOf(PROVEEDORES),
    nombre: yup.string().trim().min(2).max(100),
    token: yup.string().trim().min(8).max(2000),
    limiteConsultas: yup.number().integer().min(1).max(100000000).nullable(),
    consultasUsadas: yup.number().integer().min(0).max(100000000),
    periodoRenovacion: yup.string().oneOf(PERIODOS),
    fechaRenovacion: yup.date().nullable(),
    prioridad: yup.number().integer().min(0).max(10000),
    activo: yup.boolean(),
}

export const crearTokenSchema = yup.object({
    ...campos,
    proveedor: campos.proveedor.required(),
    nombre: campos.nombre.required(),
    token: campos.token.required(),
}).required()

export const actualizarTokenSchema = yup.object(campos).required()

export const probarTokenSchema = yup.object({
    numero: yup.string().trim().matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos').required(),
}).required()

export type CrearTokenInput = yup.InferType<typeof crearTokenSchema>
export type ActualizarTokenInput = yup.InferType<typeof actualizarTokenSchema>

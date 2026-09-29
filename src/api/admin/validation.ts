import * as yup from 'yup'
import { ROLES } from '../../core/catalogos'

/** Acepta `correo` o el campo anterior `correoElectronico` (landing actual). */
export const loginSchema = yup.object({
    correo: yup.string().trim().lowercase().email(),
    correoElectronico: yup.string().trim().lowercase().email(),
    contrasena: yup.string().max(200).required(),
}).test('correo', 'El correo es obligatorio', (value) => Boolean(value?.correo || value?.correoElectronico)).required()

const campos = {
    nombres: yup.string().trim().min(2).max(100),
    apellidos: yup.string().trim().min(2).max(100),
    correo: yup.string().trim().lowercase().email().max(191),
    contrasena: yup.string().min(12).max(128),
    rolCodigo: yup.string().oneOf([...ROLES]),
    activo: yup.boolean(),
}

export const createAdminSchema = yup.object({
    ...campos,
    nombres: campos.nombres.required(),
    apellidos: campos.apellidos.required(),
    correo: campos.correo.required(),
    contrasena: campos.contrasena.required(),
}).required()

// Sin valores por defecto: una actualización parcial nunca cambia el rol implícitamente
export const updateAdminSchema = yup.object(campos).required()

export type CreateAdminInput = yup.InferType<typeof createAdminSchema>
export type UpdateAdminInput = yup.InferType<typeof updateAdminSchema>

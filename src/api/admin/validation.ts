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
    // Spec 013: eventos asignados (Tesorero, Comisión) y permisos elegidos (Comisión). Si se envían,
    // reemplazan el conjunto completo; en los roles globales se ignoran.
    eventoIds: yup.array(yup.number().integer().positive().required()).max(50),
    permisos: yup.array(yup.string().trim().max(60).required()).max(30),
}

// La contraseña es opcional: sin ella el administrador entra solo con Google. El rol es
// obligatorio: con la delegación no hay un rol por defecto.
export const createAdminSchema = yup.object({
    ...campos,
    nombres: campos.nombres.required(),
    apellidos: campos.apellidos.required(),
    correo: campos.correo.required(),
    rolCodigo: campos.rolCodigo.required(),
}).required()

// Sin valores por defecto: una actualización parcial nunca cambia el rol implícitamente
export const updateAdminSchema = yup.object({
    ...campos,
    desvincularGoogle: yup.boolean(),
    // Deja la cuenta solo con Google
    quitarContrasena: yup.boolean().test('sin-contrasena-nueva', 'No envíes una contraseña nueva si la quitas.', function (quitar) {
        return !(quitar && this.parent.contrasena)
    }),
}).required()

export type CreateAdminInput = yup.InferType<typeof createAdminSchema>
export type UpdateAdminInput = yup.InferType<typeof updateAdminSchema>

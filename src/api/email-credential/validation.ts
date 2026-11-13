import * as yup from 'yup'

export const PROVEEDORES_DE_CORREO = ['BREVO', 'GMAIL_SMTP'] as const

const campos = {
    nombre: yup.string().trim().min(2).max(120),
    apiKey: yup.string().trim().min(10).max(500),
    remitenteCorreo: yup.string().trim().lowercase().email('Correo inválido').max(191),
    remitenteNombre: yup.string().trim().max(120).nullable(),
    esPredeterminada: yup.boolean(),
    activo: yup.boolean(),
    /** Solo Gmail: 465 (SSL) o 587 (STARTTLS). */
    smtpPuerto: yup.number().oneOf([465, 587], 'El puerto debe ser 465 o 587').nullable(),
}

export const crearCredencialSchema = yup.object({
    ...campos,
    // Gmail: `apiKey` es la contraseña de aplicación; su forma (16 letras) se comprueba al guardar, según el proveedor
    proveedor: yup.string().oneOf([...PROVEEDORES_DE_CORREO], 'Proveedor no válido').default('BREVO'),
    nombre: campos.nombre.required(),
    apiKey: campos.apiKey.required(),
    remitenteCorreo: campos.remitenteCorreo.required(),
}).required()

export const actualizarCredencialSchema = yup.object(campos).required()

/** Todas las credenciales, de la primera (predeterminada) a la última: el orden en que se prueban (spec 041). */
export const ordenarCredencialesSchema = yup.object({
    ids: yup.array().of(yup.number().integer().min(1).required()).min(1).max(50).required(),
}).required()

export const enviarPruebaSchema = yup.object({
    correo: yup.string().trim().lowercase().email('Correo inválido').max(191).required(),
}).required()

export type CrearCredencialInput = yup.InferType<typeof crearCredencialSchema>
export type OrdenarCredencialesInput = yup.InferType<typeof ordenarCredencialesSchema>
export type ActualizarCredencialInput = yup.InferType<typeof actualizarCredencialSchema>

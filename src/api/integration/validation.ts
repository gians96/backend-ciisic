import * as yup from 'yup'

const campos = {
    tipo: yup.string().oneOf(['DEPORTES_FI']),
    nombre: yup.string().trim().min(2).max(120),
    // El formato y el protocolo los valida `validarUrlBase` (anti-SSRF); yup rechazaría localhost
    urlBase: yup.string().trim().max(255),
    token: yup.string().trim().min(8).max(2000),
    activo: yup.boolean(),
}

export const crearIntegracionSchema = yup.object({
    ...campos,
    tipo: campos.tipo.default('DEPORTES_FI'),
    nombre: campos.nombre.required(),
    urlBase: campos.urlBase.required(),
    token: campos.token.required(),
}).required()

export const actualizarIntegracionSchema = yup.object(campos).required()

export type CrearIntegracionInput = yup.InferType<typeof crearIntegracionSchema>
export type ActualizarIntegracionInput = yup.InferType<typeof actualizarIntegracionSchema>

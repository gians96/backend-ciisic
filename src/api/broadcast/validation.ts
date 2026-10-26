import * as yup from 'yup'

/** Personas que se atienden en un envío: pocas por petición (el panel parte el total en tandas). */
export const MAXIMO_POR_ENVIO = 100

const inscripcionIds = () => yup.array().of(yup.number().integer().positive().required()).min(1).max(MAXIMO_POR_ENVIO).required()
    .test('unicos', 'No repitas inscripciones', (ids) => !ids || new Set(ids).size === ids.length)

const asunto = () => yup.string().trim().min(3).max(150)
const mensaje = () => yup.string().trim().min(10).max(3000)

/** Enlace de la credencial 3D: cada persona recibe el suyo; sin `reenviar`, a quien ya lo recibió se le omite. */
export const enviarEnlacesCredencialSchema = yup.object({
    ids: inscripcionIds(),
    reenviar: yup.boolean().default(false),
}).required()

/** Enlace de inscripción a las ponencias: un mismo mensaje para todas las personas elegidas. */
export const enviarInvitacionPonenciasSchema = yup.object({
    ids: inscripcionIds(),
    reenviar: yup.boolean().default(false),
    asunto: asunto().required(),
    mensaje: mensaje().required(),
}).required()

/** Correo de prueba del mensaje: no marca a nadie. */
export const probarInvitacionPonenciasSchema = yup.object({
    correo: yup.string().trim().lowercase().email().max(191).required(),
    asunto: asunto().required(),
    mensaje: mensaje().required(),
}).required()

export type EnviarEnlacesCredencialInput = yup.InferType<typeof enviarEnlacesCredencialSchema>
export type EnviarInvitacionPonenciasInput = yup.InferType<typeof enviarInvitacionPonenciasSchema>
export type ProbarInvitacionPonenciasInput = yup.InferType<typeof probarInvitacionPonenciasSchema>

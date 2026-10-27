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

/** Mayor largo que admite un enlace de acceso (un enlace de Zoom con clave o de YouTube cabe de sobra). */
export const MAXIMO_ENLACE_ACCESO = 500

/**
 * Enlace de acceso a la transmisión: `https`, con servidor, sin usuario ni contraseña y sin espacios. Solo se
 * pone en el botón del correo (el servidor no lo abre), así que no se consulta la red; lo que importa es que
 * no pueda ser otro esquema (`javascript:`, `data:`) ni un enlace con credenciales.
 */
export function esEnlaceDeAcceso(valor: string | undefined): boolean {
    if (!valor || valor.length > MAXIMO_ENLACE_ACCESO || /\s/.test(valor)) return false
    try {
        const url = new URL(valor)
        return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password
    } catch {
        return false
    }
}

const enlaceAcceso = () => yup.string().trim().max(MAXIMO_ENLACE_ACCESO).required()
    .test('enlace-https', 'Escribe un enlace completo que empiece con https://', esEnlaceDeAcceso)

/** Enlace de acceso para los inscritos virtuales: un mismo mensaje y un mismo enlace para todas las personas elegidas. */
export const enviarAccesoVirtualSchema = yup.object({
    ids: inscripcionIds(),
    reenviar: yup.boolean().default(false),
    asunto: asunto().required(),
    mensaje: mensaje().required(),
    enlace: enlaceAcceso(),
}).required()

/** Correo de prueba del acceso virtual: no marca a nadie. */
export const probarAccesoVirtualSchema = yup.object({
    correo: yup.string().trim().lowercase().email().max(191).required(),
    asunto: asunto().required(),
    mensaje: mensaje().required(),
    enlace: enlaceAcceso(),
}).required()

export type EnviarEnlacesCredencialInput =yup.InferType<typeof enviarEnlacesCredencialSchema>
export type EnviarInvitacionPonenciasInput = yup.InferType<typeof enviarInvitacionPonenciasSchema>
export type ProbarInvitacionPonenciasInput = yup.InferType<typeof probarInvitacionPonenciasSchema>
export type EnviarAccesoVirtualInput = yup.InferType<typeof enviarAccesoVirtualSchema>
export type ProbarAccesoVirtualInput = yup.InferType<typeof probarAccesoVirtualSchema>

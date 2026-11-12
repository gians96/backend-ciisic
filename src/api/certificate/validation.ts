import * as yup from 'yup'

/** Certificados por petición de envío: el panel parte el total en tandas. */
export const MAXIMO_POR_ENVIO = 100

export const enviarCertificadosSchema = yup.object({
    ids: yup.array().of(yup.number().integer().positive().required()).min(1).max(MAXIMO_POR_ENVIO).required()
        .test('unicos', 'No repitas certificados', (ids) => !ids || new Set(ids).size === ids.length),
    reenviar: yup.boolean().default(false),
}).required()

export type EnviarCertificadosInput = yup.InferType<typeof enviarCertificadosSchema>

export const probarEnvioSchema = yup.object({
    correo: yup.string().trim().lowercase().email().max(191).required(),
}).required()

export const anularCertificadoSchema = yup.object({
    motivo: yup.string().trim().min(5).max(500).required(),
}).required()

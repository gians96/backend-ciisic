import * as yup from 'yup'

export const FORMATO_CLIENT_ID_GOOGLE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/

/** Actualización parcial; la API key es de solo escritura (omitir = conservar, `null` = quitar). */
export const actualizarConfiguracionSchema = yup.object({
    undcApiUrl: yup.string().trim().max(255).nullable(),
    undcApiKey: yup.string().trim().min(10).max(500).nullable(),
    undcApiTimeoutMs: yup.number().integer().min(1000).max(30000),
    googleClientId: yup.string().trim().max(255).matches(FORMATO_CLIENT_ID_GOOGLE, {
        message: 'El client ID de Google tiene el formato <número>-<texto>.apps.googleusercontent.com',
        excludeEmptyString: true,
    }).nullable(),
    urlPanel: yup.string().trim().max(255).nullable(),
    rutasLegacyActivas: yup.boolean(),
    // API de certificados de la UNDC (spec 015, pendiente): el secreto es de solo escritura como la API key
    certificadosUndcUrl: yup.string().trim().max(255).nullable(),
    certificadosUndcUsuario: yup.string().trim().max(191).nullable(),
    certificadosUndcSecreto: yup.string().trim().min(4).max(500).nullable(),
    certificadosUndcTimeoutMs: yup.number().integer().min(1000).max(30000),
}).required()

export type ActualizarConfiguracionInput = yup.InferType<typeof actualizarConfiguracionSchema>

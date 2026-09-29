import * as yup from 'yup'

const idToken = yup.string().trim().max(4096).matches(/^[\w-]+\.[\w-]+\.[\w-]+$/, 'Token de Google inválido').required()

export const loginGoogleSchema = yup.object({
    idToken,
    nonce: yup.string().trim().min(16).max(128).required(),
}).required()

export const verificacionGoogleSchema = yup.object({ idToken }).required()

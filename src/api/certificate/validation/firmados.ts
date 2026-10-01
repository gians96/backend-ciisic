import * as yup from 'yup'

/**
 * Firmados y anulación de certificados (spec 015). Los campos de los multipart llegan como texto:
 * `yup.boolean()` acepta `true`/`false`/`1`/`0`.
 */
const booleano = (campo: string) => yup.boolean().typeError(`${campo} debe ser verdadero o falso`).default(false)
const motivo = () => yup.string().trim().min(5, 'El motivo tiene al menos 5 caracteres').max(500, 'El motivo tiene como máximo 500 caracteres')

/** Carga por tandas (`POST /v1/events/:eventId/certificates/signed`). */
export const cargaFirmadosSchema = yup.object({
    // Un certificado ya FIRMADO solo se reemplaza si se pide (y con un archivo con todas sus firmas)
    reemplazar: booleano('reemplazar'),
}).required()

export type CargaFirmadosInput = yup.InferType<typeof cargaFirmadosSchema>

/**
 * Reemplazo individual (`PUT /v1/certificates/:id/signed`). `forzar` acepta un firmado que no
 * coincide con el generado: solo `certificados.gestionar` y con motivo (queda en el certificado).
 */
export const reemplazarFirmadoSchema = yup.object({
    reemplazar: booleano('reemplazar'),
    forzar: booleano('forzar'),
    motivo: motivo().when('forzar', {
        is: true,
        then: (s) => s.required('Indica el motivo para aceptar un firmado que no coincide con el generado'),
        otherwise: (s) => s.strip(),
    }),
}).required()

export type ReemplazarFirmadoInput = yup.InferType<typeof reemplazarFirmadoSchema>

/** Anulación (`POST /v1/certificates/:id/annul`): el motivo es obligatorio y no se publica. */
export const anularCertificadoSchema = yup.object({
    motivo: motivo().required('Indica el motivo de la anulación'),
}).required()

export type AnularCertificadoInput = yup.InferType<typeof anularCertificadoSchema>

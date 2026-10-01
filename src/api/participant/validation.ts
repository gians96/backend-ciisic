import * as yup from 'yup'
import { participanteSchema } from '../inscription/validation'

const nombre = () => yup.string().trim().min(2).max(120)
/**
 * Vacío equivale a no enviarlo (no cambia el celular): quien se dio de alta sin celular queda con
 * `''` y el panel envía el formulario completo al editarlo.
 */
const celular = () => yup.string().trim().transform((valor: string) => (valor === '' ? undefined : valor)).matches(/^\+?\d{9,15}$/, 'Celular inválido')

export const actualizarParticipanteSchema = yup.object({
    nombres: nombre(),
    apellidos: nombre(),
    correo: yup.string().trim().lowercase().email().max(191),
    celular: celular(),
    desvincularGoogle: yup.boolean(),
}).required()

export type ActualizarParticipanteInput = yup.InferType<typeof actualizarParticipanteSchema>

/**
 * Alta desde el panel (spec 014): organizadores, ponentes o quien se inscribe en persona. El
 * documento sigue las reglas de la inscripción; el correo es obligatorio porque sin él no hay portal.
 * Con DNI los nombres salen de la consulta DNI; si falla, son obligatorios (`NAMES_REQUIRED`).
 */
export const crearParticipanteSchema = participanteSchema.pick(['tipoDocumento', 'numeroDocumento', 'correo']).shape({
    nombres: nombre(),
    apellidos: nombre(),
    celular: celular(),
}).required()

export type CrearParticipanteInput = yup.InferType<typeof crearParticipanteSchema>

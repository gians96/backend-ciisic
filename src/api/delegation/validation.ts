import * as yup from 'yup'
import { TIPOS_DELEGACION, type CodigoTipoDelegacion } from '../../core/catalogos'

const nombre = () => yup.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120)
const tipo = () => yup.mixed<CodigoTipoDelegacion>().oneOf([...TIPOS_DELEGACION], 'Elige un tipo: SALON, CICLO u OTRO')

/** `POST /v1/events/:eventId/delegations` (spec 018). */
export const crearDelegacionSchema = yup.object({
    nombre: nombre().required(),
    tipo: tipo().default('OTRO'),
    abreviatura: yup.string().trim().max(20).nullable(),
    delegadoId: yup.number().integer().positive().nullable(),
}).required()

export type CrearDelegacionInput = yup.InferType<typeof crearDelegacionSchema>

/** `PATCH /v1/delegations/:id` (spec 018): solo los campos enviados cambian. */
export const actualizarDelegacionSchema = yup.object({
    nombre: nombre(),
    tipo: tipo(),
    abreviatura: yup.string().trim().max(20).nullable(),
    delegadoId: yup.number().integer().positive().nullable(),
    activo: yup.boolean(),
}).required()

export type ActualizarDelegacionInput = yup.InferType<typeof actualizarDelegacionSchema>

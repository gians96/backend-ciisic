import * as yup from 'yup'
import { REGEX_FECHA, REGEX_HORA } from '../../core/fechas'
import type { MetodoAsistencia } from '../../core/catalogos'

const campos = {
    nombre: yup.string().trim().min(2).max(150),
    fecha: yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD'),
    horaInicio: yup.string().trim().matches(REGEX_HORA, 'Use el formato HH:mm'),
    horaFin: yup.string().trim().matches(REGEX_HORA, 'Use el formato HH:mm'),
}

const horasCoherentes = (value: { horaInicio?: string, horaFin?: string }) =>
    !value.horaInicio || !value.horaFin || value.horaFin > value.horaInicio

export const crearActividadSchema = yup.object({
    nombre: campos.nombre.required(),
    fecha: campos.fecha.required(),
    horaInicio: campos.horaInicio.required(),
    horaFin: campos.horaFin.required(),
}).test('horas', 'La hora de fin debe ser posterior a la de inicio', horasCoherentes).required()

export const actualizarActividadSchema = yup.object(campos)
    .test('horas', 'La hora de fin debe ser posterior a la de inicio', horasCoherentes)
    .required()

/** Métodos que el panel puede declarar al marcar (`QR_LEGADO` lo asigna solo el servidor). */
export const METODOS_MARCA: readonly MetodoAsistencia[] = ['QR', 'DOCUMENTO', 'MANUAL']

export const registrarAsistenciaSchema = yup.object({
    participanteId: yup.number().integer().positive(),
    numeroDocumento: yup.string().trim().matches(/^[A-Za-z0-9]{8,12}$/, 'Documento inválido'),
    // Solo con numeroDocumento: desambigua si en el evento hay un DNI y un CE con el mismo número
    tipoDocumento: yup.string().trim().lowercase().oneOf(['dni', 'ce']),
    fueraDeHorario: yup.boolean().default(false),
    // Sin método se infiere: participanteId → QR, numeroDocumento → DOCUMENTO
    metodo: yup.mixed<MetodoAsistencia>().oneOf(METODOS_MARCA).nullable(),
}).test('identificador', 'Indique participanteId o numeroDocumento', (value) => Boolean(value?.participanteId || value?.numeroDocumento)).required()

/** Legacy: `{ id_usuario, id_evento }` (id_evento = actividad). */
export const asistenciaLegacySchema = yup.object({
    id_usuario: yup.number().integer().positive().required(),
    id_evento: yup.number().integer().positive().required(),
}).required()

export const exportLegacySchema = yup.object({
    eventos: yup.array().of(yup.number().integer().positive().required()).min(1).required(),
}).required()

export type CrearActividadInput = yup.InferType<typeof crearActividadSchema>
export type ActualizarActividadInput = yup.InferType<typeof actualizarActividadSchema>
export type RegistrarAsistenciaInput = yup.InferType<typeof registrarAsistenciaSchema>

import * as yup from 'yup'
import { REGEX_FECHA, REGEX_HORA } from '../../core/fechas'
import type { MetodoAsistencia } from '../../core/catalogos'
import { REGEX_CODIGO_CREDENCIAL } from '../../core/codigos'

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

/**
 * Métodos que el panel puede declarar al marcar. El servidor deduce el método del identificador
 * (`codigo` → QR, `participanteId` → QR_LEGADO, `numeroDocumento` → DOCUMENTO): `QR` y
 * `DOCUMENTO` se aceptan por compatibilidad con el panel de la spec 013 y no cambian nada; solo
 * `MANUAL` cuenta (exige `asistencia.fuera_horario`). `QR_LEGADO` lo asigna solo el servidor.
 */
export const METODOS_MARCA: readonly MetodoAsistencia[] = ['QR', 'DOCUMENTO', 'MANUAL']

const IDENTIFICADORES = ['codigo', 'numeroDocumento', 'participanteId'] as const

export const registrarAsistenciaSchema = yup.object({
    // Código de la credencial (QR del fotocheck, spec 014); se admite en minúsculas y se guarda en mayúsculas
    codigo: yup.string().trim().uppercase().matches(REGEX_CODIGO_CREDENCIAL, 'El código de la credencial tiene 10 letras o números'),
    numeroDocumento: yup.string().trim().matches(/^[A-Za-z0-9]{8,12}$/, 'Documento inválido'),
    // Solo con numeroDocumento: desambigua si en el evento hay un DNI y un CE con el mismo número
    tipoDocumento: yup.string().trim().lowercase().oneOf(['dni', 'ce']),
    // QR anterior de las credenciales ya enviadas (id del participante): se acepta con aviso hasta el fin del evento
    participanteId: yup.number().integer().positive(),
    fueraDeHorario: yup.boolean().default(false),
    metodo: yup.mixed<MetodoAsistencia>().oneOf(METODOS_MARCA).nullable(),
})
    .test('identificador', 'Indique exactamente uno: codigo, numeroDocumento o participanteId', (value) =>
        IDENTIFICADORES.filter((campo) => value?.[campo] !== undefined && value?.[campo] !== null && value?.[campo] !== '').length === 1)
    .test('tipoDocumento', 'El tipo de documento solo acompaña a numeroDocumento', function (value) {
        return !value?.tipoDocumento || Boolean(value.numeroDocumento) || this.createError({ path: 'tipoDocumento' })
    })
    .required()

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

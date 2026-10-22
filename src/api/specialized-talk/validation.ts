import * as yup from 'yup'
import { REGEX_FECHA, REGEX_HORA } from '../../core/fechas'
import { esFotoValida } from '../../core/ponencias-especializadas'
import { participanteSchema } from '../inscription/validation'

export const MODALIDADES = ['PRESENCIAL', 'VIRTUAL'] as const
export const PROCEDENCIAS = ['INTERNO', 'EXTERNO'] as const
export const ESTADOS_INSCRIPCION_PONENCIA = ['INSCRITO', 'CANCELADO'] as const
export const ORIGENES_INSCRIPCION_PONENCIA = ['LANDING', 'STAFF', 'PUERTA'] as const

/** Un campo opcional enviado vacío equivale a no enviarlo. */
const vacioAIndefinido = (valor: unknown) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor)
/** En una edición, vacío equivale a borrar el dato. */
const vacioANulo = (valor: unknown) => (typeof valor === 'string' && valor.trim() === '' ? null : valor)

// ─── Ponencias ──────────────────────────────────────────────────────────────

const fechaReal = (valor: string | undefined) => {
    if (!valor) return true
    const fecha = new Date(`${valor}T00:00:00.000Z`)
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

const horasCoherentes = (valor: { horaInicio?: string, horaFin?: string }) =>
    !valor.horaInicio || !valor.horaFin || valor.horaFin > valor.horaInicio

const camposPonente = {
    bio: yup.string().transform(vacioANulo).trim().max(5000).nullable(),
    foto: yup.string().transform(vacioANulo).trim().max(255).nullable()
        .test('foto', 'Usa una ruta del sitio (/images/…) o una URL https', (valor) => !valor || esFotoValida(valor)),
    externo: yup.boolean(),
}
const nombrePonente = () => yup.string().trim().min(2).max(200)
const ponenteCrear = yup.object({ nombre: nombrePonente().required(), ...camposPonente })
const ponenteActualizar = yup.object({ nombre: nombrePonente(), ...camposPonente })

const camposPonencia = {
    tema: yup.string().trim().min(3).max(300),
    fecha: yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD').test('fecha-real', 'La fecha no existe', fechaReal),
    horaInicio: yup.string().trim().matches(REGEX_HORA, 'Use el formato HH:mm'),
    horaFin: yup.string().trim().matches(REGEX_HORA, 'Use el formato HH:mm'),
    ambiente: yup.string().trim().min(1).max(120),
    modalidad: yup.string().oneOf([...MODALIDADES]),
    precio: yup.number().min(0).max(99999.99)
        .test('decimales', 'Máximo dos decimales', (valor) => valor === undefined || Number.isInteger(Number((valor * 100).toFixed(6)))),
    cupo: yup.number().integer().min(1).max(5000).nullable(),
    publicada: yup.boolean(),
    orden: yup.number().integer().min(0).max(9999),
}

export const crearPonenciaSchema = yup.object({
    tema: camposPonencia.tema.required(),
    fecha: camposPonencia.fecha.required(),
    horaInicio: camposPonencia.horaInicio.required(),
    horaFin: camposPonencia.horaFin.required(),
    ambiente: camposPonencia.ambiente.required(),
    modalidad: camposPonencia.modalidad.default('PRESENCIAL'),
    precio: camposPonencia.precio.default(0),
    cupo: camposPonencia.cupo.default(null),
    ponente: ponenteCrear.required(),
    publicada: camposPonencia.publicada.default(true),
    orden: camposPonencia.orden.default(0),
}).test('horas', 'La hora de fin debe ser posterior a la de inicio', horasCoherentes).required()

export const actualizarPonenciaSchema = yup.object({
    ...camposPonencia,
    ponente: ponenteActualizar.default(undefined),
}).test('horas', 'La hora de fin debe ser posterior a la de inicio', horasCoherentes).required()

export type CrearPonenciaInput = yup.InferType<typeof crearPonenciaSchema>
export type ActualizarPonenciaInput = yup.InferType<typeof actualizarPonenciaSchema>

// ─── Asistentes e inscripciones ─────────────────────────────────────────────

const nombre = () => yup.string().transform(vacioAIndefinido).trim().min(2).max(120)

/**
 * Persona que se inscribe o marca asistencia. Documento con las reglas de la inscripción (DNI de 8
 * dígitos o carné de extranjería); correo, celular y procedencia son opcionales. Con DNI los nombres
 * salen de la consulta oficial; los enviados solo se usan si no hay consulta.
 */
export const asistenteSchema = participanteSchema.pick(['tipoDocumento', 'numeroDocumento']).shape({
    nombres: nombre(),
    apellidos: nombre(),
    correo: yup.string().transform(vacioAIndefinido).trim().lowercase().email().max(191),
    celular: yup.string().transform(vacioAIndefinido).trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos'),
    procedencia: yup.string().transform(vacioAIndefinido).oneOf([...PROCEDENCIAS]),
})

export type AsistenteInput = yup.InferType<typeof asistenteSchema>

/** Alta manual del staff y asistencia en puerta: el cuerpo es la persona. */
export const personaSchema = asistenteSchema.required()

/** Inscripción desde la landing: una persona y de 1 a 4 ponencias, todo o nada. */
export const inscripcionSitioSchema = yup.object({
    asistente: asistenteSchema.required(),
    ponenciaIds: yup.array().of(yup.number().integer().positive().required()).min(1).max(4).required()
        .test('unicos', 'No repitas ponencias', (ids) => !ids || new Set(ids).size === ids.length),
}).required()

export type InscripcionSitioInput = yup.InferType<typeof inscripcionSitioSchema>

/**
 * Verificación previa de la landing (spec 030): el documento y el correo con los que la persona se inscribió
 * al congreso. Es un POST para que ni el documento ni el correo viajen en la URL.
 */
export const elegibilidadSchema = participanteSchema.pick(['tipoDocumento', 'numeroDocumento']).shape({
    correo: yup.string().trim().lowercase().email().max(191).required(),
}).required()

export type ElegibilidadInput = yup.InferType<typeof elegibilidadSchema>

/** Interruptor del evento: encendido, las ponencias se inscriben solo con el documento. */
export const accesoPonenciasSchema = yup.object({
    accesoLibre: yup.boolean().required(),
}).required()

export const editarInscripcionSchema = yup.object({
    estado: yup.string().oneOf([...ESTADOS_INSCRIPCION_PONENCIA]),
    asistente: yup.object({
        nombres: nombre(),
        apellidos: nombre(),
        correo: yup.string().transform(vacioANulo).trim().lowercase().email().max(191).nullable(),
        celular: yup.string().transform(vacioANulo).trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos').nullable(),
        procedencia: yup.string().transform(vacioANulo).oneOf([...PROCEDENCIAS]).nullable(),
    }).default(undefined),
}).test('algo', 'Indica qué cambiar', (valor) =>
    valor.estado !== undefined || (valor.asistente !== undefined && Object.values(valor.asistente).some((campo) => campo !== undefined)),
).required()

export type EditarInscripcionInput = yup.InferType<typeof editarInscripcionSchema>

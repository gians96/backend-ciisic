import * as yup from 'yup'
import { fechaLima, REGEX_FECHA } from '../../core/fechas'
import { ESTADOS_INSCRIPCION } from '../../core/catalogos'

const numeroDocumento = () => yup.string().trim().required().when('tipoDocumento', {
    is: 'dni',
    then: (schema) => schema.matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos'),
    otherwise: (schema) => schema.matches(/^[A-Za-z0-9]{9,12}$/, 'El carné de extranjería debe tener entre 9 y 12 caracteres'),
})

export const participanteSchema = yup.object({
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    celular: yup.string().trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos').required(),
})

/**
 * Número de operación de un pago. El prefijo `CORTESIA-` es de las inscripciones de cortesía (spec
 * 014): nadie lo puede usar desde un formulario.
 */
const numeroOperacion = () => yup.string().trim().min(3).max(100).required()
    .test('no-cortesia', 'El número de operación no es válido', (value) => !value || !/^cortesia-/i.test(value))

/** Fecha de pago `YYYY-MM-DD` no posterior a hoy (hora de Lima), evaluada en cada solicitud. */
const fechaPago = () => yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD').required()
    .test('no-futura', 'La fecha de pago no puede ser futura', (value) => !value || value <= fechaLima())

export const crearInscripcionSchema = yup.object({
    participante: participanteSchema.required(),
    tipoInscripcionId: yup.number().integer().positive().required(),
    clasificacionId: yup.number().integer().positive().nullable(),
    modalidadPago: yup.string().oneOf(['banco', 'billetera']).required(),
    banco: yup.string().trim().lowercase().max(40).nullable(),
    tipoOperacion: yup.string().oneOf(['directo', 'interbancario']).nullable(),
    billeteraDigital: yup.string().trim().lowercase().max(40).nullable(),
    numeroOperacion: numeroOperacion(),
    fechaPago: fechaPago(),
    verificacionToken: yup.string().trim().max(4000).nullable(),
    /** Token de `/site/google-verification`: el correo se verificó con Google (spec 010). */
    verificacionCorreoToken: yup.string().trim().max(4000).nullable(),
}).required()

export type CrearInscripcionInput = yup.InferType<typeof crearInscripcionSchema>

/** Cuerpo de la ruta legacy `POST /v1/inscription` (landing anterior). */
export const inscripcionLegacySchema = yup.object({
    usuario: yup.object({
        idTipoDocumentoId: yup.string().oneOf(['dni', 'ce']).required(),
        dni: yup.string().trim().matches(/^\d{8,9}$/).required(),
        nombres: yup.string().trim().min(2).max(120).required(),
        apellidos: yup.string().trim().min(2).max(120).required(),
        correoElectronico: yup.string().trim().lowercase().email().required(),
        celular: yup.string().trim().matches(/^\d{9}$/).required(),
    }).required(),
    tipoInscripcionId: yup.number().integer().positive().required(),
    clasificacionId: yup.number().integer().positive().nullable(),
    modalidadDeposito: yup.string().oneOf(['banco', 'billetera']).required(),
    bancoSeleccionado: yup.string().trim().max(80).nullable(),
    tipoOperacion: yup.string().trim().max(80).nullable(),
    billeteraDigital: yup.string().trim().max(80).nullable(),
    numeroOperacion: numeroOperacion(),
    fechaPago: yup.date().required().test('no-futura', 'La fecha de pago no puede ser futura', (value) => !value || value.getTime() <= Date.now() + 24 * 60 * 60 * 1000),
}).required()

export type InscripcionLegacyInput = yup.InferType<typeof inscripcionLegacySchema>

export const cambiarEstadoSchema = yup.object({
    estado: yup.string().oneOf([...ESTADOS_INSCRIPCION]).required(),
    motivo: yup.string().trim().max(500).nullable()
        .when('estado', { is: 'RECHAZADO', then: (schema) => schema.required('Indique el motivo del rechazo').min(3) }),
}).required()

export const cambiarEstadoLegacySchema = yup.object({
    estadoId: yup.number().integer().min(1).max(5).required(),
}).required()

/** `POST /v1/events/:eventId/courtesy-inscriptions` (spec 014). */
export const cortesiaSchema = yup.object({
    participanteId: yup.number().integer().positive().required(),
    tipoInscripcionId: yup.number().integer().positive().nullable(),
    /** Genera y envía la credencial al crearla, como al aprobar. */
    enviarCredencial: yup.boolean().default(false),
}).required()

export type CortesiaInput = yup.InferType<typeof cortesiaSchema>

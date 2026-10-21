import * as yup from 'yup'
import { fechaLima, REGEX_FECHA } from '../../core/fechas'

/** Documento igual que en la inscripción pública: DNI de 8 dígitos o carné de 9 a 12 caracteres. */
const numeroDocumento = () => yup.string().trim().required().when('tipoDocumento', {
    is: 'dni',
    then: (schema) => schema.matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos'),
    otherwise: (schema) => schema.matches(/^[A-Za-z0-9]{9,12}$/, 'El carné de extranjería debe tener entre 9 y 12 caracteres'),
})

const telefono = () => yup.string().trim().transform((valor: string) => (valor === '' ? null : valor)).matches(/^\+?\d{6,15}$/, 'Teléfono inválido').nullable()

const campos = {
    nombre: yup.string().trim().min(2).max(150),
    institucion: yup.string().trim().max(191).nullable(),
    representanteNombre: yup.string().trim().max(150).nullable(),
    representanteEmail: yup.string().trim().lowercase().email().max(191).nullable(),
    representanteTelefono: telefono(),
    minIntegrantes: yup.number().integer().min(1).max(1000).default(10),
    precioEstandar: yup.number().min(0).max(99999999).default(60),
    precioPromocional: yup.number().min(0).max(99999999).default(50),
}

function preciosCoherentes(value: { precioEstandar?: number, precioPromocional?: number }) {
    if (value.precioEstandar === undefined || value.precioPromocional === undefined) return true
    return value.precioPromocional <= value.precioEstandar
}

export const crearDelegacionSchema = yup.object({
    ...campos,
    nombre: campos.nombre.required(),
}).test('precios', 'El precio promocional no puede ser mayor que el precio estándar', preciosCoherentes).required()

export type CrearDelegacionInput = yup.InferType<typeof crearDelegacionSchema>

export const participanteDelegacionSchema = yup.object({
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    // Vacío es válido: la carga masiva solo exige documento, nombres y correo
    celular: yup.string().trim().test('celular', 'El celular debe tener entre 9 y 15 dígitos', (valor) => !valor || /^\+?\d{9,15}$/.test(valor)).default(''),
}).required()

export const inscribirEnDelegacionSchema = yup.object({
    participantes: yup.array().of(participanteDelegacionSchema).min(1, 'Registra al menos un participante').max(200, 'Máximo 200 participantes por carga').required(),
}).required()

export type ParticipanteDelegacionInput = yup.InferType<typeof participanteDelegacionSchema>
export type InscribirEnDelegacionInput = yup.InferType<typeof inscribirEnDelegacionSchema>

/**
 * Registro público de una delegación (spec 021): el representante inscribe a todo su grupo y
 * paga el total con un solo voucher. A diferencia de la inscripción individual, el pago es
 * **conjunto**: un único número de operación y un único archivo para todas las inscripciones.
 */
export const registroDelegacionSchema = yup.object({
    /** Link de una delegación ya creada por el staff: el registro se pega a esa delegación. */
    codigoLink: yup.string().trim().max(100).nullable(),
    /** Tipo de delegación elegido en la tarjeta (spec 022): Delegación General / Promocional. */
    tipoInscripcionId: yup.number().integer().positive().nullable().default(null),
    delegacion: yup.object({
        nombre: yup.string().trim().min(2).max(150).required(),
        institucion: yup.string().trim().max(191).nullable(),
    }).required(),
    /** El representante: contacto del grupo y, si marca `esIntegrante`, el primer integrante. */
    representante: yup.object({
        nombres: yup.string().trim().min(2).max(120).required(),
        apellidos: yup.string().trim().min(2).max(120).required(),
        tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
        numeroDocumento: numeroDocumento(),
        correo: yup.string().trim().lowercase().email().max(191).required(),
        celular: yup.string().trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos').required(),
        esIntegrante: yup.boolean().default(true),
    }).required(),
    participantes: yup.array().of(participanteDelegacionSchema).min(1, 'Registra al menos un participante').max(200, 'Máximo 200 participantes por carga').required(),
    modalidadPago: yup.string().oneOf(['banco', 'billetera']).required(),
    banco: yup.string().trim().lowercase().max(40).nullable(),
    tipoOperacion: yup.string().oneOf(['directo', 'interbancario']).nullable(),
    billeteraDigital: yup.string().trim().lowercase().max(40).nullable(),
    numeroOperacion: yup.string().trim().min(3).max(100).required(),
    fechaPago: yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD').required()
        .test('no-futura', 'La fecha de pago no puede ser futura', (valor) => !valor || valor <= fechaLima()),
}).required()

export type RegistroDelegacionInput = yup.InferType<typeof registroDelegacionSchema>

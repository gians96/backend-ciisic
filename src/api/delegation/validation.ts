import * as yup from 'yup'
import { fechaLima, REGEX_FECHA } from '../../core/fechas'
import { MODALIDADES_ASISTENCIA } from '../../core/catalogos'

/** Documento igual que en la inscripción pública: DNI de 8 dígitos o carné de 9 a 12 caracteres. */
const numeroDocumento = () => yup.string().trim().required().when('tipoDocumento', {
    is: 'dni',
    then: (schema) => schema.matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos'),
    otherwise: (schema) => schema.matches(/^[A-Za-z0-9]{9,12}$/, 'El carné de extranjería debe tener entre 9 y 12 caracteres'),
})

const celular = () => yup.string().trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos')

/** Cómo asiste la delegación (spec 023): decide el tipo de sus inscripciones y la tarifa. */
const modalidad = () => yup.string().oneOf([...MODALIDADES_ASISTENCIA]).default('PRESENCIAL')

function preciosCoherentes(value: { precioEstandar?: number, precioPromocional?: number }) {
    if (value.precioEstandar === undefined || value.precioPromocional === undefined) return true
    return value.precioPromocional <= value.precioEstandar
}

export const participanteDelegacionSchema = yup.object({
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    // Vacío es válido: la carga masiva solo exige documento, nombres y correo
    celular: yup.string().trim().test('celular', 'El celular debe tener entre 9 y 15 dígitos', (valor) => !valor || /^\+?\d{9,15}$/.test(valor)).default(''),
}).required()

/** El delegado (spec 023): contacto del grupo y, si marca `esIntegrante`, su primer integrante. */
const representanteSchema = (esIntegrantePorDefecto: boolean) => yup.object({
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    celular: celular().required(),
    esIntegrante: yup.boolean().default(esIntegrantePorDefecto),
}).required()

const MAX_INTEGRANTES = 200

const participantes = () => yup.array().of(participanteDelegacionSchema).max(MAX_INTEGRANTES, `Máximo ${MAX_INTEGRANTES} participantes por carga`)

/**
 * Alta de una delegación por el staff (spec 023): el delegado (documento, correo y celular), la
 * modalidad y, si ya los tiene, sus integrantes. La tarifa sale de los tipos del evento; las cifras
 * de abajo son opcionales y solo sirven para un convenio con un precio distinto.
 */
export const crearDelegacionSchema = yup.object({
    nombre: yup.string().trim().min(2).max(150).required(),
    institucion: yup.string().trim().max(191).nullable(),
    modalidad: modalidad(),
    representante: representanteSchema(false),
    participantes: participantes().default([]),
    minIntegrantes: yup.number().integer().min(1).max(1000),
    precioEstandar: yup.number().min(0).max(99999999),
    precioPromocional: yup.number().min(0).max(99999999),
}).test('precios', 'El precio promocional no puede ser mayor que el precio estándar', preciosCoherentes).required()

export type CrearDelegacionInput = yup.InferType<typeof crearDelegacionSchema>

/** Edición de los datos de la delegación por el staff. La modalidad solo cambia mientras no tenga integrantes. */
export const editarDelegacionSchema = yup.object({
    nombre: yup.string().trim().min(2).max(150),
    institucion: yup.string().trim().max(191).nullable(),
    modalidad: yup.string().oneOf([...MODALIDADES_ASISTENCIA]),
    representante: yup.object({
        nombres: yup.string().trim().min(2).max(120).required(),
        apellidos: yup.string().trim().min(2).max(120).required(),
        tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
        numeroDocumento: numeroDocumento(),
        correo: yup.string().trim().lowercase().email().max(191).required(),
        celular: celular().required(),
    }).default(undefined),
    activo: yup.boolean(),
    minIntegrantes: yup.number().integer().min(1).max(1000),
    precioEstandar: yup.number().min(0).max(99999999),
    precioPromocional: yup.number().min(0).max(99999999),
}).test('precios', 'El precio promocional no puede ser mayor que el precio estándar', preciosCoherentes).required()

export type EditarDelegacionInput = yup.InferType<typeof editarDelegacionSchema>

/**
 * Tarifa de las delegaciones de un evento (spec 024). Cada campo es opcional; el servicio mezcla lo que
 * llega con lo vigente y comprueba que el promocional no supere al estándar. `aplicarAExistentes` copia la
 * tarifa a las delegaciones que aún no tienen integrantes ni vouchers.
 */
export const tarifaDelegacionesSchema = yup.object({
    minIntegrantes: yup.number().integer().min(1).max(1000),
    precioEstandar: yup.number().min(0).max(99999999),
    precioPromocional: yup.number().min(0).max(99999999),
    precioVirtual: yup.number().min(0).max(99999999),
    virtualActivo: yup.boolean(),
    aplicarAExistentes: yup.boolean(),
})
    .test('precios', 'El precio promocional no puede ser mayor que el precio estándar', preciosCoherentes)
    .test('alguno', 'Indica al menos un dato de la tarifa', (value) => Object.values(value).some((campo) => campo !== undefined))
    .required()

export type TarifaDelegacionesInput = yup.InferType<typeof tarifaDelegacionesSchema>

export const inscribirEnDelegacionSchema = yup.object({
    participantes: yup.array().of(participanteDelegacionSchema).min(1, 'Registra al menos un participante').max(MAX_INTEGRANTES, `Máximo ${MAX_INTEGRANTES} participantes por carga`).required(),
}).required()

export type ParticipanteDelegacionInput = yup.InferType<typeof participanteDelegacionSchema>
export type InscribirEnDelegacionInput = yup.InferType<typeof inscribirEnDelegacionSchema>

/**
 * Un voucher de la delegación (spec 023). El archivo llega aparte (`vouchers`) y se empareja por
 * posición con esta lista. El monto es lo que dice el voucher: el staff lo contrasta con el banco.
 */
export const pagoDelegacionSchema = yup.object({
    modalidadPago: yup.string().oneOf(['banco', 'billetera']).required(),
    banco: yup.string().trim().lowercase().max(40).nullable(),
    tipoOperacion: yup.string().oneOf(['directo', 'interbancario']).nullable(),
    billeteraDigital: yup.string().trim().lowercase().max(40).nullable(),
    numeroOperacion: yup.string().trim().min(3).max(100).required(),
    fechaPago: yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD').required()
        .test('no-futura', 'La fecha de pago no puede ser futura', (valor) => !valor || valor <= fechaLima()),
    monto: yup.number().positive('El monto del voucher debe ser mayor que cero').max(99999999).required(),
}).required()

export const MAX_PAGOS_POR_ENVIO = 6

const pagos = () => yup.array().of(pagoDelegacionSchema)
    .min(1, 'Adjunta al menos un voucher de pago')
    .max(MAX_PAGOS_POR_ENVIO, `Máximo ${MAX_PAGOS_POR_ENVIO} vouchers por envío`)

/** Vouchers que se suman a una delegación ya registrada (por su link o desde el panel). */
export const agregarPagosSchema = yup.object({
    pagos: pagos().required(),
}).required()

export type PagoDelegacionInput = yup.InferType<typeof pagoDelegacionSchema>
export type AgregarPagosInput = yup.InferType<typeof agregarPagosSchema>

export const estadoPagoDelegacionSchema = yup.object({
    estado: yup.string().oneOf(['PENDIENTE', 'VERIFICADO', 'RECHAZADO']).required(),
    motivo: yup.string().trim().max(500).nullable(),
}).required()

export type EstadoPagoDelegacionInput = yup.InferType<typeof estadoPagoDelegacionSchema>

/**
 * Registro público de una delegación (spec 018, ampliado en la 023): el delegado inscribe a su
 * grupo y paga con uno o varios vouchers. La modalidad decide el tipo y la tarifa; el servidor
 * calcula el monto. Con `codigoLink` el registro se suma a una delegación que el staff ya creó.
 */
export const registroDelegacionSchema = yup.object({
    codigoLink: yup.string().trim().max(100).nullable(),
    modalidad: modalidad(),
    delegacion: yup.object({
        nombre: yup.string().trim().min(2).max(150).required(),
        institucion: yup.string().trim().max(191).nullable(),
    }).required(),
    representante: representanteSchema(true),
    participantes: participantes().default([]),
    pagos: pagos().required(),
}).required()

export type RegistroDelegacionInput = yup.InferType<typeof registroDelegacionSchema>

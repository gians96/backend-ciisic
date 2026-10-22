import * as yup from 'yup'
import { fechaLima, REGEX_FECHA } from '../../core/fechas'
import { CODIGOS_PLAN } from './services/planes'

/** Documento igual que en la inscripción pública: DNI de 8 dígitos o carné de 9 a 12 caracteres. */
const numeroDocumento = () => yup.string().trim().required().when('tipoDocumento', {
    is: 'dni',
    then: (schema) => schema.matches(/^\d{8}$/, 'El DNI debe tener 8 dígitos'),
    otherwise: (schema) => schema.matches(/^[A-Za-z0-9]{9,12}$/, 'El carné de extranjería debe tener entre 9 y 12 caracteres'),
})

const celular = () => yup.string().trim().matches(/^\+?\d{9,15}$/, 'El celular debe tener entre 9 y 15 dígitos')

/** Plan que elige el integrante (spec 029). Sin plan, el servidor usa el único activo de la delegación. */
const plan = () => yup.string().trim().uppercase().oneOf([...CODIGOS_PLAN], 'Plan no válido')

export const participanteDelegacionSchema = yup.object({
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    // Vacío es válido: la carga masiva solo exige documento, nombres y correo
    celular: yup.string().trim().test('celular', 'El celular debe tener entre 9 y 15 dígitos', (valor) => !valor || /^\+?\d{9,15}$/.test(valor)).default(''),
    plan: plan(),
}).required()

/** El delegado (spec 023): contacto del grupo y, si marca `esIntegrante`, su primer integrante. */
const representanteSchema = () => yup.object({
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    correo: yup.string().trim().lowercase().email().max(191).required(),
    celular: celular().required(),
    esIntegrante: yup.boolean().default(false),
    /** Plan del delegado si cuenta como integrante. */
    plan: plan(),
}).required()

const MAX_INTEGRANTES = 200

const participantes = () => yup.array().of(participanteDelegacionSchema).max(MAX_INTEGRANTES, `Máximo ${MAX_INTEGRANTES} participantes por carga`)

const MAX_PRECIO = 99999999

/** Cambios de un plan: lo que no llega se conserva. `precioPromocional: null` quita la escala. */
const planCambiosSchema = yup.object({
    activo: yup.boolean(),
    precio: yup.number().min(0).max(MAX_PRECIO),
    precioPromocional: yup.number().min(0).max(MAX_PRECIO).nullable(),
}).default(undefined)

/** Planes de una delegación (spec 029): cada clave es opcional. */
export const planesSchema = yup.object({
    CON_KIT: planCambiosSchema,
    SIN_KIT: planCambiosSchema,
    VIRTUAL: planCambiosSchema,
}).default(undefined)

export type PlanesInput = NonNullable<yup.InferType<typeof planesSchema>>

/** Dominio del correo de los integrantes: `unac.edu.pe` (se admite escribirlo con arroba). Vacío = sin filtro. */
const dominioCorreo = () => yup.string().nullable()
    .transform((valor: unknown) => (typeof valor === 'string' ? valor.trim().toLowerCase().replace(/^@/, '') || null : valor))
    .max(100)
    .matches(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, { message: 'Escribe un dominio como unac.edu.pe', excludeEmptyString: true })

const minIntegrantes = () => yup.number().integer().min(1).max(1000)

/**
 * Alta de una delegación por el staff (spec 029): el delegado, sus datos y, si ya los tiene, sus integrantes.
 * Los planes, el dominio, el mínimo y el link individual solo los fija quien tiene `delegaciones.gestionar`:
 * sin ellos los tres planes nacen apagados y sin precio.
 */
export const crearDelegacionSchema = yup.object({
    nombre: yup.string().trim().min(2).max(150).required(),
    institucion: yup.string().trim().max(191).nullable(),
    representante: representanteSchema(),
    participantes: participantes().default([]),
    planes: planesSchema,
    minIntegrantes: minIntegrantes(),
    dominioCorreo: dominioCorreo(),
    inscripcionIndividual: yup.boolean(),
}).required()

export type CrearDelegacionInput = yup.InferType<typeof crearDelegacionSchema>

/** Edición de los datos del grupo por el staff (no toca planes, precios ni links). */
export const editarDelegacionSchema = yup.object({
    nombre: yup.string().trim().min(2).max(150),
    institucion: yup.string().trim().max(191).nullable(),
    representante: yup.object({
        nombres: yup.string().trim().min(2).max(120).required(),
        apellidos: yup.string().trim().min(2).max(120).required(),
        tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
        numeroDocumento: numeroDocumento(),
        correo: yup.string().trim().lowercase().email().max(191).required(),
        celular: celular().required(),
    }).default(undefined),
    activo: yup.boolean(),
}).required()

export type EditarDelegacionInput = yup.InferType<typeof editarDelegacionSchema>

/**
 * Configuración de la delegación (spec 029, `delegaciones.gestionar`): planes y precios, mínimo para el
 * promocional, dominio del correo y link individual. Cada campo es opcional; el servicio mezcla lo que llega
 * con lo vigente.
 */
export const configDelegacionSchema = yup.object({
    planes: planesSchema,
    minIntegrantes: minIntegrantes(),
    dominioCorreo: dominioCorreo(),
    inscripcionIndividual: yup.boolean(),
}).test('alguno', 'Indica al menos un dato de la configuración', (valor) => Object.values(valor).some((campo) => campo !== undefined)).required()

export type ConfigDelegacionInput = yup.InferType<typeof configDelegacionSchema>

export const regenerarLinkSchema = yup.object({
    enlace: yup.string().oneOf(['delegado', 'individual']).required(),
}).required()

export type RegenerarLinkInput = yup.InferType<typeof regenerarLinkSchema>

export const cambiarPlanSchema = yup.object({
    plan: plan().required(),
}).required()

export type CambiarPlanInput = yup.InferType<typeof cambiarPlanSchema>

export const inscribirEnDelegacionSchema = yup.object({
    participantes: yup.array().of(participanteDelegacionSchema).min(1, 'Registra al menos un participante').max(MAX_INTEGRANTES, `Máximo ${MAX_INTEGRANTES} participantes por carga`).required(),
}).required()

export type ParticipanteDelegacionInput = yup.InferType<typeof participanteDelegacionSchema>
export type InscribirEnDelegacionInput = yup.InferType<typeof inscribirEnDelegacionSchema>

/**
 * Un integrante que se inscribe solo con el link individual (spec 029). Con dominio en la delegación escribe
 * solo el prefijo (`correoPrefijo`) o el correo completo; sin dominio, el correo completo. Sin Google.
 */
export const inscribirseSchema = yup.object({
    tipoDocumento: yup.string().oneOf(['dni', 'ce']).required(),
    numeroDocumento: numeroDocumento(),
    nombres: yup.string().trim().min(2).max(120).required(),
    apellidos: yup.string().trim().min(2).max(120).required(),
    correo: yup.string().trim().lowercase().email().max(191),
    correoPrefijo: yup.string().trim().lowercase().matches(/^[a-z0-9._%+-]{1,64}$/, 'Escribe solo lo que va antes de la @'),
    celular: yup.string().trim().test('celular', 'El celular debe tener entre 9 y 15 dígitos', (valor) => !valor || /^\+?\d{9,15}$/.test(valor)).default(''),
    plan: plan(),
}).test('correo', 'Escribe tu correo', (valor) => Boolean(valor.correo || valor.correoPrefijo)).required()

export type InscribirseInput = yup.InferType<typeof inscribirseSchema>

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

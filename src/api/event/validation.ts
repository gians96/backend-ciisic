import * as yup from 'yup'
import { REGEX_ARCHIVO_QR } from '../../core/almacenamiento'
import { REGEX_FECHA } from '../../core/fechas'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DOMINIO = /^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/

const bancoSchema = yup.object({
    codigo: yup.string().trim().lowercase().max(30).required(),
    nombre: yup.string().trim().max(80).required(),
    numeroCuenta: yup.string().trim().max(40).required(),
    cci: yup.string().trim().max(40).nullable(),
})

const billeteraSchema = yup.object({
    codigo: yup.string().trim().lowercase().max(30).required(),
    nombre: yup.string().trim().max(80).required(),
    telefono: yup.string().trim().max(20).required(),
    qrUrl: yup.string().trim().max(255).nullable(),
    // Imagen subida con POST /v1/payment-qr (tiene prioridad sobre `qrUrl`)
    qrArchivo: yup.string().trim().matches(REGEX_ARCHIVO_QR, 'Vuelve a subir la imagen del QR').nullable(),
})

export const datosPagoSchema = yup.object({
    titular: yup.string().trim().max(150).nullable(),
    bancos: yup.array().of(bancoSchema).max(10),
    billeteras: yup.array().of(billeteraSchema).max(10),
}).nullable()

const fecha = () => yup.string().trim().matches(REGEX_FECHA, 'Use el formato AAAA-MM-DD')

const campos = {
    codigo: yup.string().trim().lowercase().matches(SLUG, 'Use minúsculas, números y guiones').max(60),
    nombre: yup.string().trim().min(3).max(200),
    nombreCorto: yup.string().trim().min(2).max(80),
    descripcion: yup.string().trim().max(5000).nullable(),
    sede: yup.string().trim().max(200).nullable(),
    fechaInicio: fecha(),
    fechaFin: fecha(),
    inscripcionesInicio: yup.date().nullable(),
    inscripcionesFin: yup.date().nullable(),
    inscripcionesAbiertas: yup.boolean(),
    estado: yup.string().oneOf(['BORRADOR', 'PUBLICADO', 'FINALIZADO', 'ARCHIVADO']),
    esPrincipal: yup.boolean(),
    dominioInstitucional: yup.string().trim().lowercase().matches(DOMINIO, 'Dominio inválido').max(100),
    correoContacto: yup.string().trim().lowercase().email().max(191).nullable(),
    telefonoContacto: yup.string().trim().max(30).nullable(),
    remitenteNombre: yup.string().trim().max(120).nullable(),
    asuntoAprobacion: yup.string().trim().max(200).nullable(),
    datosPago: datosPagoSchema,
    // Credencial de correo del evento (spec 006); null = usar la predeterminada
    credencialCorreoId: yup.number().integer().positive().nullable(),
}

function fechasCoherentes(value: { fechaInicio?: string, fechaFin?: string, inscripcionesInicio?: Date | null, inscripcionesFin?: Date | null }) {
    if (value.fechaInicio && value.fechaFin && value.fechaFin < value.fechaInicio) return false
    if (value.inscripcionesInicio && value.inscripcionesFin && value.inscripcionesFin < value.inscripcionesInicio) return false
    return true
}

export const crearEventoSchema = yup.object({
    ...campos,
    codigo: campos.codigo.required(),
    nombre: campos.nombre.required(),
    nombreCorto: campos.nombreCorto.required(),
    fechaInicio: campos.fechaInicio.required(),
    fechaFin: campos.fechaFin.required(),
    copiarDeEventoId: yup.number().integer().positive().nullable(),
}).test('fechas', 'Las fechas de fin deben ser posteriores a las de inicio', fechasCoherentes).required()

export const actualizarEventoSchema = yup.object(campos)
    .test('fechas', 'Las fechas de fin deben ser posteriores a las de inicio', fechasCoherentes)
    .required()

export type CrearEventoInput = yup.InferType<typeof crearEventoSchema>
export type ActualizarEventoInput = yup.InferType<typeof actualizarEventoSchema>
export type DatosPago = NonNullable<yup.InferType<typeof datosPagoSchema>>

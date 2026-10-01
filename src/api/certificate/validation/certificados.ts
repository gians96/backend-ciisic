import type { NextFunction, Request, Response } from 'express'
import * as yup from 'yup'
import { REGEX_FECHA } from '../../../core/fechas'
import { UUID_RECEPCION } from '../../../core/resolutores-evento'
import { crearParticipanteSchema } from '../../participant/validation'

/**
 * Validación de la emisión, edición y generación de certificados (spec 015). La emisión siempre
 * lleva plantilla (del evento y activa) y tipo; las personas nuevas, correo (el portal y los avisos
 * dependen de él). Las filas de la importación se validan una por una en el servicio, para que una
 * fila mala no bloquee las demás (resultado ERROR por fila).
 */

export const MAX_HORAS_CERTIFICADO = 10_000
/** Filas por solicitud de importación (el panel envía la lista en tandas). */
export const MAX_FILAS_IMPORTACION = 300
/** Certificados por solicitud de generación (síncrona). */
export const MAX_IDS_GENERACION = 10

const codigoTipo = () => yup.string().trim().transform((v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v))
    .matches(/^[A-Z][A-Z0-9_]{1,39}$/, 'Tipo de certificado inválido')
const id = (etiqueta: string) => yup.number().typeError(`${etiqueta} debe ser un número`).integer(`${etiqueta} debe ser un entero`).positive(`${etiqueta} debe ser positivo`)
const horas = () => yup.number().typeError('Las horas deben ser un número').integer('Las horas deben ser un entero')
    .min(0, 'Las horas no pueden ser negativas').max(MAX_HORAS_CERTIFICADO, `Como máximo ${MAX_HORAS_CERTIFICADO} horas`).nullable()
const detalle = () => yup.string().trim().max(500, 'El detalle tiene como máximo 500 caracteres').nullable()
    .transform((v: unknown) => (v === '' ? null : v))

/** Fecha `YYYY-MM-DD` real (no 2026-02-31). */
export function esFechaValida(valor: string): boolean {
    if (!REGEX_FECHA.test(valor)) return false
    const fecha = new Date(`${valor}T00:00:00.000Z`)
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

const fechaEmision = () => yup.string().trim().test('fecha', 'Usa una fecha válida con el formato AAAA-MM-DD', (v) => v === undefined || v === null || esFechaValida(v))

/** Persona nueva o existente (por documento): mismas reglas que el alta de participantes (spec 014). */
const personaSchema = crearParticipanteSchema.clone().default(undefined).notRequired()

export const emitirCertificadoSchema = yup.object({
    participanteId: id('participanteId'),
    persona: personaSchema,
    tipoCodigo: codigoTipo().required('El tipo de certificado es obligatorio'),
    plantillaId: id('plantillaId').required('La plantilla es obligatoria'),
    ponenciaId: yup.string().trim().matches(UUID_RECEPCION, 'Ponencia inválida').nullable(),
    horas: horas(),
    detalle: detalle(),
    fechaEmision: fechaEmision(),
}).test('destinatario', 'Indica participanteId o persona (solo uno)', function (valor) {
    if (!valor) return true
    const conId = valor.participanteId !== undefined && valor.participanteId !== null
    const conPersona = valor.persona !== undefined && valor.persona !== null
    if (conId !== conPersona) return true
    return this.createError({ path: conId ? 'persona' : 'participanteId', message: 'Indica participanteId o persona (solo uno)' })
}).required()

export type EmitirCertificadoInput = yup.InferType<typeof emitirCertificadoSchema>

const listaIds = (etiqueta: string) => yup.array().of(id(etiqueta).required()).max(200, `Como máximo 200 ${etiqueta}`)

export const desdeInscripcionesSchema = yup.object({
    tipoCodigo: codigoTipo().required('El tipo de certificado es obligatorio'),
    plantillaId: id('plantillaId').required('La plantilla es obligatoria'),
    horas: horas(),
    fechaEmision: fechaEmision(),
    filtro: yup.object({
        tipoInscripcionIds: listaIds('tipos de inscripción'),
        actividadIds: listaIds('actividades'),
        /** Porcentaje de actividades con asistencia (sin anuladas), de 0 a 100. */
        asistenciaMinima: yup.number().typeError('La asistencia mínima debe ser un número')
            .min(0, 'La asistencia mínima va de 0 a 100').max(100, 'La asistencia mínima va de 0 a 100').nullable(),
    }).default({}),
    simular: yup.boolean().typeError('simular debe ser verdadero o falso').default(false),
}).required()

export type DesdeInscripcionesInput = yup.InferType<typeof desdeInscripcionesSchema>

/**
 * Fila de la lista (organizadores, ponentes…). Solo forma y longitudes: el documento, el correo y
 * los nombres se validan en el servicio con las reglas del alta de participantes, fila por fila.
 */
const filaSchema = yup.object({
    tipoDocumento: yup.string().trim().lowercase().max(10).default('dni'),
    numeroDocumento: yup.string().trim().max(20).default(''),
    nombres: yup.string().trim().max(120),
    apellidos: yup.string().trim().max(120),
    correo: yup.string().trim().lowercase().max(191).default(''),
    detalle: yup.string().trim().max(500),
    horas: yup.mixed<number | string>().nullable(),
})

export const importarCertificadosSchema = yup.object({
    tipoCodigo: codigoTipo().required('El tipo de certificado es obligatorio'),
    plantillaId: id('plantillaId').required('La plantilla es obligatoria'),
    fechaEmision: fechaEmision(),
    filas: yup.array().of(filaSchema.required()).min(1, 'La lista está vacía').required('La lista es obligatoria'),
    simular: yup.boolean().typeError('simular debe ser verdadero o falso').default(false),
}).required()

export type ImportarCertificadosInput = yup.InferType<typeof importarCertificadosSchema>
export type FilaImportacion = ImportarCertificadosInput['filas'][number]

/** 422 `IMPORT_TOO_LARGE` antes de validar fila por fila (va tras la guarda y antes de `validateBody`). */
export function limiteFilasImportacion(req: Request, res: Response, next: NextFunction) {
    const filas = (req.body as { filas?: unknown } | undefined)?.filas
    if (Array.isArray(filas) && filas.length > MAX_FILAS_IMPORTACION) {
        res.status(422).json({ success: false, code: 'IMPORT_TOO_LARGE', message: `Envía la lista en partes de hasta ${MAX_FILAS_IMPORTACION} filas.` })
        return
    }
    next()
}

export const editarCertificadoSchema = yup.object({
    nombreImpreso: yup.string().trim().min(2, 'El nombre tiene al menos 2 caracteres').max(200, 'El nombre tiene como máximo 200 caracteres'),
    detalle: detalle(),
    horas: horas(),
    plantillaId: id('plantillaId'),
    fechaEmision: fechaEmision(),
    /** Toma el nombre actual del participante (nombres y apellidos). */
    sincronizarNombre: yup.boolean().typeError('sincronizarNombre debe ser verdadero o falso'),
    /** Necesario si el certificado ya se descargó para firmar. */
    confirmar: yup.boolean().typeError('confirmar debe ser verdadero o falso'),
}).test('nombre', 'Envía nombreImpreso o sincronizarNombre, no ambos', function (valor) {
    if (!valor || !(valor.sincronizarNombre && valor.nombreImpreso)) return true
    return this.createError({ path: 'nombreImpreso', message: 'Envía nombreImpreso o sincronizarNombre, no ambos' })
}).required()

export type EditarCertificadoInput = yup.InferType<typeof editarCertificadoSchema>

export const generarCertificadosSchema = yup.object({
    ids: yup.array().of(id('id').required()).min(1, 'Indica al menos un certificado').max(MAX_IDS_GENERACION, `Como máximo ${MAX_IDS_GENERACION} certificados por solicitud`),
    pendientes: yup.boolean().typeError('pendientes debe ser verdadero o falso'),
    /** Cursor de `pendientes`: continúa después de este id (los que fallaron no se repiten en bucle). */
    despuesDeId: yup.number().typeError('despuesDeId debe ser un número').integer().min(0),
}).test('objetivo', 'Indica ids o pendientes: true (solo uno)', function (valor) {
    if (!valor) return true
    const conIds = Array.isArray(valor.ids)
    if (conIds !== Boolean(valor.pendientes)) return true
    return this.createError({ path: 'ids', message: 'Indica ids o pendientes: true (solo uno)' })
}).required()

export type GenerarCertificadosInput = yup.InferType<typeof generarCertificadosSchema>

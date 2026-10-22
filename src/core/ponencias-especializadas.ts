import { modalidadDe, type ModalidadAsistencia } from './catalogos'
import { fechaLima, fechaSoloDia } from './fechas'

/**
 * Reglas puras de las ponencias especializadas (spec 019 y 030): cruces de horario, duración, la
 * ventana de asistencia y quién puede inscribirse. Sin acceso a la BD para poder probarlas solas.
 */

/** Por qué una persona no puede inscribirse a las ponencias (spec 030). */
export type MotivoSinAcceso = 'NO_ENCONTRADA' | 'PAGO_PENDIENTE' | 'RECHAZADA'

export type Elegibilidad = { ok: true, modo: ModalidadAsistencia } | { ok: false, motivo: MotivoSinAcceso }

/** El correo escrito coincide con el registrado (sin distinguir mayúsculas ni espacios en los bordes). */
export function correosCoinciden(registrado: string, escrito: string): boolean {
    return registrado.trim().toLowerCase() === escrito.trim().toLowerCase()
}

/**
 * Decide con la inscripción de la persona al congreso (`null` si no existe o los datos no coinciden):
 * solo el pago aprobado da acceso, y el modo sale del tipo de inscripción (sin tipo, como una cortesía,
 * es presencial).
 */
export function resolverElegibilidad(inscripcion: { estado: string, modalidadTipo: unknown } | null): Elegibilidad {
    if (!inscripcion) return { ok: false, motivo: 'NO_ENCONTRADA' }
    if (inscripcion.estado === 'APROBADO') return { ok: true, modo: modalidadDe(inscripcion.modalidadTipo) }
    if (inscripcion.estado === 'PENDIENTE' || inscripcion.estado === 'EN_REVISION') return { ok: false, motivo: 'PAGO_PENDIENTE' }
    return { ok: false, motivo: 'RECHAZADA' }
}

export interface Ventana {
    horaInicio: Date
    horaFin: Date
}

/** Dos ponencias se cruzan si una empieza antes de que termine la otra (los extremos que se tocan no cuentan). */
export function seCruzan(a: Ventana, b: Ventana): boolean {
    return a.horaInicio < b.horaFin && b.horaInicio < a.horaFin
}

export function duracionMinutos(ventana: Ventana): number {
    return Math.round((ventana.horaFin.getTime() - ventana.horaInicio.getTime()) / 60_000)
}

/**
 * La asistencia se registra siempre, pero se marca «fuera de horario» si no es el día de la ponencia
 * o si está fuera de [inicio − tolerancia, fin] (hora de Lima). Nunca bloquea el ingreso.
 */
export function esFueraDeHorario(ahora: Date, ponencia: Ventana & { fecha: Date }, toleranciaAntesMinutos: number): boolean {
    const enOtroDia = fechaSoloDia(ponencia.fecha) !== fechaLima(ahora)
    const desde = new Date(ponencia.horaInicio.getTime() - toleranciaAntesMinutos * 60_000)
    return enOtroDia || ahora < desde || ahora > ponencia.horaFin
}

/** Ruta relativa de la landing (`/images/...`, sin `..`) o URL https: lo único que se acepta como foto del ponente. */
export function esFotoValida(foto: string): boolean {
    if (foto.length > 255 || foto.includes('..') || /\s/.test(foto)) return false
    return /^\/(?!\/)[\w./-]+$/.test(foto) || /^https:\/\/[^\s/]+\/\S*$/i.test(foto) || /^https:\/\/[^\s/]+$/i.test(foto)
}

// ─── Resumen por persona (spec 031) ─────────────────────────────────────────

/** Situación actual de una persona inscrita a ponencias frente a su inscripción al congreso. */
export type SituacionCongreso = 'APROBADO' | 'PAGO_PENDIENTE' | 'RECHAZADO' | 'NO_INSCRITO'

export const SITUACIONES_CONGRESO: readonly SituacionCongreso[] = ['APROBADO', 'PAGO_PENDIENTE', 'RECHAZADO', 'NO_INSCRITO']

/** La situación que corresponde al veredicto de `resolverElegibilidad`. */
export function situacionDe(veredicto: Elegibilidad): SituacionCongreso {
    if (veredicto.ok) return 'APROBADO'
    switch (veredicto.motivo) {
        case 'PAGO_PENDIENTE': return 'PAGO_PENDIENTE'
        case 'RECHAZADA': return 'RECHAZADO'
        default: return 'NO_INSCRITO'
    }
}

/**
 * Formas con las que puede estar guardado un documento: tal cual y, en el DNI, sin los ceros a la izquierda
 * (Excel los pierde, y los participantes importados pueden tener 7 dígitos).
 */
export function variantesDocumento(tipo: string, numero: string): string[] {
    const sinCeros = numero.replace(/^0+/, '')
    return tipo === 'dni' && sinCeros && sinCeros !== numero ? [numero, sinCeros] : [numero]
}

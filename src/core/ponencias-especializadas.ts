import { fechaLima, fechaSoloDia } from './fechas'

/**
 * Reglas puras de las ponencias especializadas (spec 019): cruces de horario, duración y la
 * ventana de asistencia. Sin acceso a la BD para poder probarlas solas.
 */

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

/**
 * Utilidades de fecha en hora de Lima (UTC-5, sin horario de verano).
 */
export const ZONA_HORARIA = 'America/Lima'
const OFFSET = '-05:00'

const formatoFecha = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' })
const formatoHora = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hour12: false })

/** Fecha `YYYY-MM-DD` en Lima para un instante dado. */
export function fechaLima(date: Date = new Date()): string {
    return formatoFecha.format(date)
}

/** Hora `HH:mm` en Lima para un instante dado. */
export function horaLima(date: Date): string {
    return formatoHora.format(date)
}

/** Instante correspondiente a una fecha y hora locales de Lima. */
export function instanteLima(fecha: string, hora = '00:00'): Date {
    return new Date(`${fecha}T${hora}:00${OFFSET}`)
}

/** Para columnas `DATE` (Prisma las devuelve a medianoche UTC). */
export function fechaSoloDia(date: Date | null | undefined): string | null {
    return date ? date.toISOString().slice(0, 10) : null
}

/** Convierte `YYYY-MM-DD` a Date UTC para columnas `DATE`. */
export function aColumnaFecha(fecha: string): Date {
    return new Date(`${fecha}T00:00:00.000Z`)
}

export const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/
export const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

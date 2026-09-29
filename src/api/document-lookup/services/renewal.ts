import type { PeriodoRenovacion } from '@prisma/client'

/** Suma meses respetando fin de mes (31-ene + 1 mes = 28/29-feb). */
function sumarMeses(fecha: Date, meses: number): Date {
    const resultado = new Date(fecha.getTime())
    const dia = resultado.getUTCDate()
    resultado.setUTCDate(1)
    resultado.setUTCMonth(resultado.getUTCMonth() + meses)
    const ultimoDia = new Date(Date.UTC(resultado.getUTCFullYear(), resultado.getUTCMonth() + 1, 0)).getUTCDate()
    resultado.setUTCDate(Math.min(dia, ultimoDia))
    return resultado
}

function avanzar(fecha: Date, periodo: PeriodoRenovacion): Date {
    switch (periodo) {
        case 'DIARIO': return new Date(fecha.getTime() + 24 * 60 * 60 * 1000)
        case 'MENSUAL': return sumarMeses(fecha, 1)
        case 'ANUAL': return sumarMeses(fecha, 12)
        default: return fecha
    }
}

/**
 * Próxima fecha de renovación estrictamente posterior a `ahora`, partiendo de la fecha de
 * renovación vencida (conserva el día de ciclo del proveedor).
 */
export function siguienteRenovacion(fechaVencida: Date, periodo: PeriodoRenovacion, ahora: Date): Date | null {
    if (periodo === 'NINGUNO') return null
    let siguiente = fechaVencida
    for (let i = 0; i < 1000 && siguiente <= ahora; i++) siguiente = avanzar(siguiente, periodo)
    return siguiente
}

/** El token alcanzó su límite local de consultas. */
export function limiteAlcanzado(token: { limiteConsultas: number | null, consultasUsadas: number }): boolean {
    return token.limiteConsultas !== null && token.consultasUsadas >= token.limiteConsultas
}

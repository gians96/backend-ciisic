import { HttpError } from './http-error'

/** Ejecuta una tarea respetando el límite de concurrencia del limitador que la envuelve. */
export type Limitador = <T>(tarea: () => Promise<T>) => Promise<T>

/** Segundos que se sugieren en `Retry-After` cuando la cola de PDF está llena. */
export const ESPERA_PDF_OCUPADO_SEGUNDOS = 10

export const errorPdfOcupado = () => new HttpError(503, 'PDF_BUSY', 'Hay muchas credenciales generándose en este momento. Intenta nuevamente en unos segundos.', undefined, ESPERA_PDF_OCUPADO_SEGUNDOS)

/**
 * Semáforo en memoria (spec 014): como mucho `max` tareas a la vez y `cola` esperando su turno, en
 * orden de llegada. Con la cola llena rechaza de inmediato con `crearError()` (por defecto 503
 * `PDF_BUSY`) sin ejecutar la tarea. Pensado para puppeteer: cada navegador ocupa cientos de MB.
 */
export function limitarConcurrencia(max = 2, cola = 30, crearError: () => Error = errorPdfOcupado): Limitador {
    let activas = 0
    const espera: Array<() => void> = []

    // Al terminar una tarea, su turno pasa directamente a la primera en espera
    const liberar = () => {
        const siguiente = espera.shift()
        if (siguiente) siguiente()
        else activas--
    }

    return async <T>(tarea: () => Promise<T>): Promise<T> => {
        if (activas < max) {
            activas++
        } else {
            if (espera.length >= cola) throw crearError()
            await new Promise<void>((resolve) => espera.push(resolve))
        }
        try {
            return await tarea()
        } finally {
            liberar()
        }
    }
}

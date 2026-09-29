import rateLimit from 'express-rate-limit'
import { env } from '../../config/env'

/**
 * Crea un limitador por IP con respuesta en el formato de error estándar.
 * En pruebas se desactiva para no acoplar los tests al orden de ejecución.
 */
export function limitador(windowMs: number, limit: number, message = 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.') {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => env.NODE_ENV === 'test',
        message: { success: false, code: 'RATE_LIMITED', message },
    })
}

const MINUTO = 60 * 1000

export const limiteLecturaPublica = limitador(MINUTO, 120)
export const limiteInscripcion = limitador(15 * MINUTO, 10, 'Demasiados intentos de inscripción. Intenta nuevamente en 15 minutos.')
export const limiteVerificacion = limitador(MINUTO, 20)
export const limiteConsultaDocumento = limitador(MINUTO, 10, 'Demasiadas consultas. Espera un minuto e inténtalo nuevamente.')
export const limitePonencias = limitador(15 * MINUTO, 10, 'Demasiados intentos. Intenta nuevamente en 15 minutos.')
export const limiteContacto = limitador(15 * MINUTO, 5, 'Demasiados mensajes. Intenta nuevamente en 15 minutos.')
export const limiteLogin = limitador(15 * MINUTO, 10, 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.')

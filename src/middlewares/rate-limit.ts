import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import { env } from '../../config/env'
import type { SitioRequest } from './sitio'
import type { AuthenticatedRequest } from './auth'

type Clave = 'ip' | 'token' | 'participante'

interface OpcionesLimite {
    /**
     * - `ip`: por visitante. En la API del sitio es la IP que reenvía el BFF de la landing
     *   (`X-Client-Ip`, aceptada solo con un token de evento válido).
     * - `token`: por token de acceso del evento. Es el tope real si un token se filtra (por
     *   ejemplo, usado desde un navegador), porque un tercero podría variar `X-Client-Ip`.
     * - `participante`: por persona en el portal del inscrito.
     */
    clave?: Clave
    /** En pruebas los límites se desactivan para no acoplar los tests al orden de ejecución. */
    omitirEnPruebas?: boolean
}

function claveDe(req: Request, clave: Clave): string {
    if (clave === 'token' && (req as SitioRequest).tokenAccesoId) return `token:${(req as SitioRequest).tokenAccesoId}`
    if (clave === 'participante' && (req as AuthenticatedRequest).participante) return `participante:${(req as AuthenticatedRequest).participante?.id}`
    return ipKeyGenerator((req as SitioRequest).clienteIp ?? req.ip ?? '')
}

/** Crea un limitador con respuesta en el formato de error estándar. */
export function limitador(windowMs: number, limit: number, message = 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.', opciones: OpcionesLimite = {}) {
    const clave = opciones.clave ?? 'ip'
    const omitir = opciones.omitirEnPruebas ?? true
    return rateLimit({
        windowMs,
        limit,
        // Los encabezados RateLimit-* describen el límite por visitante; el del token no se anuncia
        standardHeaders: clave !== 'token',
        legacyHeaders: false,
        skip: () => omitir && env.NODE_ENV === 'test',
        keyGenerator: (req) => claveDe(req, clave),
        handler: (req, res, _next, options) => {
            if (clave === 'token') console.warn(`Límite por token alcanzado (${req.method} ${req.path}, token ${(req as SitioRequest).tokenAccesoId})`)
            res.status(options.statusCode).json(options.message)
        },
        message: { success: false, code: 'RATE_LIMITED', message },
    })
}

const MINUTO = 60 * 1000
const DIA = 24 * 60 * MINUTO

// Por visitante
export const limiteLecturaPublica = limitador(MINUTO, 120)
export const limiteInscripcion = limitador(15 * MINUTO, 10, 'Demasiados intentos de inscripción. Intenta nuevamente en 15 minutos.')
export const limiteVerificacion = limitador(MINUTO, 20)
export const limiteConsultaDocumento = limitador(MINUTO, 10, 'Demasiadas consultas. Espera un minuto e inténtalo nuevamente.')
export const limitePonencias = limitador(15 * MINUTO, 10, 'Demasiados intentos. Intenta nuevamente en 15 minutos.')
export const limiteContacto = limitador(15 * MINUTO, 5, 'Demasiados mensajes. Intenta nuevamente en 15 minutos.')
export const limiteLogin = limitador(15 * MINUTO, 10, 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.')

// Por token de acceso del evento (API del sitio, spec 009)
const porToken = (windowMs: number, limit: number, message?: string) => limitador(windowMs, limit, message, { clave: 'token' })
export const limiteTokenLectura = porToken(MINUTO, 3000)
export const limiteTokenDni = porToken(MINUTO, 60, 'El sitio superó el límite de consultas DNI por minuto.')
export const limiteTokenDniDiario = porToken(DIA, 1500, 'El sitio superó el límite diario de consultas DNI.')
export const limiteTokenVerificacion = porToken(MINUTO, 50)
export const limiteTokenGoogle = porToken(MINUTO, 300)
export const limiteTokenInscripcion = porToken(15 * MINUTO, 150)
export const limiteTokenPonencias = porToken(15 * MINUTO, 60)
export const limiteTokenContacto = porToken(15 * MINUTO, 60)

// Por participante (portal del inscrito)
export const limitePortal = limitador(MINUTO, 60, undefined, { clave: 'participante' })
export const limiteCredencialPortal = limitador(MINUTO, 10, 'Demasiadas descargas. Espera un minuto.', { clave: 'participante' })

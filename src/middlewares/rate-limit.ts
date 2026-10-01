import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import { env } from '../../config/env'
import type { SitioRequest } from './sitio'
import type { AuthenticatedRequest } from './auth'

type Clave = 'ip' | 'token' | 'participante' | 'actor' | 'global'

interface OpcionesLimite {
    /**
     * - `ip`: por visitante. En la API del sitio es la IP que reenvía el BFF de la landing
     *   (`X-Client-Ip`, aceptada solo con un token de evento válido).
     * - `token`: por token de acceso del evento. Es el tope real si un token se filtra (por
     *   ejemplo, usado desde un navegador), porque un tercero podría variar `X-Client-Ip`.
     * - `participante`: por persona en el portal del inscrito.
     * - `actor`: por cuenta de staff (va después de la guarda, que deja `req.actor`).
     * - `global`: una sola cuenta para todas las peticiones de la ruta (tope de una ruta pública
     *   frente a muchas IP); va después del límite por IP para que una IP cortada no lo consuma.
     */
    clave?: Clave
    /** En pruebas los límites se desactivan para no acoplar los tests al orden de ejecución. */
    omitirEnPruebas?: boolean
    /** Peticiones que no cuentan para el límite. */
    exenta?: (req: Request) => boolean
}

function claveDe(req: Request, clave: Clave): string {
    if (clave === 'global') return 'global'
    if (clave === 'token' && (req as SitioRequest).tokenAccesoId) return `token:${(req as SitioRequest).tokenAccesoId}`
    if (clave === 'participante' && (req as AuthenticatedRequest).participante) return `participante:${(req as AuthenticatedRequest).participante?.id}`
    if (clave === 'actor' && (req as AuthenticatedRequest).actor) return `actor:${(req as AuthenticatedRequest).actor?.id}`
    return ipKeyGenerator((req as SitioRequest).clienteIp ?? req.ip ?? '')
}

/** Crea un limitador con respuesta en el formato de error estándar. */
export function limitador(windowMs: number, limit: number, message = 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.', opciones: OpcionesLimite = {}) {
    const clave = opciones.clave ?? 'ip'
    const omitir = opciones.omitirEnPruebas ?? true
    return rateLimit({
        windowMs,
        limit,
        // Los encabezados RateLimit-* describen el límite por visitante; los del token y el global no se anuncian
        standardHeaders: clave !== 'token' && clave !== 'global',
        legacyHeaders: false,
        skip: (req) => (omitir && env.NODE_ENV === 'test') || Boolean(opciones.exenta?.(req)),
        keyGenerator: (req) => claveDe(req, clave),
        handler: (req, res, _next, options) => {
            if (clave === 'token') console.warn(`Límite por token alcanzado (${req.method} ${req.path}, token ${(req as SitioRequest).tokenAccesoId})`)
            if (clave === 'global') console.warn(`Límite global alcanzado (${req.method} ${req.route?.path ?? 'ruta'})`)
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
/** Inicio de sesión con contraseña. */
export const limiteLogin = limitador(15 * MINUTO, 10, 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.')
/**
 * Inicio de sesión con Google (spec 014): más alto que el de contraseña porque el token lo firma
 * Google y muchas personas entran desde la misma red (UNDC) el día del evento.
 */
export const limiteLoginGoogle = limitador(15 * MINUTO, 120, 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.')
/** Código de acceso al portal por correo (spec 014); los topes por correo van en la BD. */
export const limiteSolicitudCodigo = limitador(15 * MINUTO, 60, 'Demasiadas solicitudes de código. Intenta nuevamente en 15 minutos.')
export const limiteVerificacionCodigo = limitador(15 * MINUTO, 120, 'Demasiados intentos de verificación. Intenta nuevamente en 15 minutos.')

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
export const limiteFotoPortal = limitador(60 * MINUTO, 10, 'Demasiados cambios de foto. Intenta nuevamente en una hora.', { clave: 'participante' })

// Por cuenta de staff (spec 013)
/**
 * Las cuentas globales ya ven todas las inscripciones: el límite de marcado frena el sondeo de
 * documentos desde cuentas por evento y no debe cortar a varias estaciones de entrada que compartan
 * una cuenta de Owner o Administrador.
 */
export const esCuentaGlobal = (req: Request) => (req as AuthenticatedRequest).actor?.alcance === 'GLOBAL'
export const limiteMarcarAsistencia = limitador(MINUTO, 120, 'Demasiados registros de asistencia seguidos. Espera un momento.', { clave: 'actor', exenta: esCuentaGlobal })
export const limiteReenvioCredencial = limitador(15 * MINUTO, 20, 'Demasiados reenvíos de credencial. Intenta nuevamente en 15 minutos.', { clave: 'actor' })
export const limiteRenovacionSesion = limitador(15 * MINUTO, 30, undefined, { clave: 'actor' })
/** Paso del staff a su portal de participante (`POST /v1/auth/participant/switch`, spec 014). */
export const limiteSwitch = limitador(15 * MINUTO, 20, 'Demasiados cambios de perfil. Intenta nuevamente en 15 minutos.', { clave: 'actor' })
/**
 * Carga de certificados firmados (spec 015): el panel envía tandas de ≤10 archivos y ≤25 MB una
 * tras otra; cada tanda carga los PDF en memoria y los analiza, así que el tope es por cuenta.
 */
export const limiteCargaFirmados = limitador(MINUTO, 30, 'Demasiadas cargas de firmados seguidas. Espera un minuto.', { clave: 'actor' })

/**
 * Tope global de fallos en una ventana fija (en memoria, por proceso). A diferencia de un limitador
 * global, no corta a quien acierta: solo cuentan los fallos (p. ej. códigos que no existen), así que
 * muchas IP recorriendo códigos no dejan sin servicio a quien verifica uno real.
 */
export interface TopeDeFallos {
    /** Cuenta un fallo; `true` si con él se superó el tope de la ventana. */
    registrar(): boolean
    /** Segundos que faltan para que se abra la ventana siguiente. */
    segundosRestantes(): number
}

export function topeDeFallos(windowMs: number, limit: number, ahora: () => number = Date.now): TopeDeFallos {
    let inicio = Number.NEGATIVE_INFINITY
    let fallos = 0
    return {
        registrar() {
            const t = ahora()
            if (t - inicio >= windowMs) {
                inicio = t
                fallos = 0
            }
            fallos++
            return fallos > limit
        },
        segundosRestantes() {
            return Math.max(1, Math.ceil((inicio + windowMs - ahora()) / 1000))
        },
    }
}

// Verificación pública de certificados (spec 015, `/v1/public/*`): por IP y un tope global de códigos
// que no existen (`topeFallosVerificacion`, en el servicio) para que muchas IP no puedan recorrer
// códigos. El BFF del panel reenvía la IP real.
export const limiteVerificacionCertificado = limitador(MINUTO, 30, 'Demasiadas verificaciones. Espera un minuto e inténtalo nuevamente.')
export const topeFallosVerificacion = topeDeFallos(MINUTO, 1200)

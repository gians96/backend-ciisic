import { Request, Response, NextFunction, RequestHandler } from 'express'
import { prisma } from '../database/prisma'
import { actorDeSesion, usuarioDeActor, type Actor } from '../core/actor'
import { ALCANCE, type Permiso } from '../core/permisos'
import type { ResolutorEvento } from '../core/resolutores-evento'
import {
    AUDIENCIA_ADMIN,
    AUDIENCIA_PARTICIPANTE,
    audienciaDe,
    verificarSesion,
    type CargaSesion,
    type MetodoSesion,
    type ParticipanteSesion,
    type UsuarioSesion,
} from '../core/sesiones'

export type UserData = UsuarioSesion

export interface AuthenticatedRequest extends Request {
    user?: UserData
    participante?: ParticipanteSesion
    /** Cuenta de staff leída de la BD en esta petición (spec 013). */
    actor?: Actor
    metodoSesion?: MetodoSesion
    /** JWT del staff ya verificado (y su huella comprobada contra la BD). */
    sesion?: CargaSesion
}

type Resultado = { carga: CargaSesion } | { status: number, code: string, message: string }

/** Lee y verifica el Bearer. No decide la audiencia (eso lo hace cada guarda). */
function leerSesion(req: Request): Resultado {
    const authHeader = req.headers.authorization
    if (!authHeader) return { status: 401, code: 'MISSING_TOKEN', message: 'Falta el token de autorización' }
    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !token) return { status: 401, code: 'INVALID_TOKEN_FORMAT', message: 'Formato de token inválido' }
    try {
        return { carga: verificarSesion(token) }
    } catch {
        return { status: 401, code: 'INVALID_TOKEN', message: 'Token inválido o expirado' }
    }
}

function responder(res: Response, error: { status: number, code: string, message: string }) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message })
}

const PROHIBIDO = { status: 403, code: 'FORBIDDEN', message: 'No tiene permisos para realizar esta operación' }
const SESION_INVALIDADA = { status: 401, code: 'SESSION_INVALIDATED', message: 'Tu sesión ya no es válida. Ingresa nuevamente.' }
const EVENTO_NO_ASIGNADO = { status: 403, code: 'EVENT_NOT_ASSIGNED', message: 'No tienes asignado este evento.' }
const NO_ENCONTRADO = { status: 404, code: 'NOT_FOUND', message: 'El registro solicitado no existe.' }

/** Deja en la petición la cuenta fresca de la BD y la sesión con la que llegó. */
function dejarActor(req: AuthenticatedRequest, actor: Actor, carga: CargaSesion) {
    req.actor = actor
    req.user = usuarioDeActor(actor)
    req.metodoSesion = carga.metodo
    req.sesion = carga
}

export interface OpcionesPermiso {
    /** Evento del recurso: obligatorio si algún permiso es por evento (salvo `filtraPorActor`). */
    evento?: ResolutorEvento
    /** El controlador filtra por los eventos del actor (listas sin evento en la ruta). */
    filtraPorActor?: boolean
}

/** Metadatos de la guarda: la prueba de la matriz de rutas los lee de cada middleware. */
export interface GuardaPermiso {
    permisos: readonly Permiso[]
    evento?: string
    filtraPorActor: boolean
}

export type MiddlewarePermiso = RequestHandler & { guarda: GuardaPermiso }

/**
 * Exige una sesión de staff con AL MENOS UNO de los permisos indicados (spec 013). La cuenta se lee
 * de la BD en cada petición: rol, estado, eventos asignados y permisos siempre están al día, y la
 * huella del JWT debe coincidir con sus credenciales actuales (`actorDeSesion`).
 *
 * Con una cuenta por evento (Tesorero, Comisión) y un permiso por evento, resuelve el evento del
 * recurso y responde 403 `EVENT_NOT_ASSIGNED` si no es suyo (404 si el recurso no existe).
 */
export function requirePermiso(requeridos: Permiso | readonly Permiso[], opciones: OpcionesPermiso = {}): MiddlewarePermiso {
    const permisos: readonly Permiso[] = Array.isArray(requeridos) ? requeridos : [requeridos as Permiso]
    if (!permisos.length) throw new Error('requirePermiso necesita al menos un permiso')
    const porEvento = permisos.some((p) => ALCANCE[p] === 'E')
    if (porEvento && !opciones.evento && !opciones.filtraPorActor) {
        throw new Error(`requirePermiso(${permisos.join(', ')}): un permiso por evento necesita 'evento' o 'filtraPorActor'`)
    }

    const handler = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const resultado = leerSesion(req)
            if (!('carga' in resultado)) return responder(res, resultado)
            const { carga } = resultado
            if (audienciaDe(carga) !== AUDIENCIA_ADMIN || !carga.user) return responder(res, PROHIBIDO)
            const actor = await actorDeSesion(carga.user.id, carga.huella)
            if (!actor) return responder(res, SESION_INVALIDADA)
            const permitidos = permisos.filter((p) => actor.permisos.has(p))
            if (!permitidos.length) return responder(res, PROHIBIDO)
            // Las cuentas globales ven todos los eventos; las por evento solo tienen permisos por
            // evento, así que su acceso depende del evento del recurso.
            if (actor.alcance === 'EVENTO' && opciones.evento) {
                const eventoId = await opciones.evento(req)
                if (eventoId === null) return responder(res, NO_ENCONTRADO)
                if (!actor.eventoIds.includes(eventoId)) return responder(res, EVENTO_NO_ASIGNADO)
            }
            dejarActor(req, actor, carga)
            next()
        } catch (error) {
            next(error)
        }
    }
    return Object.assign(handler as RequestHandler, {
        guarda: { permisos, evento: opciones.evento?.nombre, filtraPorActor: Boolean(opciones.filtraPorActor) },
    })
}

/** Cualquier cuenta de staff activa; el controlador decide con `req.actor` (listas filtradas, sesión). */
export const requireActor: MiddlewarePermiso = Object.assign(
    (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const resultado = leerSesion(req)
            if (!('carga' in resultado)) return responder(res, resultado)
            const { carga } = resultado
            if (audienciaDe(carga) !== AUDIENCIA_ADMIN || !carga.user) return responder(res, PROHIBIDO)
            const actor = await actorDeSesion(carga.user.id, carga.huella)
            if (!actor) return responder(res, SESION_INVALIDADA)
            dejarActor(req, actor, carga)
            next()
        } catch (error) {
            next(error)
        }
    }) as RequestHandler,
    { guarda: { permisos: [] as readonly Permiso[], filtraPorActor: true } },
)

/**
 * Exige una sesión de participante (portal del inscrito). Comprueba además que la persona siga
 * existiendo con el mismo correo: si un administrador lo cambió, la sesión deja de valer.
 */
export async function requireParticipante(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const resultado = leerSesion(req)
    if (!('carga' in resultado)) return responder(res, resultado)
    const { carga } = resultado
    if (audienciaDe(carga) !== AUDIENCIA_PARTICIPANTE || !carga.participante) return responder(res, PROHIBIDO)
    const actual = await prisma.participante.findUnique({ where: { id: carga.participante.id }, select: { correo: true } })
    if (!actual || actual.correo.toLowerCase() !== carga.participante.correo.toLowerCase()) {
        return responder(res, { status: 401, code: 'SESSION_INVALIDATED', message: 'Tu sesión ya no es válida. Ingresa nuevamente.' })
    }
    req.participante = carga.participante
    next()
}

/**
 * Acepta cualquiera de los dos perfiles (solo para consultar la sesión). Con una sesión de staff lee
 * la cuenta de la BD como las demás guardas (401 `SESSION_INVALIDATED` si ya no vale).
 */
export async function requireSesion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const resultado = leerSesion(req)
        if (!('carga' in resultado)) return responder(res, resultado)
        const { carga } = resultado
        const audiencia = audienciaDe(carga)
        if (audiencia === AUDIENCIA_ADMIN && carga.user) {
            const actor = await actorDeSesion(carga.user.id, carga.huella)
            if (!actor) return responder(res, SESION_INVALIDADA)
            dejarActor(req, actor, carga)
        } else if (audiencia === AUDIENCIA_PARTICIPANTE && carga.participante) req.participante = carga.participante
        else return responder(res, PROHIBIDO)
        next()
    } catch (error) {
        next(error)
    }
}

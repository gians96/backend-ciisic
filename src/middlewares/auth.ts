import { Request, Response, NextFunction } from 'express'
import type { CodigoRol } from '../core/catalogos'
import { prisma } from '../database/prisma'
import {
    AUDIENCIA_ADMIN,
    AUDIENCIA_PARTICIPANTE,
    audienciaDe,
    verificarSesion,
    type CargaSesion,
    type ParticipanteSesion,
    type UsuarioSesion,
} from '../core/sesiones'

export type UserData = UsuarioSesion

export interface AuthenticatedRequest extends Request {
    user?: UserData
    participante?: ParticipanteSesion
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

/** Exige una sesión de administrador cuyo rol esté entre los permitidos (por código). */
export function requireRoles(...allowedRoles: CodigoRol[]) {
    return function authorize(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        const resultado = leerSesion(req)
        if (!('carga' in resultado)) return responder(res, resultado)
        const { carga } = resultado
        // Un token válido de otro perfil (participante) no da acceso: 403, no 401
        if (audienciaDe(carga) !== AUDIENCIA_ADMIN || !carga.user || !allowedRoles.includes(carga.user.rolCodigo)) {
            return responder(res, PROHIBIDO)
        }
        req.user = carga.user
        next()
    }
}

export const verifyAdminRole = requireRoles('SUPERADMIN', 'ADMIN')
export const verifySuperAdminRole = requireRoles('SUPERADMIN')

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

/** Acepta cualquiera de los dos perfiles (solo para consultar la sesión). */
export function requireSesion(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const resultado = leerSesion(req)
    if (!('carga' in resultado)) return responder(res, resultado)
    const { carga } = resultado
    const audiencia = audienciaDe(carga)
    if (audiencia === AUDIENCIA_ADMIN && carga.user) req.user = carga.user
    else if (audiencia === AUDIENCIA_PARTICIPANTE && carga.participante) req.participante = carga.participante
    else return responder(res, PROHIBIDO)
    next()
}

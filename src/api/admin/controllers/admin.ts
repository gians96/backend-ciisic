import { Request, Response } from 'express'
import { HttpError, idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { createAdmin, deleteAdmin, getAdminById, getAdmins, loginAdmin, renovarSesion, updateAdmin, usuarioConAcceso } from '../services/admin'

const sesionInvalidada = () => new HttpError(401, 'SESSION_INVALIDATED', 'Tu sesión ya no es válida. Ingresa nuevamente.')

/** La guarda (`requirePermiso`, `requireActor` o `requireSesion`) deja la cuenta leída de la BD en `req.actor`. */
function actorDe(req: AuthenticatedRequest): Actor {
    if (!req.actor) throw sesionInvalidada()
    return req.actor
}

export async function list(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await getAdmins(actorDe(req)) })
}

export async function create(req: AuthenticatedRequest, res: Response) {
    res.status(201).json({ success: true, data: await createAdmin(req.body, actorDe(req)) })
}

export async function find(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await getAdminById(idParam(req.params.id), actorDe(req)) })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await updateAdmin(idParam(req.params.id), req.body, actorDe(req)) })
}

export async function remove(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await deleteAdmin(idParam(req.params.id), actorDe(req)) })
}

export async function login(req: Request, res: Response) {
    const correo = req.body.correo || req.body.correoElectronico
    const { jwt, usuario, expiraEn } = await loginAdmin(correo, req.body.contrasena)
    res.json({ jwt, usuario, expiraEn, tipo: 'ADMIN' })
}

/**
 * Sesión actual: administrador (`user`, forma anterior más `acceso`) o participante del portal.
 * Los datos del staff se leen de la BD (`requireSesion`): el JWT puede traer un rol o un nombre
 * desactualizado.
 */
export async function session(req: AuthenticatedRequest, res: Response) {
    if (req.participante) {
        res.json({ success: true, tipo: 'PARTICIPANTE', participante: req.participante })
        return
    }
    res.json({ success: true, tipo: 'ADMIN', user: await usuarioConAcceso(actorDe(req)) })
}

/** Renueva el JWT del staff (spec 013) conservando el método y el inicio de la sesión. */
export async function refresh(req: AuthenticatedRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    if (!req.sesion) throw sesionInvalidada()
    res.json({ success: true, data: await renovarSesion(actorDe(req), req.sesion) })
}

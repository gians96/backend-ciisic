import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { createAdmin, deleteAdmin, getAdminById, getAdmins, loginAdmin, updateAdmin } from '../services/admin'

export async function list(_req: Request, res: Response) {
    res.json({ success: true, data: await getAdmins() })
}

export async function create(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await createAdmin(req.body) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await getAdminById(idParam(req.params.id)) })
}

export async function update(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await updateAdmin(idParam(req.params.id), req.body, req.user?.id) })
}

export async function remove(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await deleteAdmin(idParam(req.params.id), req.user?.id) })
}

export async function login(req: Request, res: Response) {
    const correo = req.body.correo || req.body.correoElectronico
    const { jwt, usuario, expiraEn } = await loginAdmin(correo, req.body.contrasena)
    res.json({ jwt, usuario, expiraEn })
}

export function session(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, user: req.user })
}

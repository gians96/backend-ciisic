import { Request, Response, NextFunction } from 'express'
import jwt, { JwtPayload as DefaultJwtPayload } from 'jsonwebtoken'
import { env } from '../../config/env'
import type { CodigoRol } from '../core/catalogos'

const JWT_SECRET = env.JWT_SECRET

export interface UserData {
    id: number
    nombres: string
    apellidos: string
    correo: string
    rolId: number
    rolCodigo: CodigoRol
    rolNombre: string
}

interface CustomJwtPayload extends DefaultJwtPayload {
    user: UserData
}

export interface AuthenticatedRequest extends Request {
    user?: UserData
}

/** Exige un JWT de administrador cuyo rol esté entre los permitidos (por código). */
export function requireRoles(...allowedRoles: CodigoRol[]) {
    return function authorize(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        const authHeader = req.headers.authorization

        if (!authHeader) {
            res.status(401).json({ success: false, code: 'MISSING_TOKEN', message: 'Falta el token de autorización' })
            return
        }

        const [scheme, token] = authHeader.split(' ')

        if (scheme !== 'Bearer' || !token) {
            res.status(401).json({ success: false, code: 'INVALID_TOKEN_FORMAT', message: 'Formato de token inválido' })
            return
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as CustomJwtPayload

            if (!decoded.user || !allowedRoles.includes(decoded.user.rolCodigo)) {
                res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'No tiene permisos para realizar esta operación' })
                return
            }

            req.user = decoded.user

            next()
        } catch {
            res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Token inválido o expirado' })
        }
    }
}

export const verifyAdminRole = requireRoles('SUPERADMIN', 'ADMIN')
export const verifySuperAdminRole = requireRoles('SUPERADMIN')

import jwt from 'jsonwebtoken'

/** JWT de administrador para pruebas (mismo formato que emite `/v1/auth/login`). */
export function tokenDeRol(rolCodigo: 'SUPERADMIN' | 'ADMIN', id = 1): string {
    return jwt.sign({
        user: { id, nombres: 'Test', apellidos: 'Admin', correo: 'admin@example.com', rolId: rolCodigo === 'SUPERADMIN' ? 1 : 2, rolCodigo, rolNombre: rolCodigo },
    }, process.env.JWT_SECRET as string, { algorithm: 'HS256', expiresIn: '1h' })
}

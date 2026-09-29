import { firmarSesionAdmin, firmarSesionParticipante } from '../../src/core/sesiones'

/** JWT de administrador para pruebas (mismo formato que emite `/v1/auth/login`). */
export function tokenDeRol(rolCodigo: 'SUPERADMIN' | 'ADMIN', id = 1): string {
    return firmarSesionAdmin({
        id, nombres: 'Test', apellidos: 'Admin', correo: 'admin@example.com', rolId: rolCodigo === 'SUPERADMIN' ? 1 : 2, rolCodigo, rolNombre: rolCodigo,
    }, 'PASSWORD').jwt
}

/** JWT de participante (portal del inscrito). */
export function tokenDeParticipante(id = 50, correo = 'ana@gmail.com'): string {
    return firmarSesionParticipante({ id, nombres: 'Ana', apellidos: 'Pérez', correo }).jwt
}

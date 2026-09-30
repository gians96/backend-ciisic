import { firmarSesionAdmin, firmarSesionParticipante, huellaCredenciales, type MetodoSesion } from '../../src/core/sesiones'
import { ROLES, type CodigoRol } from '../../src/core/catalogos'
import { registrarActor, type OpcionesActor } from './actores'

/** Id por defecto de cada rol, para que un mismo archivo pueda mezclar roles sin chocar. */
const ID_POR_ROL: Record<CodigoRol, number> = { SUPERADMIN: 1, ADMIN: 2, TESORERO: 30, COMISION: 40 }

export interface OpcionesToken extends OpcionesActor {
    metodo?: MetodoSesion
    /** Inicio de la sesión (segundos); por defecto, ahora. */
    authTime?: number
}

/**
 * JWT de staff para pruebas (mismo formato que emite `/v1/auth/login`, con la huella de la cuenta).
 * Además registra la cuenta que la guarda leerá de la «BD» (ver `tests/setup-actor.ts`).
 */
export function tokenDeRol(rolCodigo: CodigoRol, id = ID_POR_ROL[rolCodigo], opciones: OpcionesToken = {}): string {
    const fila = registrarActor(id, rolCodigo, opciones)
    return firmarSesionAdmin({
        id, nombres: fila.nombres, apellidos: fila.apellidos, correo: fila.correo, rolId: ROLES.indexOf(rolCodigo) + 1, rolCodigo, rolNombre: fila.rol.nombre,
    }, { metodo: opciones.metodo ?? 'PASSWORD', huella: huellaCredenciales(fila), authTime: opciones.authTime }).jwt
}

/** JWT de participante (portal del inscrito). */
export function tokenDeParticipante(id = 50, correo = 'ana@gmail.com'): string {
    return firmarSesionParticipante({ id, nombres: 'Ana', apellidos: 'Pérez', correo }).jwt
}

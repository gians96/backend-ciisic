import { esCodigoRol, type CodigoRol } from './catalogos'
import { consultarActor, type FilaActor } from './actor-consulta'
import { alcanceDeRol, permisosEfectivos, type AlcanceRol, type Permiso } from './permisos'
import { huellaCredenciales, type UsuarioSesion } from './sesiones'

/**
 * Cuenta de staff tal como está en la BD en este momento (spec 013). Las guardas la cargan en cada
 * petición, así que un cambio de rol, de eventos, de permisos o una desactivación aplica al instante.
 */
export interface Actor {
    id: number
    nombres: string
    apellidos: string
    correo: string
    rolId: number
    rolCodigo: CodigoRol
    rolNombre: string
    alcance: AlcanceRol
    permisos: ReadonlySet<Permiso>
    /** Eventos asignados. Vacío para las cuentas globales, que ven todos. */
    eventoIds: readonly number[]
}

/** Acceso que el panel recibe en la sesión para armar menús y botones. */
export interface AccesoPublico {
    alcance: AlcanceRol
    permisos: Permiso[]
    /** `null` en las cuentas globales (todos los eventos). */
    eventoIds: number[] | null
}

/** `null` si la cuenta está inactiva o tiene un rol desconocido: la sesión deja de valer. */
export function actorDesdeFila(fila: FilaActor | null): Actor | null {
    if (!fila || !fila.activo || !esCodigoRol(fila.rol.codigo)) return null
    const rolCodigo = fila.rol.codigo
    const alcance = alcanceDeRol(rolCodigo)
    return {
        id: fila.id,
        nombres: fila.nombres,
        apellidos: fila.apellidos,
        correo: fila.correo,
        rolId: fila.rolId,
        rolCodigo,
        rolNombre: fila.rol.nombre,
        alcance,
        permisos: permisosEfectivos(rolCodigo, fila.permisos.map((p) => p.permiso)),
        eventoIds: alcance === 'EVENTO' ? fila.asignacionesEvento.map((a) => a.eventoId) : [],
    }
}

export async function cargarActor(id: number): Promise<Actor | null> {
    return actorDesdeFila(await consultarActor(id))
}

/**
 * Cuenta de una sesión del staff. `null` si la sesión ya no vale: además de los casos de
 * `actorDesdeFila`, si el correo, la contraseña o la cuenta Google cambiaron desde que se firmó el
 * JWT (la huella no coincide) o si el JWT no trae huella (emitido antes de la spec 013).
 */
export async function actorDeSesion(id: number, huella: string | undefined): Promise<Actor | null> {
    const fila = await consultarActor(id)
    if (!fila || !huella || huella !== huellaCredenciales(fila)) return null
    return actorDesdeFila(fila)
}

export function tienePermiso(actor: Actor, permiso: Permiso): boolean {
    return actor.permisos.has(permiso)
}

/** Si el actor puede operar en ese evento (las cuentas globales, en todos). */
export function puedeEnEvento(actor: Actor, eventoId: number): boolean {
    return actor.alcance === 'GLOBAL' || actor.eventoIds.includes(eventoId)
}

export function accesoPublico(actor: Actor): AccesoPublico {
    return {
        alcance: actor.alcance,
        permisos: [...actor.permisos].sort(),
        eventoIds: actor.alcance === 'GLOBAL' ? null : [...actor.eventoIds].sort((a, b) => a - b),
    }
}

/** Datos de sesión frescos (los del JWT pueden estar desactualizados hasta que caduque). */
export function usuarioDeActor(actor: Actor): UsuarioSesion {
    return {
        id: actor.id,
        nombres: actor.nombres,
        apellidos: actor.apellidos,
        correo: actor.correo,
        rolId: actor.rolId,
        rolCodigo: actor.rolCodigo,
        rolNombre: actor.rolNombre,
    }
}

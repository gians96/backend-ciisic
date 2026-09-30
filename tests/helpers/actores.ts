import type { FilaActor } from '../../src/core/actor-consulta'
import { ROLES, type CodigoRol } from '../../src/core/catalogos'

/**
 * Registro en memoria de las cuentas de staff que ven las guardas en las pruebas (spec 013).
 * `tests/setup-actor.ts` simula `consultarActor` con este registro; `tokenDeRol` registra la cuenta
 * al firmar su token.
 */
const registro = new Map<number, FilaActor>()

export interface OpcionesActor {
    eventoIds?: number[]
    permisos?: string[]
    activo?: boolean
    correo?: string
    /** Credenciales: cambiarlas invalida los tokens firmados antes (huella de la sesión). */
    contrasenaHash?: string | null
    googleSub?: string | null
}

const NOMBRES: Record<CodigoRol, string> = {
    SUPERADMIN: 'Owner',
    ADMIN: 'Administrador del sistema',
    TESORERO: 'Tesorero',
    COMISION: 'Comisión tecnológica',
}

export function filaActor(id: number, rolCodigo: CodigoRol, opciones: OpcionesActor = {}): FilaActor {
    const rolId = ROLES.indexOf(rolCodigo) + 1
    const ahora = new Date('2026-09-30T12:00:00.000Z')
    return {
        id,
        nombres: 'Test',
        apellidos: NOMBRES[rolCodigo],
        correo: opciones.correo ?? `staff${id}@example.com`,
        contrasenaHash: opciones.contrasenaHash ?? null,
        creadoEn: ahora,
        actualizadoEn: ahora,
        rolId,
        activo: opciones.activo ?? true,
        googleSub: opciones.googleSub ?? null,
        googleVinculadoEn: null,
        rol: { id: rolId, codigo: rolCodigo, nombre: NOMBRES[rolCodigo] },
        asignacionesEvento: (opciones.eventoIds ?? []).map((eventoId) => ({ eventoId })),
        permisos: (opciones.permisos ?? []).map((permiso) => ({ permiso })),
    }
}

/** Registra (o reemplaza) la cuenta. Un id ya usado con otro rol es un error de la prueba. */
export function registrarActor(id: number, rolCodigo: CodigoRol, opciones: OpcionesActor = {}): FilaActor {
    const previa = registro.get(id)
    if (previa && previa.rol.codigo !== rolCodigo) {
        throw new Error(`El id ${id} ya está registrado con el rol ${previa.rol.codigo}; usa otro id para ${rolCodigo}.`)
    }
    const fila = filaActor(id, rolCodigo, opciones)
    registro.set(id, fila)
    return fila
}

export function actorRegistrado(id: number): FilaActor | null {
    return registro.get(id) ?? null
}

/** Quita la cuenta (simula que fue borrada). */
export function olvidarActor(id: number) {
    registro.delete(id)
}

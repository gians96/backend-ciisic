import { ROL, type CodigoRol } from './catalogos'

/**
 * Catálogo de permisos del staff (spec 013). Cada ruta protegida declara los permisos que acepta
 * (`requirePermiso`) y el panel usa los mismos códigos para menús y botones.
 *
 * Alcance:
 * - `G` (global): solo lo tienen los roles globales (Owner y Administrador del sistema).
 * - `E` (por evento): una cuenta con eventos asignados (Tesorero, Comisión) lo ejerce solo en esos
 *   eventos; la ruta debe resolver el evento del recurso o filtrar por actor.
 */
export const ALCANCE = {
    'sistema.configurar': 'G',
    'administradores.gestionar': 'G',
    'eventos.configurar': 'G',
    'eventos.eliminar': 'G',
    'catalogos.configurar': 'G',
    'correo.configurar': 'G',
    'consultas_dni.gestionar': 'G',
    'participantes.gestionar': 'G',
    'inscripciones.eliminar': 'G',
    'inscripciones.cancelar': 'G',
    'inscripciones.cortesia': 'G',
    'legacy.usar': 'G',
    'certificados.gestionar': 'G',

    'resumen.ver': 'E',
    'inscripciones.ver': 'E',
    'inscripciones.exportar': 'E',
    'credenciales.reenviar': 'E',
    'pagos.ver': 'E',
    'inscripciones.validar': 'E',
    'asistencia.ver': 'E',
    'asistencia.exportar': 'E',
    'asistencia.marcar': 'E',
    'asistencia.anular': 'E',
    'asistencia.fuera_horario': 'E',
    'ponencias.ver': 'E',
    'mensajes.ver': 'E',
    'mensajes.eliminar': 'E',
    'certificados.ver': 'E',
    'certificados.operar': 'E',
} as const

export type Permiso = keyof typeof ALCANCE
export const PERMISOS = Object.keys(ALCANCE) as Permiso[]

export function esPermiso(valor: unknown): valor is Permiso {
    return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(ALCANCE, valor)
}

/** Nombre visible y explicación corta (el panel los muestra al elegir permisos de la Comisión). */
export const ETIQUETAS_PERMISO: Record<Permiso, string> = {
    'sistema.configurar': 'Configurar el sistema (Google, API_UNDC, legacy)',
    'administradores.gestionar': 'Gestionar el equipo y los administradores',
    'eventos.configurar': 'Configurar eventos, tipos, actividades e integraciones',
    'eventos.eliminar': 'Eliminar eventos',
    'catalogos.configurar': 'Configurar catálogos',
    'correo.configurar': 'Configurar credenciales de correo',
    'consultas_dni.gestionar': 'Consultas DNI y su pool de tokens',
    'participantes.gestionar': 'Crear y editar participantes',
    'inscripciones.eliminar': 'Eliminar inscripciones',
    'inscripciones.cancelar': 'Cancelar inscripciones',
    'inscripciones.cortesia': 'Registrar inscripciones de cortesía',
    'legacy.usar': 'Usar las rutas de la versión anterior',
    'certificados.gestionar': 'Gestionar plantillas y emitir certificados',

    'resumen.ver': 'Ver el resumen del evento',
    'inscripciones.ver': 'Ver inscritos (nombre, documento, correo y celular)',
    'inscripciones.exportar': 'Exportar inscritos a CSV',
    'credenciales.reenviar': 'Reenviar la credencial por correo',
    'pagos.ver': 'Ver montos, pagos y vouchers',
    'inscripciones.validar': 'Aprobar, rechazar o poner en revisión',
    'asistencia.ver': 'Ver la asistencia',
    'asistencia.exportar': 'Exportar la asistencia',
    'asistencia.marcar': 'Marcar asistencia',
    'asistencia.anular': 'Anular una asistencia marcada',
    'asistencia.fuera_horario': 'Marcar asistencia fuera del horario de la actividad',
    'ponencias.ver': 'Ver y descargar ponencias',
    'mensajes.ver': 'Ver mensajes de contacto',
    'mensajes.eliminar': 'Eliminar mensajes de contacto',
    'certificados.ver': 'Ver certificados',
    'certificados.operar': 'Generar, descargar para firmar y subir certificados firmados',
}

/** Un permiso implica otros: se aplican al guardar y al cargar al actor. */
export const DEPENDENCIAS: Partial<Record<Permiso, readonly Permiso[]>> = {
    'inscripciones.exportar': ['inscripciones.ver'],
    'credenciales.reenviar': ['inscripciones.ver'],
    'pagos.ver': ['inscripciones.ver'],
    'inscripciones.validar': ['pagos.ver'],
    'asistencia.exportar': ['asistencia.ver'],
    'asistencia.marcar': ['asistencia.ver'],
    'asistencia.anular': ['asistencia.ver'],
    'asistencia.fuera_horario': ['asistencia.marcar'],
    'mensajes.eliminar': ['mensajes.ver'],
    'certificados.operar': ['certificados.ver'],
}

const TODOS = PERMISOS

/** Permisos fijos del Tesorero: todo lo operativo del congreso en sus eventos, incluida la validación de pagos. */
const PERMISOS_TESORERO: readonly Permiso[] = [
    'resumen.ver',
    'inscripciones.ver',
    'inscripciones.exportar',
    'credenciales.reenviar',
    'pagos.ver',
    'inscripciones.validar',
    'asistencia.ver',
    'asistencia.exportar',
    'ponencias.ver',
    'mensajes.ver',
    'certificados.ver',
]

/**
 * Permisos que un Owner o Administrador puede marcar para una cuenta de la Comisión. Nunca incluye
 * pagos ni permisos globales. Los de certificados se habilitan con la spec 015.
 */
export const PERMISOS_ELEGIBLES_COMISION: readonly Permiso[] = [
    'asistencia.marcar',
    'asistencia.ver',
    'asistencia.anular',
    'asistencia.fuera_horario',
    'asistencia.exportar',
    'resumen.ver',
    'inscripciones.ver',
    'inscripciones.exportar',
    'credenciales.reenviar',
    'ponencias.ver',
    'mensajes.ver',
]

/** Permiso con el que se crea por defecto una cuenta de la Comisión. */
export const PERMISOS_COMISION_POR_DEFECTO: readonly Permiso[] = ['asistencia.marcar']

export const PERMISOS_POR_ROL: Record<CodigoRol, readonly Permiso[]> = {
    [ROL.OWNER]: TODOS,
    [ROL.ADMINISTRADOR]: TODOS.filter((p) => p !== 'sistema.configurar'),
    [ROL.TESORERO]: PERMISOS_TESORERO,
    // La Comisión no tiene permisos propios del rol: son los elegidos para cada cuenta
    [ROL.COMISION]: [],
}

/** Agrega las dependencias hasta el punto fijo. Ignora códigos desconocidos. */
export function cierre(permisos: Iterable<string>): Set<Permiso> {
    const resultado = new Set<Permiso>()
    const pendientes = [...permisos].filter(esPermiso)
    while (pendientes.length) {
        const permiso = pendientes.pop() as Permiso
        if (resultado.has(permiso)) continue
        resultado.add(permiso)
        for (const implicado of DEPENDENCIAS[permiso] ?? []) pendientes.push(implicado)
    }
    return resultado
}

/**
 * Permisos efectivos de una cuenta. Para la Comisión son los elegidos (filas de
 * `permisos_administrador`) con sus dependencias, siempre dentro de los elegibles: un permiso no
 * elegible guardado en la BD se ignora.
 */
export function permisosEfectivos(rol: CodigoRol, propios: readonly string[] = []): Set<Permiso> {
    if (rol === ROL.COMISION) {
        const elegibles = new Set(PERMISOS_ELEGIBLES_COMISION)
        return new Set([...cierre(propios.filter((p) => elegibles.has(p as Permiso)))].filter((p) => elegibles.has(p)))
    }
    return cierre(PERMISOS_POR_ROL[rol] ?? [])
}

/** Roles que un actor puede asignar y cuentas de qué roles puede ver y gestionar. */
export function rolesGestionables(rol: CodigoRol): CodigoRol[] {
    if (rol === ROL.OWNER) return [ROL.OWNER, ROL.ADMINISTRADOR, ROL.TESORERO, ROL.COMISION]
    if (rol === ROL.ADMINISTRADOR) return [ROL.TESORERO, ROL.COMISION]
    return []
}

export type AlcanceRol = 'GLOBAL' | 'EVENTO'

export function alcanceDeRol(rol: CodigoRol): AlcanceRol {
    return rol === ROL.OWNER || rol === ROL.ADMINISTRADOR ? 'GLOBAL' : 'EVENTO'
}

/**
 * Códigos estables de catálogos (columna `codigo`). El código nunca usa ids mágicos.
 */
export const ESTADOS_INSCRIPCION = ['PENDIENTE', 'EN_REVISION', 'APROBADO', 'RECHAZADO', 'CANCELADO'] as const
export type CodigoEstadoInscripcion = typeof ESTADOS_INSCRIPCION[number]

/**
 * Roles del staff (spec 013). Los códigos históricos `SUPERADMIN` y `ADMIN` se conservan en la BD
 * (se muestran como «Owner» y «Administrador del sistema»); el código los usa solo mediante `ROL`.
 */
export const ROLES = ['SUPERADMIN', 'ADMIN', 'TESORERO', 'COMISION'] as const
export type CodigoRol = typeof ROLES[number]

export const ROL = {
    OWNER: 'SUPERADMIN',
    ADMINISTRADOR: 'ADMIN',
    TESORERO: 'TESORERO',
    COMISION: 'COMISION',
} as const satisfies Record<string, CodigoRol>

/** Roles sin alcance por evento: ven y operan todos los eventos. */
export const ROLES_GLOBALES: readonly CodigoRol[] = [ROL.OWNER, ROL.ADMINISTRADOR]

export function esCodigoRol(valor: unknown): valor is CodigoRol {
    return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/** Cómo se registró una asistencia (spec 013). `null` en las filas anteriores. */
export const METODOS_ASISTENCIA = ['QR', 'QR_LEGADO', 'DOCUMENTO', 'MANUAL'] as const
export type MetodoAsistencia = typeof METODOS_ASISTENCIA[number]

export const CATEGORIA_ESTUDIANTES = 'ESTUDIANTES'
export const CATEGORIA_PUBLICO_GENERAL = 'PUBLICO_GENERAL'

/** Equivalencia con los ids históricos usados por la landing y herramientas legacy. */
export const ESTADO_POR_ID_LEGACY: Record<number, CodigoEstadoInscripcion> = {
    1: 'PENDIENTE',
    2: 'APROBADO',
    3: 'RECHAZADO',
    4: 'EN_REVISION',
    5: 'CANCELADO',
}

/** Convierte un Decimal de Prisma (o número) a number; `null` se conserva. */
export function aNumero(value: { toString(): string } | number | null | undefined): number | null {
    if (value === null || value === undefined) return null
    return Number(value.toString())
}

/** Igual que `aNumero` pero devuelve 0 si no hay valor. */
export function monto(value: { toString(): string } | number | null | undefined): number {
    return aNumero(value) ?? 0
}

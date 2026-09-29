/**
 * Códigos estables de catálogos (columna `codigo`). El código nunca usa ids mágicos.
 */
export const ESTADOS_INSCRIPCION = ['PENDIENTE', 'EN_REVISION', 'APROBADO', 'RECHAZADO', 'CANCELADO'] as const
export type CodigoEstadoInscripcion = typeof ESTADOS_INSCRIPCION[number]

export const ROLES = ['SUPERADMIN', 'ADMIN'] as const
export type CodigoRol = typeof ROLES[number]

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

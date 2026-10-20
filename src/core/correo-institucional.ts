/**
 * Reglas fijas del correo institucional de la UNDC (no son configuración):
 * - dominio `undc.edu.pe`;
 * - parte local numérica de 8 a 12 dígitos = estudiante (su código, p. ej. 2021003668@undc.edu.pe);
 * - cualquier otra parte local en el dominio = personal (docente o administrativo, p. ej. garias@undc.edu.pe).
 */
export const DOMINIO_INSTITUCIONAL = 'undc.edu.pe'

/** Parte local de un correo de estudiante: su código (8 a 12 dígitos). */
export const PATRON_CODIGO_ESTUDIANTE = /^\d{8,12}$/

export type TipoCuenta = 'ESTUDIANTE' | 'PERSONAL' | 'EXTERNO'

export function tipoCuentaUndc(correo: string): TipoCuenta {
    const partes = String(correo).trim().toLowerCase().split('@')
    if (partes.length !== 2 || !partes[0] || partes[1] !== DOMINIO_INSTITUCIONAL) return 'EXTERNO'
    return PATRON_CODIGO_ESTUDIANTE.test(partes[0]) ? 'ESTUDIANTE' : 'PERSONAL'
}

/**
 * Correo `<código>@<dominio>` de un estudiante. Usa el dominio del evento (configurable), no el fijo de
 * `tipoCuentaUndc`: es el mismo que decide el precio institucional.
 */
export function esCorreoDeEstudiante(correo: string, dominio: string): boolean {
    const partes = String(correo).trim().toLowerCase().split('@')
    return partes.length === 2 && partes[1] === dominio.trim().toLowerCase() && PATRON_CODIGO_ESTUDIANTE.test(partes[0])
}

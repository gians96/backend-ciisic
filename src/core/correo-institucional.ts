/**
 * Reglas fijas del correo institucional de la UNDC (no son configuración):
 * - dominio `undc.edu.pe`;
 * - parte local numérica de 8 a 12 dígitos = estudiante (su código, p. ej. 2021003668@undc.edu.pe);
 * - cualquier otra parte local en el dominio = personal (docente o administrativo, p. ej. garias@undc.edu.pe).
 */
export const DOMINIO_INSTITUCIONAL = 'undc.edu.pe'

export type TipoCuenta = 'ESTUDIANTE' | 'PERSONAL' | 'EXTERNO'

export function tipoCuentaUndc(correo: string): TipoCuenta {
    const partes = String(correo).trim().toLowerCase().split('@')
    if (partes.length !== 2 || !partes[0] || partes[1] !== DOMINIO_INSTITUCIONAL) return 'EXTERNO'
    return /^\d{8,12}$/.test(partes[0]) ? 'ESTUDIANTE' : 'PERSONAL'
}

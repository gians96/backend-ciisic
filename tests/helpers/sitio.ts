/**
 * Token de acceso del sitio para pruebas (spec 007). Las pruebas simulan Prisma, así que basta
 * con que tenga el formato correcto y que `tokenAcceso.findUnique` devuelva `registroDeToken`.
 */
export const TOKEN_SITIO = `ciisic_${'A'.repeat(43)}`

export function registroDeToken<T extends { id: number }>(evento: T, cambios: Record<string, unknown> = {}) {
    return { id: 7, eventoId: evento.id, nombre: 'Landing', revocadoEn: null, expiraEn: null, evento, ...cambios }
}

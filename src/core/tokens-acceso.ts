import crypto from 'crypto'

/**
 * Tokens de acceso del sitio de cada evento (spec 007): `ciisic_` + 32 bytes aleatorios en
 * base64url. En BD solo se guarda su SHA-256 y un prefijo visible para reconocerlo en el panel.
 * Con 256 bits aleatorios no hace falta una clave: así rotar JWT_SECRET no invalida los tokens
 * que usan las landings.
 */
export const PREFIJO_TOKEN_ACCESO = 'ciisic_'
const LARGO_PREFIJO_VISIBLE = PREFIJO_TOKEN_ACCESO.length + 8
const FORMATO = /^ciisic_[A-Za-z0-9_-]{43}$/

export function hashTokenAcceso(token: string): string {
    return crypto.createHash('sha256').update(`tokens-acceso:v2:${token}`).digest('hex')
}

export function generarTokenAcceso(): { token: string, prefijo: string, hash: string } {
    const token = `${PREFIJO_TOKEN_ACCESO}${crypto.randomBytes(32).toString('base64url')}`
    return { token, prefijo: token.slice(0, LARGO_PREFIJO_VISIBLE), hash: hashTokenAcceso(token) }
}

export function tieneFormatoDeTokenAcceso(valor: string): boolean {
    return FORMATO.test(valor)
}

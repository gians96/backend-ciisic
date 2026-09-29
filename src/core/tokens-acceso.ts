import crypto from 'crypto'
import { env } from '../../config/env'

/**
 * Tokens de acceso del sitio de cada evento (spec 007): `ciisic_` + 32 bytes aleatorios en
 * base64url. En BD solo se guarda el HMAC-SHA256 (clave derivada de SECRETS_ENCRYPTION_KEY)
 * y un prefijo visible para reconocerlo en el panel.
 */
export const PREFIJO_TOKEN_ACCESO = 'ciisic_'
const LARGO_PREFIJO_VISIBLE = PREFIJO_TOKEN_ACCESO.length + 8
const FORMATO = /^ciisic_[A-Za-z0-9_-]{43}$/

function claveHmac(): Buffer {
    return crypto.createHmac('sha256', env.SECRETS_ENCRYPTION_KEY).update('tokens-acceso:v1').digest()
}

export function hashTokenAcceso(token: string): string {
    return crypto.createHmac('sha256', claveHmac()).update(token).digest('hex')
}

export function generarTokenAcceso(): { token: string, prefijo: string, hash: string } {
    const token = `${PREFIJO_TOKEN_ACCESO}${crypto.randomBytes(32).toString('base64url')}`
    return { token, prefijo: token.slice(0, LARGO_PREFIJO_VISIBLE), hash: hashTokenAcceso(token) }
}

export function tieneFormatoDeTokenAcceso(valor: string): boolean {
    return FORMATO.test(valor)
}

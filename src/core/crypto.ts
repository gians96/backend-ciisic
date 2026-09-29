import crypto from 'crypto'
import { env } from '../../config/env'

/**
 * Cifrado simétrico AES-256-GCM para secretos salientes (tokens de proveedores e
 * integraciones). Formato: `v1:<iv b64>:<tag b64>:<datos b64>`.
 */
const ALGORITMO = 'aes-256-gcm'
const VERSION = 'v1'

function clave(): Buffer {
    return env.SECRETS_ENCRYPTION_KEY
}

export function cifrar(texto: string): string {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGORITMO, clave(), iv)
    const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64'), tag.toString('base64'), datos.toString('base64')].join(':')
}

export function descifrar(payload: string): string {
    const [version, iv, tag, datos] = payload.split(':')
    if (version !== VERSION || !iv || !tag || !datos) throw new Error('Formato de secreto cifrado no reconocido')
    const decipher = crypto.createDecipheriv(ALGORITMO, clave(), Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(datos, 'base64')), decipher.final()]).toString('utf8')
}

/** Últimos caracteres visibles de un secreto (para mostrar `••••1234`). */
export function sufijo(secreto: string, largo = 4): string {
    return secreto.trim().slice(-largo)
}

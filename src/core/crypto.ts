import crypto from 'crypto'
import { env } from '../../config/env'

/**
 * Cifrado simétrico AES-256-GCM para secretos salientes (tokens de proveedores e
 * integraciones). Formato: `v1:<iv b64>:<tag b64>:<datos b64>`. La clave se deriva de
 * JWT_SECRET: si este cambia, los secretos guardados dejan de poder leerse.
 */
const ALGORITMO = 'aes-256-gcm'
const VERSION = 'v1'

function clave(): Buffer {
    return env.CLAVE_SECRETOS
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
    try {
        const decipher = crypto.createDecipheriv(ALGORITMO, clave(), Buffer.from(iv, 'base64'))
        decipher.setAuthTag(Buffer.from(tag, 'base64'))
        return Buffer.concat([decipher.update(Buffer.from(datos, 'base64')), decipher.final()]).toString('utf8')
    } catch {
        throw new Error('No se pudo descifrar un secreto guardado: si cambió JWT_SECRET, vuelve a guardar la credencial en el panel')
    }
}

/** Últimos caracteres visibles de un secreto (para mostrar `••••1234`). */
export function sufijo(secreto: string, largo = 4): string {
    return secreto.trim().slice(-largo)
}

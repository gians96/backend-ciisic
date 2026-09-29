import 'dotenv/config'
import crypto from 'crypto'

/**
 * Variables de entorno (spec 008): solo lo que no puede vivir en la base de datos.
 *   DATABASE_URL            conexión a MySQL
 *   JWT_SECRET              firma de sesiones (rotarlo cierra las sesiones activas)
 *   SECRETS_ENCRYPTION_KEY  cifra los secretos guardados en la BD y el hash de los tokens de acceso
 *   PORT                    opcional (3000)
 * Todo lo demás (API_UNDC, Google, URL del panel, rutas legacy, credenciales de correo, tokens
 * DNI) se configura en el panel y se guarda en la BD; los tiempos y límites son constantes.
 */
const isTest = process.env.NODE_ENV === 'test'
const isProduction = process.env.NODE_ENV === 'production'

function required(name: string, testFallback?: string): string {
    const value = process.env[name]?.trim() || (isTest ? testFallback : undefined)
    if (!value) throw new Error(`La variable de entorno ${name} es obligatoria`)
    return value
}

const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un puerto válido')
}

/** Avisos de configuración que no impiden arrancar; `server.ts` los muestra al iniciar. */
export const advertencias: string[] = []

const jwtSecret = required('JWT_SECRET', 'test-secret-at-least-32-characters-long')
if (jwtSecret.length < 16) throw new Error('JWT_SECRET debe tener al menos 16 caracteres (se recomiendan 32 o más)')
if (jwtSecret.length < 32) advertencias.push('JWT_SECRET tiene menos de 32 caracteres: rótalo por uno aleatorio más largo (las sesiones activas se cerrarán).')

/**
 * Clave AES-256 (32 bytes en base64) para cifrar secretos guardados en la BD.
 * Obligatoria en producción; en desarrollo/pruebas se deriva de JWT_SECRET.
 */
function secretsKey(): Buffer {
    const raw = process.env.SECRETS_ENCRYPTION_KEY?.trim()
    if (raw) {
        const key = Buffer.from(raw, 'base64')
        if (key.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY debe ser de 32 bytes codificados en base64')
        return key
    }
    if (isProduction) throw new Error('La variable de entorno SECRETS_ENCRYPTION_KEY es obligatoria en producción')
    return crypto.createHash('sha256').update(`secrets:${jwtSecret}`).digest()
}

export const env = Object.freeze({
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port,
    DATABASE_URL: required('DATABASE_URL', 'mysql://test:test@localhost:3306/ciisic_test'),
    JWT_SECRET: jwtSecret,
    SECRETS_ENCRYPTION_KEY: secretsKey(),
    /** Firma de los tokens de verificación (estudiante y correo); siempre derivada de JWT_SECRET. */
    VERIFICACION_SECRET: crypto.createHash('sha256').update(`verificacion:${jwtSecret}`).digest('hex'),
})

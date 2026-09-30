import 'dotenv/config'
import crypto from 'crypto'

/**
 * Variables de entorno (spec 008): solo lo que no puede vivir en la base de datos.
 *   DATABASE_URL  conexión a MySQL
 *   JWT_SECRET    firma de sesiones; de él se deriva la clave que cifra los secretos guardados
 *                 en la BD (rotarlo cierra las sesiones y obliga a volver a guardar las
 *                 credenciales en el panel)
 *   PORT          opcional (3000)
 * Todo lo demás (API_UNDC, Google, URL del panel, rutas legacy, credenciales de correo, tokens
 * DNI) se configura en el panel y se guarda en la BD; los tiempos y límites son constantes.
 */
const isTest = process.env.NODE_ENV === 'test'

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

export const env = Object.freeze({
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port,
    DATABASE_URL: required('DATABASE_URL', 'mysql://test:test@localhost:3306/ciisic_test'),
    JWT_SECRET: jwtSecret,
    /** Clave AES-256 de los secretos guardados en la BD; siempre derivada de JWT_SECRET. */
    CLAVE_SECRETOS: crypto.createHash('sha256').update(`secrets:${jwtSecret}`).digest(),
    /** Firma de los tokens de verificación (estudiante y correo); siempre derivada de JWT_SECRET. */
    VERIFICACION_SECRET: crypto.createHash('sha256').update(`verificacion:${jwtSecret}`).digest('hex'),
})

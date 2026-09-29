import 'dotenv/config'
import crypto from 'crypto'

const isTest = process.env.NODE_ENV === 'test'
const isProduction = process.env.NODE_ENV === 'production'

function required(name: string, testFallback?: string): string {
    const value = process.env[name]?.trim() || (isTest ? testFallback : undefined)
    if (!value) throw new Error(`La variable de entorno ${name} es obligatoria`)
    return value
}

function csv(name: string, fallback = ''): string[] {
    return (process.env[name] || fallback).split(',').map((value) => value.trim()).filter(Boolean)
}

function entero(name: string, fallback: number, min = 0): number {
    const value = Number(process.env[name] || fallback)
    if (!Number.isInteger(value) || value < min) throw new Error(`${name} debe ser un entero mayor o igual a ${min}`)
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

// Orígenes de navegador permitidos (la landing nueva y el panel usan BFF y no los necesitan).
// Admite comodines de subdominio: `https://*.episundc.pe`.
const corsOrigins = csv('CORS_ORIGINS', isTest ? 'http://localhost:3000' : '')
if (isProduction && corsOrigins.length === 0) advertencias.push('CORS_ORIGINS está vacía: ningún navegador podrá llamar a la API directamente (solo servidor a servidor).')

/**
 * Clave AES-256 (32 bytes en base64) para cifrar secretos salientes.
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

const verificacionSecret = process.env.VERIFICACION_SECRET?.trim()
    || crypto.createHash('sha256').update(`verificacion:${jwtSecret}`).digest('hex')

export const env = Object.freeze({
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: port,
    DATABASE_URL: required('DATABASE_URL', 'mysql://test:test@localhost:3306/ciisic_test'),
    JWT_SECRET: jwtSecret,
    CORS_ORIGINS: corsOrigins,
    UPLOADS_DIR: process.env.UPLOADS_DIR || 'uploads',
    MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024),
    SECRETS_ENCRYPTION_KEY: secretsKey(),
    // Consultas de documentos (spec 003)
    DNI_CACHE_TTL_DAYS: entero('DNI_CACHE_TTL_DAYS', 30),
    DNI_LOOKUP_TIMEOUT_MS: entero('DNI_LOOKUP_TIMEOUT_MS', 8000, 1000),
    // Verificación de estudiantes (spec 004)
    UNDC_API_URL: (process.env.UNDC_API_URL || '').replace(/\/+$/, ''),
    UNDC_API_KEY: process.env.UNDC_API_KEY || '',
    UNDC_API_TIMEOUT_MS: entero('UNDC_API_TIMEOUT_MS', 8000, 1000),
    VERIFICACION_SECRET: verificacionSecret,
    VERIFICACION_TTL_HORAS: entero('VERIFICACION_TTL_HORAS', 24, 1),
    // Integraciones (spec 005)
    INTEGRATIONS_ALLOWED_HOSTS: csv('INTEGRATIONS_ALLOWED_HOSTS'),
    INTEGRATIONS_TIMEOUT_MS: entero('INTEGRATIONS_TIMEOUT_MS', 10000, 1000),
    BREVO_API_URL: (process.env.BREVO_API_URL || 'https://api.brevo.com/v3').replace(/\/+$/, ''),
    EMAIL_TIMEOUT_MS: entero('EMAIL_TIMEOUT_MS', 15000, 1000),
    // Rutas legacy de la landing anterior (spec 002). Desactivar cuando la landing nueva esté en producción.
    LEGACY_ROUTES_ENABLED: !['false', '0', 'no'].includes((process.env.LEGACY_ROUTES_ENABLED || 'true').trim().toLowerCase()),
})

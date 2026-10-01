import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../database/prisma'
import { notFound } from './http-error'

/**
 * Códigos de la spec 014:
 * - Código de acceso al portal por correo: 6 dígitos; en la BD solo su HMAC-SHA256.
 * - Código de la credencial (QR del fotocheck): 10 caracteres base 36 en mayúsculas, único.
 */

// ─── Código de acceso al portal ─────────────────────────────────────────────

export const REGEX_CODIGO_ACCESO = /^\d{6}$/

/** La clave del HMAC se deriva de JWT_SECRET (sin variable de entorno nueva); rotarlo invalida los códigos vigentes. */
const CLAVE_CODIGOS = crypto.createHash('sha256').update(`codigos-acceso:${env.JWT_SECRET}`).digest()

/** Correo como se guarda y se compara: sin espacios y en minúsculas. */
export function normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase()
}

/** Código de 6 dígitos (000000–999999) con un generador criptográfico. */
export function nuevoCodigoAcceso(): string {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** HMAC-SHA256 en hexadecimal (64 caracteres) del correo normalizado y el código. */
export function hashCodigoAcceso(correo: string, codigo: string): string {
    return crypto.createHmac('sha256', CLAVE_CODIGOS).update(`${normalizarCorreo(correo)}:${codigo.trim()}`).digest('hex')
}

/** Compara dos hashes en tiempo constante. */
export function compararHash(a: string, b: string): boolean {
    const x = Buffer.from(a, 'utf8')
    const y = Buffer.from(b, 'utf8')
    return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// ─── Código de la credencial ────────────────────────────────────────────────

const ALFABETO_CREDENCIAL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LARGO_CODIGO_CREDENCIAL = 10
export const REGEX_CODIGO_CREDENCIAL = /^[0-9A-Z]{10}$/
/** Índice único de `inscripciones.codigo_credencial`. */
export const INDICE_CODIGO_CREDENCIAL = 'uq_inscripciones_codigo_credencial'
/** Intentos en total ante una colisión del código (probabilidad despreciable: ~1e-13 por inscripción). */
const INTENTOS_CODIGO = 3

/** 10 caracteres base 36 en mayúsculas (~51,7 bits) con un generador criptográfico. */
export function nuevoCodigoCredencial(): string {
    let codigo = ''
    for (let i = 0; i < LARGO_CODIGO_CREDENCIAL; i++) codigo += ALFABETO_CREDENCIAL[crypto.randomInt(ALFABETO_CREDENCIAL.length)]
    return codigo
}

/** Si el error es la violación del índice único del código de la credencial. */
export function esColisionDeCodigo(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
    return /codigo_credencial|codigoCredencial/.test(JSON.stringify(error.meta?.target ?? ''))
}

/**
 * Ejecuta `fn` y la repite (hasta 3 intentos en total) si choca con el índice único del código
 * de la credencial. `fn` debe generar un código nuevo en cada llamada; cualquier otro error se
 * propaga sin reintentar.
 */
export async function conReintentoDeCodigo<T>(fn: () => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento++) {
        try {
            return await fn()
        } catch (error) {
            if (intento >= INTENTOS_CODIGO || !esColisionDeCodigo(error)) throw error
        }
    }
}

/**
 * Código de la credencial de una inscripción. Si aún no tiene (creada por la imagen anterior), lo
 * genera sin pisar uno asignado en paralelo (`updateMany` con `codigoCredencial: null`). Si ya
 * estaba aprobada o se le envió la credencial, pudo recibir el QR anterior: se marca `esQrLegado`.
 * 404 `INSCRIPTION_NOT_FOUND` si no existe.
 */
export async function asegurarCodigoCredencial(inscripcionId: number): Promise<string> {
    const leer = () => prisma.inscripcion.findUnique({
        where: { id: inscripcionId },
        select: { codigoCredencial: true, credencialEnviadaEn: true, estado: { select: { codigo: true } } },
    })
    const actual = await leer()
    if (!actual) throw notFound('INSCRIPTION_NOT_FOUND', `Inscripción con id ${inscripcionId} no encontrada`)
    if (actual.codigoCredencial) return actual.codigoCredencial

    const legado = actual.estado.codigo === 'APROBADO' || actual.credencialEnviadaEn !== null
    await conReintentoDeCodigo(() => prisma.inscripcion.updateMany({
        where: { id: inscripcionId, codigoCredencial: null },
        data: { codigoCredencial: nuevoCodigoCredencial(), ...(legado ? { esQrLegado: true } : {}) },
    }))
    const final = await leer()
    if (!final?.codigoCredencial) throw notFound('INSCRIPTION_NOT_FOUND', `Inscripción con id ${inscripcionId} no encontrada`)
    return final.codigoCredencial
}

// ─── Correo enmascarado ─────────────────────────────────────────────────────

/** `ana.perez@gmail.com` → `a***@g***.com`; `x@undc.edu.pe` → `x***@u***.edu.pe`. */
export function enmascararCorreo(correo: string): string {
    const [local, dominio] = normalizarCorreo(correo).split('@')
    const parte = (texto: string | undefined) => (texto ? `${texto[0]}***` : '***')
    if (dominio === undefined) return parte(local)
    const [primera, ...resto] = dominio.split('.')
    return `${parte(local)}@${[parte(primera), ...resto].join('.')}`
}

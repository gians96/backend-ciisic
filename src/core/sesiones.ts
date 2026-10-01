import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import type { CodigoRol } from './catalogos'

/**
 * Sesiones firmadas por el backend (spec 010). La audiencia separa los perfiles: un token de
 * participante nunca sirve en rutas administrativas y viceversa.
 */
export const EMISOR = 'backend-ciisic'
export const AUDIENCIA_ADMIN = 'ciisic-admin'
export const AUDIENCIA_PARTICIPANTE = 'ciisic-participante'
/** Vida de una sesión del staff (se renueva con `POST /v1/auth/refresh`). */
export const SESION_SEGUNDOS = 60 * 60
/** Tope de una sesión del staff desde que se inició: la renovación no la extiende más (spec 013). */
export const SESION_MAXIMA_SEGUNDOS = 12 * 60 * 60
/** Vida de una sesión del portal del participante (spec 014): no se renueva. */
export const SESION_PARTICIPANTE_SEGUNDOS = 12 * 60 * 60

/** Cómo se inició la sesión. `CODIGO` (código por correo) solo existe en sesiones de participante. */
export type MetodoSesion = 'PASSWORD' | 'GOOGLE' | 'CODIGO'
export type MetodoSesionParticipante = Extract<MetodoSesion, 'GOOGLE' | 'CODIGO'>

export interface UsuarioSesion {
    id: number
    nombres: string
    apellidos: string
    correo: string
    rolId: number
    rolCodigo: CodigoRol
    rolNombre: string
}

export interface ParticipanteSesion {
    id: number
    nombres: string
    apellidos: string
    correo: string
}

export interface CargaSesion extends jwt.JwtPayload {
    user?: UsuarioSesion
    participante?: ParticipanteSesion
    metodo?: MetodoSesion
    /** Staff: huella de las credenciales de la cuenta al firmar (ver `huellaCredenciales`). */
    huella?: string
    /** Staff: inicio de la sesión original en segundos; la renovación lo conserva. */
    authTime?: number
}

/** Datos de la cuenta de staff de los que depende la validez de sus sesiones. */
export interface Credenciales {
    correo: string
    contrasenaHash?: string | null
    googleSub?: string | null
}

const CLAVE_HUELLA = crypto.createHash('sha256').update(`huella-sesion:${env.JWT_SECRET}`).digest()

/**
 * Huella de las credenciales del staff (spec 013). Cambia si cambian el correo, la contraseña o la
 * cuenta Google vinculada, y con ella dejan de valer las sesiones firmadas antes. Es un HMAC con una
 * clave derivada de JWT_SECRET: el JWT se puede leer, pero no revela el hash de la contraseña.
 */
export function huellaCredenciales(cuenta: Credenciales): string {
    return crypto.createHmac('sha256', CLAVE_HUELLA)
        .update([cuenta.correo.toLowerCase(), cuenta.contrasenaHash ?? '', cuenta.googleSub ?? ''].join('\n'))
        .digest('base64url')
        .slice(0, 22)
}

function firmar(carga: object, audiencia: string, sujeto: number, segundos: number) {
    const token = jwt.sign(carga, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: segundos,
        issuer: EMISOR,
        audience: audiencia,
        subject: String(sujeto),
    })
    return { jwt: token, expiraEn: new Date(Date.now() + segundos * 1000).toISOString() }
}

export interface OpcionesSesionAdmin {
    metodo: MetodoSesion
    huella: string
    /** Inicio de la sesión que se renueva; sin él, la sesión empieza ahora. */
    authTime?: number
}

export function firmarSesionAdmin(usuario: UsuarioSesion, { metodo, huella, authTime }: OpcionesSesionAdmin) {
    return firmar({ user: usuario, metodo, huella, authTime: authTime ?? Math.floor(Date.now() / 1000) }, AUDIENCIA_ADMIN, usuario.id, SESION_SEGUNDOS)
}

/** Sesión del portal (12 h). `metodo`: con Google (por defecto) o con el código por correo. */
export function firmarSesionParticipante(participante: ParticipanteSesion, metodo: MetodoSesionParticipante = 'GOOGLE') {
    return firmar({ participante, metodo }, AUDIENCIA_PARTICIPANTE, participante.id, SESION_PARTICIPANTE_SEGUNDOS)
}

/** Verifica firma, vigencia y emisor; la audiencia la decide quien llama. Lanza si no es válido. */
export function verificarSesion(token: string): CargaSesion {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: EMISOR }) as CargaSesion
}

export function audienciaDe(carga: CargaSesion): string | null {
    return Array.isArray(carga.aud) ? carga.aud[0] ?? null : carga.aud ?? null
}

/** Inicio de la sesión del staff (los tokens sin `authTime` cuentan desde que se firmaron). */
export function inicioDeSesion(carga: CargaSesion): number {
    return carga.authTime ?? carga.iat ?? 0
}

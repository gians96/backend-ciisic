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
export const SESION_SEGUNDOS = 60 * 60

export type MetodoSesion = 'PASSWORD' | 'GOOGLE'

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
}

function firmar(carga: object, audiencia: string, sujeto: number) {
    const token = jwt.sign(carga, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: SESION_SEGUNDOS,
        issuer: EMISOR,
        audience: audiencia,
        subject: String(sujeto),
    })
    return { jwt: token, expiraEn: new Date(Date.now() + SESION_SEGUNDOS * 1000).toISOString() }
}

export function firmarSesionAdmin(usuario: UsuarioSesion, metodo: MetodoSesion) {
    return firmar({ user: usuario, metodo }, AUDIENCIA_ADMIN, usuario.id)
}

export function firmarSesionParticipante(participante: ParticipanteSesion) {
    return firmar({ participante, metodo: 'GOOGLE' }, AUDIENCIA_PARTICIPANTE, participante.id)
}

/** Verifica firma, vigencia y emisor; la audiencia la decide quien llama. Lanza si no es válido. */
export function verificarSesion(token: string): CargaSesion {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: EMISOR }) as CargaSesion
}

export function audienciaDe(carga: CargaSesion): string | null {
    return Array.isArray(carga.aud) ? carga.aud[0] ?? null : carga.aud ?? null
}

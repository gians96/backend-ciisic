import jwt from 'jsonwebtoken'
import { env } from '../../../../config/env'
import type { TipoCuenta } from '../../../core/correo-institucional'

const AUDIENCIA = 'verificacion-correo'
const VIGENCIA_HORAS = 24

/** Prueba de que el correo se verificó con Google, firmada por el backend y atada al evento. */
export interface VerificacionCorreo {
    eventoId: number
    correo: string
    tipoCuenta: TipoCuenta
    hd: string | null
    metodo: 'GOOGLE'
    verificadoEn: string
}

export function firmarVerificacionCorreo(verificacion: VerificacionCorreo): string {
    return jwt.sign({ c: verificacion }, env.VERIFICACION_SECRET, {
        algorithm: 'HS256',
        audience: AUDIENCIA,
        expiresIn: `${VIGENCIA_HORAS}h`,
    })
}

/** Devuelve la verificación si el token es válido y corresponde al mismo evento y correo; si no, `null`. */
export function leerVerificacionCorreo(token: string | null | undefined, esperado: { eventoId: number, correo: string }): VerificacionCorreo | null {
    if (!token) return null
    try {
        const payload = jwt.verify(token, env.VERIFICACION_SECRET, { algorithms: ['HS256'], audience: AUDIENCIA }) as { c?: VerificacionCorreo }
        const c = payload.c
        if (!c) return null
        return c.eventoId === esperado.eventoId && c.correo === esperado.correo.trim().toLowerCase() ? c : null
    } catch {
        return null
    }
}

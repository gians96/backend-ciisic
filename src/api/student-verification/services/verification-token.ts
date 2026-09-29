import jwt from 'jsonwebtoken'
import { env } from '../../../../config/env'

const AUDIENCIA = 'verificacion-estudiante'

/** Resultado de la verificación que viaja firmado entre `student-verification` e `inscriptions`. */
export interface ResultadoVerificacion {
    eventoId: number
    tipoDocumento: string
    numeroDocumento: string
    correo: string
    esEstudianteUndc: boolean
    codigoEstudiante: string | null
    carrera: string | null
    matriculadoSemestreActivo: boolean | null
    criterio: 'DNI' | 'NOMBRE' | null
    motivo: string | null
    verificadoEn: string
}

export function firmarVerificacion(resultado: ResultadoVerificacion): string {
    return jwt.sign({ v: resultado }, env.VERIFICACION_SECRET, {
        algorithm: 'HS256',
        audience: AUDIENCIA,
        expiresIn: `${env.VERIFICACION_TTL_HORAS}h`,
    })
}

interface Esperado {
    eventoId: number
    tipoDocumento: string
    numeroDocumento: string
    correo: string
}

/**
 * Lee un token de verificación y comprueba que corresponda a la misma persona, correo y
 * evento. Devuelve `null` si falta, expiró, fue alterado o no coincide.
 */
export function leerVerificacion(token: string | null | undefined, esperado: Esperado): ResultadoVerificacion | null {
    if (!token) return null
    try {
        const payload = jwt.verify(token, env.VERIFICACION_SECRET, { algorithms: ['HS256'], audience: AUDIENCIA }) as { v?: ResultadoVerificacion }
        const v = payload.v
        if (!v) return null
        const coincide = v.eventoId === esperado.eventoId
            && v.tipoDocumento === esperado.tipoDocumento
            && v.numeroDocumento === esperado.numeroDocumento
            && v.correo === esperado.correo.trim().toLowerCase()
        return coincide ? v : null
    } catch {
        return null
    }
}

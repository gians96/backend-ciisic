import type { Evento } from '@prisma/client'
import { HttpError } from '../../../core/http-error'
import { consultarDni } from '../../document-lookup/services/lookup'
import { nombresOficiales } from '../../document-lookup/services/cache'
import type { PersonaDni } from '../../document-lookup/providers/types'
import { esCorreoInstitucional } from '../../inscription/services/pricing'
import { firmarVerificacion, type ResultadoVerificacion } from './verification-token'
import { UndcNoDisponible, verificarEnUndc } from './undc-client'

export type MotivoNoVerificado =
    | 'CORREO_NO_INSTITUCIONAL'
    | 'DOCUMENTO_NO_SOPORTADO'
    | 'NO_ES_ESTUDIANTE'
    | 'EGRESADO'
    | 'IDENTIDAD_NO_COINCIDE'
    | 'SIN_DATOS_IDENTIDAD'
    | 'SERVICIO_NO_DISPONIBLE'

export interface SolicitudVerificacion {
    correo: string
    tipoDocumento: string
    numeroDocumento: string
}

/** Nombres oficiales para el cruce de identidad: caché RENIEC o consulta al pool. */
async function identidadOficial(numero: string): Promise<PersonaDni | null> {
    const enCache = await nombresOficiales(numero)
    if (enCache) return enCache
    try {
        return await consultarDni(numero, 'SISTEMA')
    } catch (error) {
        if (error instanceof HttpError) return null
        throw error
    }
}

/**
 * Verifica si la persona es estudiante UNDC (spec 004). Nunca lanza por fallas de API_UNDC:
 * las reporta como `SERVICIO_NO_DISPONIBLE` para que la inscripción continúe a precio regular.
 */
export async function verificarEstudiante(evento: Evento, solicitud: SolicitudVerificacion): Promise<ResultadoVerificacion> {
    const correo = solicitud.correo.trim().toLowerCase()
    const base: ResultadoVerificacion = {
        eventoId: evento.id,
        tipoDocumento: solicitud.tipoDocumento,
        numeroDocumento: solicitud.numeroDocumento,
        correo,
        esEstudianteUndc: false,
        codigoEstudiante: null,
        carrera: null,
        matriculadoSemestreActivo: null,
        criterio: null,
        motivo: null,
        verificadoEn: new Date().toISOString(),
    }
    const noVerificado = (motivo: MotivoNoVerificado, extra: Partial<ResultadoVerificacion> = {}) => ({ ...base, ...extra, motivo })

    if (!esCorreoInstitucional(correo, evento.dominioInstitucional)) return noVerificado('CORREO_NO_INSTITUCIONAL')
    if (solicitud.tipoDocumento !== 'dni') return noVerificado('DOCUMENTO_NO_SOPORTADO')

    const identidad = await identidadOficial(solicitud.numeroDocumento)
    if (!identidad) return noVerificado('SIN_DATOS_IDENTIDAD')

    try {
        const r = await verificarEnUndc({
            email: correo,
            dni: solicitud.numeroDocumento,
            nombres: identidad.nombres,
            apellido_paterno: identidad.apellidoPaterno,
            apellido_materno: identidad.apellidoMaterno,
        })
        const datos = {
            codigoEstudiante: r.codigo_estudiante,
            carrera: r.carrera,
            matriculadoSemestreActivo: r.matriculado_semestre_activo,
            criterio: r.criterio,
        }
        if (!r.es_estudiante) return noVerificado(r.egresado ? 'EGRESADO' : 'NO_ES_ESTUDIANTE', datos)
        if (r.egresado) return noVerificado('EGRESADO', datos)
        if (r.coincide_identidad !== true) return noVerificado('IDENTIDAD_NO_COINCIDE', datos)
        return { ...base, ...datos, esEstudianteUndc: true }
    } catch (error) {
        if (error instanceof UndcNoDisponible) {
            console.error('Verificación de estudiante no disponible:', error.message)
            return noVerificado('SERVICIO_NO_DISPONIBLE')
        }
        throw error
    }
}

/** Respuesta pública: el token firmado solo se emite cuando la verificación es positiva. */
export function aRespuestaPublica(resultado: ResultadoVerificacion) {
    return {
        esEstudianteUndc: resultado.esEstudianteUndc,
        codigoEstudiante: resultado.esEstudianteUndc ? resultado.codigoEstudiante : null,
        motivo: resultado.motivo,
        verificacionToken: resultado.esEstudianteUndc ? firmarVerificacion(resultado) : null,
    }
}

/** Instantánea guardada en la inscripción para que el admin vea cómo se verificó. */
export function aSnapshot(resultado: ResultadoVerificacion) {
    return {
        esEstudianteUndc: resultado.esEstudianteUndc,
        motivo: resultado.motivo,
        codigoEstudiante: resultado.codigoEstudiante,
        carrera: resultado.carrera,
        matriculadoSemestreActivo: resultado.matriculadoSemestreActivo,
        criterio: resultado.criterio,
        verificadoEn: resultado.verificadoEn,
    }
}

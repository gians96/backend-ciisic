import { configuracionUndc } from '../../../core/configuracion-sistema'
import { asegurarDestinoPublico } from '../../../core/url-saliente'

/** Respuesta de API_UNDC `POST /externo/estudiantes/verificar` (contrato 1). */
export interface VerificacionUndc {
    es_estudiante: boolean
    egresado: boolean
    matriculado_semestre_activo: boolean | null
    codigo_estudiante: string | null
    carrera: string | null
    coincide_identidad: boolean | null
    criterio: 'DNI' | 'NOMBRE' | null
    fuente?: string
}

export interface ConsultaUndc {
    email: string
    dni?: string
    nombres?: string
    apellido_paterno?: string
    apellido_materno?: string
}

export class UndcNoDisponible extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'UndcNoDisponible'
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

export async function undcConfigurado(): Promise<boolean> {
    return (await configuracionUndc()) !== null
}

/**
 * Llama a API_UNDC servidor a servidor con la API key configurada en el panel (Sistema); nunca
 * expone la key al navegador. Sin configuración o sin respuesta → `UndcNoDisponible`.
 */
export async function verificarEnUndc(consulta: ConsultaUndc): Promise<VerificacionUndc> {
    const configuracion = await configuracionUndc().catch(() => null)
    if (!configuracion) throw new UndcNoDisponible('La verificación de estudiantes no está configurada')
    let response: Response
    try {
        await asegurarDestinoPublico(configuracion.url)
        response = await fetch(`${configuracion.url}/externo/estudiantes/verificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': configuracion.apiKey },
            body: JSON.stringify(consulta),
            redirect: 'error',
            signal: AbortSignal.timeout(configuracion.timeoutMs),
        })
    } catch {
        throw new UndcNoDisponible('No se pudo contactar a API_UNDC')
    }
    if (!response.ok) throw new UndcNoDisponible(`API_UNDC respondió ${response.status}`)
    const body = await response.json().catch(() => null) as { data?: VerificacionUndc } | null
    if (!body?.data || typeof body.data.es_estudiante !== 'boolean') throw new UndcNoDisponible('Respuesta de API_UNDC no reconocida')
    return body.data
}

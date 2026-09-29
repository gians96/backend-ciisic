import { env } from '../../../../config/env'

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

export function undcConfigurado(): boolean {
    return Boolean(env.UNDC_API_URL && env.UNDC_API_KEY)
}

/** Llama a API_UNDC servidor a servidor con la API key; nunca expone la key al navegador. */
export async function verificarEnUndc(consulta: ConsultaUndc): Promise<VerificacionUndc> {
    if (!undcConfigurado()) throw new UndcNoDisponible('La verificación de estudiantes no está configurada')
    let response: Response
    try {
        response = await fetch(`${env.UNDC_API_URL}/externo/estudiantes/verificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': env.UNDC_API_KEY },
            body: JSON.stringify(consulta),
            signal: AbortSignal.timeout(env.UNDC_API_TIMEOUT_MS),
        })
    } catch {
        throw new UndcNoDisponible('No se pudo contactar a API_UNDC')
    }
    if (!response.ok) throw new UndcNoDisponible(`API_UNDC respondió ${response.status}`)
    const body = await response.json().catch(() => null) as { data?: VerificacionUndc } | null
    if (!body?.data || typeof body.data.es_estudiante !== 'boolean') throw new UndcNoDisponible('Respuesta de API_UNDC no reconocida')
    return body.data
}

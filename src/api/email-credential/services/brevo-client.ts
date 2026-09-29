import { env } from '../../../../config/env'

/**
 * Cliente mínimo de la API transaccional de Brevo (v3) con `fetch`: la API key va por
 * solicitud, así cada evento puede usar su propia credencial sin estado global.
 */
export class CorreoFallido extends Error {
    readonly status?: number

    constructor(message: string, status?: number) {
        super(message)
        this.name = 'CorreoFallido'
        this.status = status
    }
}

export interface CorreoSaliente {
    remitente: { email: string, name?: string }
    para: { email: string, name?: string }[]
    asunto: string
    html: string
    adjuntos?: { nombre: string, contenidoBase64: string }[]
}

export interface CuentaBrevo {
    correo: string | null
    empresa: string | null
    planes: { tipo: string, creditos: number | null, tipoCreditos: string | null }[]
}

function mensajeDeError(status: number, cuerpo: unknown): string {
    const detalle = cuerpo && typeof cuerpo === 'object' && 'message' in cuerpo
        ? String((cuerpo as { message: unknown }).message).slice(0, 300)
        : ''
    const sufijo = detalle ? `: ${detalle}` : ''
    if (status === 401) return `API key de Brevo inválida o sin permisos${sufijo}`
    if (status === 402) return `La cuenta de Brevo no tiene créditos o el plan no lo permite${sufijo}`
    if (status === 429) return 'Brevo limitó las solicitudes (429); intenta más tarde'
    return `Brevo respondió ${status}${sufijo}`
}

async function llamar<T>(apiKey: string, ruta: string, init: { method?: string, body?: unknown } = {}): Promise<T> {
    let respuesta: globalThis.Response
    try {
        respuesta = await fetch(`${env.BREVO_API_URL}${ruta}`, {
            method: init.method ?? 'GET',
            headers: {
                'api-key': apiKey,
                accept: 'application/json',
                ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(env.EMAIL_TIMEOUT_MS),
        })
    } catch (error) {
        const agotado = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new CorreoFallido(agotado ? 'Brevo no respondió a tiempo' : 'No se pudo conectar con Brevo')
    }
    const texto = await respuesta.text()
    let cuerpo: unknown = null
    try {
        cuerpo = texto ? JSON.parse(texto) : null
    } catch {
        cuerpo = null
    }
    if (!respuesta.ok) throw new CorreoFallido(mensajeDeError(respuesta.status, cuerpo), respuesta.status)
    return cuerpo as T
}

export async function enviarConBrevo(apiKey: string, correo: CorreoSaliente): Promise<{ messageId: string | null }> {
    const respuesta = await llamar<{ messageId?: string } | null>(apiKey, '/smtp/email', {
        method: 'POST',
        body: {
            sender: correo.remitente,
            to: correo.para,
            subject: correo.asunto,
            htmlContent: correo.html,
            ...(correo.adjuntos?.length
                ? { attachment: correo.adjuntos.map((adjunto) => ({ name: adjunto.nombre, content: adjunto.contenidoBase64 })) }
                : {}),
        },
    })
    return { messageId: respuesta?.messageId ?? null }
}

/** Verifica la API key sin enviar correos y devuelve la cuenta y los créditos del plan. */
export async function cuentaBrevo(apiKey: string): Promise<CuentaBrevo> {
    const cuenta = await llamar<{
        email?: string
        companyName?: string
        plan?: { type?: string, credits?: number, creditsType?: string }[]
    } | null>(apiKey, '/account')
    return {
        correo: cuenta?.email ?? null,
        empresa: cuenta?.companyName ?? null,
        planes: (cuenta?.plan ?? []).map((plan) => ({
            tipo: plan.type ?? '',
            creditos: typeof plan.credits === 'number' ? plan.credits : null,
            tipoCreditos: plan.creditsType ?? null,
        })),
    }
}

import { CorreoFallido, type CorreoSaliente, type CuentaCorreo } from './correo'

export { CorreoFallido, type CorreoSaliente }
export type CuentaBrevo = CuentaCorreo

/**
 * Cliente mínimo de la API transaccional de Brevo (v3) con `fetch`: la API key va por
 * solicitud, así cada evento puede usar su propia credencial sin estado global.
 */
const BREVO_API_URL = 'https://api.brevo.com/v3'
const TIMEOUT_MS = 15000

/** Códigos de error de Brevo que hablan de la cuenta (créditos, permisos, límite), no del mensaje. */
const CODIGOS_DE_CUENTA = new Set(['not_enough_credits', 'permission_denied', 'unauthorized', 'too_many_requests', 'account_under_validation'])

function codigoDe(cuerpo: unknown): string {
    return cuerpo && typeof cuerpo === 'object' && 'code' in cuerpo ? String((cuerpo as { code: unknown }).code) : ''
}

/** El fallo es de la cuenta si Brevo lo dice con su código o con el estado HTTP (401, 402, 403 y 429). */
function esDeLaCuenta(status: number, cuerpo: unknown): boolean {
    return [401, 402, 403, 429].includes(status) || CODIGOS_DE_CUENTA.has(codigoDe(cuerpo))
}

function mensajeDeError(status: number, cuerpo: unknown): string {
    const detalle = cuerpo && typeof cuerpo === 'object' && 'message' in cuerpo
        ? String((cuerpo as { message: unknown }).message).slice(0, 300)
        : ''
    const sufijo = detalle ? `: ${detalle}` : ''
    if (status === 401) return `API key de Brevo inválida o sin permisos${sufijo}`
    if (status === 402 || codigoDe(cuerpo) === 'not_enough_credits') return `La cuenta de Brevo no tiene créditos o el plan no lo permite${sufijo}`
    if (status === 429) return 'Brevo limitó las solicitudes (429); intenta más tarde'
    return `Brevo respondió ${status}${sufijo}`
}

async function llamar<T>(apiKey: string, ruta: string, init: { method?: string, body?: unknown } = {}): Promise<T> {
    let respuesta: globalThis.Response
    try {
        respuesta = await fetch(`${BREVO_API_URL}${ruta}`, {
            method: init.method ?? 'GET',
            headers: {
                'api-key': apiKey,
                accept: 'application/json',
                ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS),
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
    if (!respuesta.ok) throw new CorreoFallido(mensajeDeError(respuesta.status, cuerpo), respuesta.status, esDeLaCuenta(respuesta.status, cuerpo))
    return cuerpo as T
}

/**
 * Envía el correo y **comprueba que Brevo lo aceptó**: una respuesta exitosa sin el identificador del
 * mensaje no cuenta como enviado (Brevo siempre lo devuelve al aceptar un correo).
 */
export async function enviarConBrevo(apiKey: string, correo: CorreoSaliente): Promise<{ messageId: string }> {
    const respuesta = await llamar<{ messageId?: string, messageIds?: string[] } | null>(apiKey, '/smtp/email', {
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
    const messageId = respuesta?.messageId || respuesta?.messageIds?.[0]
    if (!messageId) throw new CorreoFallido('Brevo no confirmó el envío: su respuesta no trae el identificador del mensaje')
    return { messageId }
}

/**
 * Envíos que le quedan a la cuenta: la suma de los créditos de sus planes de correo (no los de SMS). `null` si
 * Brevo no informa créditos de envío (el plan es ilimitado o la respuesta no los trae): no se sabe, no que no haya.
 */
export function creditosDeEnvio(cuenta: CuentaCorreo): number | null {
    const planes = cuenta.planes.filter((plan) => plan.tipo !== 'sms' && plan.creditos !== null && (plan.tipoCreditos === null || plan.tipoCreditos === 'sendLimit'))
    if (!planes.length) return null
    return Math.max(0, planes.reduce((total, plan) => total + (plan.creditos ?? 0), 0))
}

/** Verifica la API key sin enviar correos y devuelve la cuenta y los créditos del plan. */
export async function cuentaBrevo(apiKey: string): Promise<CuentaCorreo> {
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

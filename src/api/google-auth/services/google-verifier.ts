import crypto from 'crypto'
import { OAuth2Client, type TokenPayload } from 'google-auth-library'
import { HttpError } from '../../../core/http-error'
import { obtenerConfiguracion } from '../../../core/configuracion-sistema'

/**
 * Verificación de ID tokens de Google Identity Services (spec 010). Un único cliente para que
 * los certificados públicos de Google queden en caché según su `Cache-Control`.
 */
const cliente = new OAuth2Client()

export interface IdentidadGoogle {
    sub: string
    correo: string
    hd: string | null
    nombres: string | null
    apellidos: string | null
}

const DOMINIOS_GMAIL = new Set(['gmail.com', 'googlemail.com'])
const CODIGOS_RED = new Set(['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'])

/**
 * Google solo es autoritativo para un correo si es de Gmail o si pertenece al dominio de la
 * organización de Google Workspace (`hd`). Otras cuentas Google con correos de terceros no
 * prueban de forma duradera la propiedad del buzón.
 */
export function googleEsAutoritativo(correo: string, hd: string | null | undefined): boolean {
    const dominio = correo.split('@')[1]?.toLowerCase() ?? ''
    if (DOMINIOS_GMAIL.has(dominio)) return true
    return Boolean(hd) && String(hd).toLowerCase() === dominio
}

function esErrorDeRed(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const codigo = (error as Error & { code?: unknown }).code
    return error.name === 'GaxiosError'
        || (typeof codigo === 'string' && CODIGOS_RED.has(codigo))
        || /certificates|fetch failed|network/i.test(error.message)
}

function mismoNonce(a: string, b: string): boolean {
    const x = Buffer.from(a)
    const y = Buffer.from(b)
    return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const INVALIDO = () => new HttpError(401, 'INVALID_GOOGLE_TOKEN', 'La sesión de Google no es válida o expiró. Vuelve a intentarlo.')

/**
 * Verifica firma (RS256), emisor, audiencia (client ID guardado en Sistema), vigencia y, si se
 * indica, el `nonce`. Exige correo verificado y cuenta autoritativa.
 */
export async function verificarIdTokenGoogle(idToken: string, opciones: { nonce?: string } = {}): Promise<IdentidadGoogle> {
    const { googleClientId } = await obtenerConfiguracion()
    if (!googleClientId) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'El acceso con Google no está configurado.')

    let payload: TokenPayload | undefined
    try {
        const ticket = await cliente.verifyIdToken({ idToken, audience: googleClientId })
        payload = ticket.getPayload()
    } catch (error) {
        if (esErrorDeRed(error)) throw new HttpError(503, 'GOOGLE_UNAVAILABLE', 'No se pudo validar con Google en este momento. Intenta nuevamente.')
        throw INVALIDO()
    }
    if (!payload?.sub) throw INVALIDO()
    if (opciones.nonce !== undefined && (!payload.nonce || !mismoNonce(payload.nonce, opciones.nonce))) throw INVALIDO()
    if (!payload.email || payload.email_verified !== true) {
        throw new HttpError(403, 'GOOGLE_EMAIL_NOT_VERIFIED', 'Google no confirma el correo de esta cuenta.')
    }
    const correo = payload.email.trim().toLowerCase()
    if (!googleEsAutoritativo(correo, payload.hd)) {
        throw new HttpError(403, 'GOOGLE_NOT_AUTHORITATIVE', 'Usa una cuenta de Gmail o tu cuenta institucional de Google.')
    }
    return {
        sub: payload.sub,
        correo,
        hd: payload.hd ?? null,
        nombres: payload.given_name?.trim() || null,
        apellidos: payload.family_name?.trim() || null,
    }
}

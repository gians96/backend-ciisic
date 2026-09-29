import type { ProveedorConsulta } from '@prisma/client'

export interface PersonaDni {
    numero: string
    nombres: string
    apellidoPaterno: string
    apellidoMaterno: string
}

/**
 * Clasificación de fallas de un proveedor, que decide qué hace el pool de tokens:
 * - NO_ENCONTRADO: el documento no existe en ese proveedor (se prueba otro proveedor).
 * - AGOTADO: el token llegó a su cuota (se marca AGOTADO y se pasa al siguiente).
 * - TOKEN_INVALIDO: token rechazado o sin permisos (se marca INVALIDO y se pasa al siguiente).
 * - NO_DISPONIBLE: error de red, timeout o 5xx (se registra y se pasa al siguiente).
 */
export type TipoFalla = 'NO_ENCONTRADO' | 'AGOTADO' | 'TOKEN_INVALIDO' | 'NO_DISPONIBLE'

export class FallaProveedor extends Error {
    readonly tipo: TipoFalla
    readonly codigoHttp?: number

    constructor(tipo: TipoFalla, message: string, codigoHttp?: number) {
        super(message)
        this.name = 'FallaProveedor'
        this.tipo = tipo
        this.codigoHttp = codigoHttp
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

export interface ProveedorDni {
    id: ProveedorConsulta
    consultarDni(numero: string, token: string, timeoutMs: number): Promise<PersonaDni>
}

const PALABRAS_CUOTA = ['quota', 'limit', 'límite', 'limite', 'exceed', 'agotad', 'credits', 'créditos']

/** Clasificación común por código HTTP y mensaje del proveedor. */
export function clasificarFalla(status: number, mensaje: string): FallaProveedor {
    const texto = mensaje.toLowerCase()
    if (status === 401 || status === 403) return new FallaProveedor('TOKEN_INVALIDO', mensaje || 'Token rechazado', status)
    if (status === 402 || status === 429 || PALABRAS_CUOTA.some((palabra) => texto.includes(palabra))) {
        return new FallaProveedor('AGOTADO', mensaje || 'Cuota agotada', status)
    }
    if (status === 400 || status === 404 || status === 422) return new FallaProveedor('NO_ENCONTRADO', mensaje || 'Documento no encontrado', status)
    return new FallaProveedor('NO_DISPONIBLE', mensaje || `Respuesta inesperada (${status})`, status)
}

/** `fetch` con timeout; los errores de red/timeout se convierten en NO_DISPONIBLE. */
export async function fetchConTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
        const detalle = error instanceof Error && error.name === 'TimeoutError' ? 'Tiempo de espera agotado' : 'Error de red'
        throw new FallaProveedor('NO_DISPONIBLE', detalle)
    }
}

export async function leerJson(response: Response): Promise<Record<string, unknown> | null> {
    try {
        const data = await response.json()
        return data && typeof data === 'object' ? data as Record<string, unknown> : null
    } catch {
        return null
    }
}

export function mensajeDe(body: Record<string, unknown> | null): string {
    if (!body) return ''
    const valor = body.message ?? body.error ?? body.code
    return typeof valor === 'string' ? valor.slice(0, 250) : ''
}

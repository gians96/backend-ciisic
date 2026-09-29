import { env } from '../../../../config/env'
import { unprocessable } from '../../../core/http-error'

/** Resumen de deportes-fi (contrato 2, `GET /integrations/event/summary`). */
export interface ResumenDeportes {
    event: { id: number, name: string, startDate: string, endDate: string }
    currency: string
    teams: { total: number, pending: number, approved: number, rejected: number, cancelled: number }
    participants: { total: number }
    payments: {
        validated: { count: number, amount: number }
        pending: { count: number, amount: number }
        rejected: { count: number, amount: number }
    }
    byDiscipline: Array<{
        disciplineId: number, name: string, participantType: string, isPaid: boolean, cost: number
        teams: { total: number, approved: number, pending: number }, validatedAmount: number, pendingAmount: number
    }>
    byParticipantType: Array<{ participantType: string, teams: number, validatedAmount: number, pendingAmount: number }>
    generatedAt: string
}

export class IntegracionFallida extends Error {
    readonly codigoHttp?: number
    constructor(message: string, codigoHttp?: number) {
        super(message)
        this.name = 'IntegracionFallida'
        this.codigoHttp = codigoHttp
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/**
 * Valida la URL base de una integración (evita SSRF): solo https (http únicamente fuera de
 * producción para pruebas locales) y, si se configuró, solo hosts de la lista permitida.
 */
export function validarUrlBase(urlBase: string): string {
    let url: URL
    try {
        url = new URL(urlBase)
    } catch {
        throw unprocessable('INVALID_URL', 'La URL base no es válida.')
    }
    const esLocal = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && env.NODE_ENV !== 'production' && esLocal)) {
        throw unprocessable('INVALID_URL', 'La URL base debe usar https.')
    }
    if (env.INTEGRATIONS_ALLOWED_HOSTS.length && !env.INTEGRATIONS_ALLOWED_HOSTS.includes(url.hostname)) {
        throw unprocessable('HOST_NOT_ALLOWED', `El host ${url.hostname} no está en la lista de integraciones permitidas.`)
    }
    return url.toString().replace(/\/+$/, '')
}

async function obtener<T>(urlBase: string, token: string, ruta: string): Promise<T> {
    let response: Response
    try {
        response = await fetch(`${validarUrlBase(urlBase)}/${ruta}`, {
            headers: { 'X-Api-Key': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(env.INTEGRATIONS_TIMEOUT_MS),
            redirect: 'error',
        })
    } catch (error) {
        if (error instanceof Error && error.name === 'HttpError') throw error
        throw new IntegracionFallida('No se pudo conectar con deportes-fi')
    }
    if (response.status === 401) throw new IntegracionFallida('deportes-fi rechazó el token (401)', 401)
    if (!response.ok) throw new IntegracionFallida(`deportes-fi respondió ${response.status}`, response.status)
    const body = await response.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new IntegracionFallida('Respuesta de deportes-fi no reconocida')
    return body as T
}

export function eventoDeportes(urlBase: string, token: string) {
    return obtener<{ id: number, name: string, startDate: string, endDate: string, isOpen: boolean }>(urlBase, token, 'integrations/event')
}

export async function resumenDeportes(urlBase: string, token: string): Promise<ResumenDeportes> {
    const resumen = await obtener<ResumenDeportes>(urlBase, token, 'integrations/event/summary')
    if (!resumen.payments || !resumen.teams) throw new IntegracionFallida('El resumen de deportes-fi no tiene el formato esperado')
    return resumen
}

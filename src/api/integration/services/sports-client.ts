import { asegurarDestinoPublico, validarUrlSaliente } from '../../../core/url-saliente'

const TIMEOUT_MS = 10000

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
 * Valida la URL base de una integración (anti-SSRF, spec 008): solo https (http únicamente
 * hacia localhost fuera de producción) y, en producción, nunca destinos internos.
 */
export function validarUrlBase(urlBase: string): string {
    return validarUrlSaliente(urlBase, { campo: 'La URL base' })
}

async function obtener<T>(urlBase: string, token: string, ruta: string): Promise<T> {
    let response: Response
    const base = validarUrlBase(urlBase)
    try {
        await asegurarDestinoPublico(base)
        response = await fetch(`${base}/${ruta}`, {
            headers: { 'X-Api-Key': token, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
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

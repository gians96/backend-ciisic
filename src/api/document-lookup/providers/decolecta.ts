import { clasificarFalla, FallaProveedor, fetchConTimeout, leerJson, mensajeDe, type ProveedorDni } from './types'

/**
 * Decolecta — RENIEC DNI.
 * GET https://api.decolecta.com/v1/reniec/dni?numero=XXXXXXXX  (Authorization: Bearer <token>)
 * 200 → { first_name, first_last_name, second_last_name, full_name, document_number }
 * Documentación: https://decolecta.gitbook.io/docs/servicios/integrations-2
 */
export const BASE_DECOLECTA = 'https://api.decolecta.com'

export const decolecta: ProveedorDni = {
    id: 'DECOLECTA',
    async consultarDni(numero, token, timeoutMs) {
        const response = await fetchConTimeout(
            `${BASE_DECOLECTA}/v1/reniec/dni?numero=${encodeURIComponent(numero)}`,
            { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
            timeoutMs,
        )
        const body = await leerJson(response)
        if (response.ok) {
            if (body && typeof body.first_name === 'string' && body.first_name.trim()) {
                return {
                    numero: String(body.document_number ?? numero),
                    nombres: body.first_name.trim(),
                    apellidoPaterno: String(body.first_last_name ?? '').trim(),
                    apellidoMaterno: String(body.second_last_name ?? '').trim(),
                }
            }
            if (mensajeDe(body)) throw clasificarFalla(404, mensajeDe(body))
            throw new FallaProveedor('NO_DISPONIBLE', 'Respuesta de Decolecta sin datos', response.status)
        }
        throw clasificarFalla(response.status, mensajeDe(body))
    },
}

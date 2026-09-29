import { clasificarFalla, FallaProveedor, fetchConTimeout, leerJson, mensajeDe, type ProveedorDni } from './types'

/**
 * ApiPeruDev — DNI.
 * POST https://api.apiperu.dev/dni  body { "dni": "XXXXXXXX" }  (Authorization: Bearer <token>)
 * 200 → { success, code: "found", data: { numero, nombre_completo, nombres, apellido_paterno, apellido_materno } }
 * Errores: 404 document_not_found · 429 quota_exceeded · 401/403 token · 503 upstream_unavailable
 * Documentación: https://docs.apiperu.dev/referencia/consultar-dni y /errores
 */
export const BASE_APIPERU = 'https://api.apiperu.dev'

const CODIGOS: Record<string, number> = {
    document_not_found: 404,
    quota_exceeded: 429,
    invalid_input: 400,
    upstream_unavailable: 503,
}

export const apiperu: ProveedorDni = {
    id: 'APIPERU',
    async consultarDni(numero, token, timeoutMs) {
        const response = await fetchConTimeout(
            `${BASE_APIPERU}/dni`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ dni: numero }),
            },
            timeoutMs,
        )
        const body = await leerJson(response)
        const data = body?.data as Record<string, unknown> | undefined
        if (response.ok && body?.success !== false && data && typeof data.nombres === 'string') {
            return {
                numero: String(data.numero ?? numero),
                nombres: data.nombres.trim(),
                apellidoPaterno: String(data.apellido_paterno ?? '').trim(),
                apellidoMaterno: String(data.apellido_materno ?? '').trim(),
            }
        }
        const codigo = typeof body?.code === 'string' ? body.code : ''
        const status = response.ok ? (CODIGOS[codigo] ?? 502) : response.status
        if (codigo === 'quota_exceeded') throw new FallaProveedor('AGOTADO', mensajeDe(body) || 'Cuota agotada', status)
        if (codigo === 'document_not_found') throw new FallaProveedor('NO_ENCONTRADO', mensajeDe(body) || 'El DNI no existe', status)
        throw clasificarFalla(status, mensajeDe(body))
    },
}

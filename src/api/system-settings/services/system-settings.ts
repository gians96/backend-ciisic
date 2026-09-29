import type { ConfiguracionSistema, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict } from '../../../core/http-error'
import { cifrar, descifrar, sufijo } from '../../../core/crypto'
import { establecerConfiguracion } from '../../../core/configuracion-sistema'
import { asegurarDestinoPublico, validarUrlSaliente } from '../../../core/url-saliente'
import type { ActualizarConfiguracionInput } from '../validation'

const conEditor = { actualizadoPor: { select: { id: true, nombres: true, apellidos: true } } } satisfies Prisma.ConfiguracionSistemaInclude
type FilaConEditor = ConfiguracionSistema & { actualizadoPor: { id: number, nombres: string, apellidos: string } | null }

/** Correo de prueba: API_UNDC no consulta SIVIRENO si la parte local no es un código numérico. */
const CORREO_PRUEBA = 'prueba-conexion@undc.edu.pe'

export function aConfiguracion(fila: FilaConEditor) {
    return {
        undcApi: {
            url: fila.undcApiUrl,
            apiKeyEnmascarada: fila.undcApiKeySufijo ? `••••${fila.undcApiKeySufijo}` : null,
            timeoutMs: fila.undcApiTimeoutMs,
            configurada: Boolean(fila.undcApiUrl && fila.undcApiKeyCifrada),
            ultimoEstado: fila.undcUltimoEstado,
            ultimoError: fila.undcUltimoError,
            ultimaPruebaEn: fila.undcUltimaPruebaEn,
        },
        google: { clientId: fila.googleClientId, configurado: Boolean(fila.googleClientId) },
        urlPanel: fila.urlPanel,
        rutasLegacy: { activas: fila.rutasLegacyActivas },
        actualizadoPor: fila.actualizadoPor,
        actualizadoEn: fila.actualizadoEn,
    }
}

async function leerFila(): Promise<FilaConEditor> {
    // La migración crea la fila 1; el upsert la recrea si alguien la borró
    return prisma.configuracionSistema.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, include: conEditor })
}

export async function obtenerConfiguracionAdmin() {
    const fila = await leerFila()
    establecerConfiguracion(fila)
    return aConfiguracion(fila)
}

/** URL del panel: https (http solo localhost en desarrollo), sin ruta; se guarda solo el origen. */
function normalizarUrlPanel(valor: string): string {
    return new URL(validarUrlSaliente(valor, { campo: 'La URL del panel', produccion: false })).origin
}

export async function actualizarConfiguracion(input: ActualizarConfiguracionInput, adminId?: number) {
    const data: Prisma.ConfiguracionSistemaUncheckedUpdateInput = {}
    const cambios: string[] = []
    if (input.undcApiUrl !== undefined) {
        data.undcApiUrl = input.undcApiUrl ? validarUrlSaliente(input.undcApiUrl, { campo: 'La URL de API_UNDC' }) : null
        cambios.push('undcApiUrl')
    }
    if (input.undcApiKey !== undefined) {
        data.undcApiKeyCifrada = input.undcApiKey ? cifrar(input.undcApiKey) : null
        data.undcApiKeySufijo = input.undcApiKey ? sufijo(input.undcApiKey) : null
        cambios.push('undcApiKey')
    }
    if (cambios.length) {
        // Cambió el destino o la credencial: el último resultado de la prueba ya no aplica
        data.undcUltimoEstado = null
        data.undcUltimoError = null
        data.undcUltimaPruebaEn = null
    }
    if (input.undcApiTimeoutMs !== undefined) { data.undcApiTimeoutMs = input.undcApiTimeoutMs; cambios.push('undcApiTimeoutMs') }
    if (input.googleClientId !== undefined) { data.googleClientId = input.googleClientId || null; cambios.push('googleClientId') }
    if (input.urlPanel !== undefined) { data.urlPanel = input.urlPanel ? normalizarUrlPanel(input.urlPanel) : null; cambios.push('urlPanel') }
    if (input.rutasLegacyActivas !== undefined) { data.rutasLegacyActivas = input.rutasLegacyActivas; cambios.push('rutasLegacyActivas') }
    data.actualizadoPorId = adminId ?? null

    const fila = await prisma.configuracionSistema.upsert({
        where: { id: 1 },
        create: { id: 1, ...(data as Prisma.ConfiguracionSistemaUncheckedCreateInput) },
        update: data,
        include: conEditor,
    })
    establecerConfiguracion(fila)
    if (cambios.length) console.log(`Configuración del sistema actualizada por el administrador ${adminId ?? '?'}: ${cambios.join(', ')}`)
    return aConfiguracion(fila)
}

function mensajePorEstado(status: number): string {
    if (status === 401) return 'API_UNDC rechazó la API key (inválida, revocada o expirada).'
    if (status === 403) return 'La API key no tiene el permiso estudiantes:verificar.'
    if (status === 429) return 'API_UNDC limitó las solicitudes (429); intenta en un minuto.'
    return `API_UNDC respondió ${status}.`
}

/** Prueba la conexión con API_UNDC con la configuración guardada y registra el resultado. */
export async function probarUndc() {
    const fila = await leerFila()
    if (!fila.undcApiUrl || !fila.undcApiKeyCifrada) {
        throw conflict('UNDC_API_NOT_CONFIGURED', 'Configura la URL y la API key de API_UNDC antes de probar.')
    }
    const inicio = Date.now()
    let ok = false
    let mensaje: string
    let codigoHttp: number | null = null
    try {
        await asegurarDestinoPublico(fila.undcApiUrl)
        const respuesta = await fetch(`${fila.undcApiUrl}/externo/estudiantes/verificar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': descifrar(fila.undcApiKeyCifrada) },
            body: JSON.stringify({ email: CORREO_PRUEBA }),
            redirect: 'error',
            signal: AbortSignal.timeout(fila.undcApiTimeoutMs),
        })
        codigoHttp = respuesta.status
        const cuerpo = await respuesta.json().catch(() => null) as { data?: { es_estudiante?: unknown } } | null
        ok = respuesta.ok && typeof cuerpo?.data?.es_estudiante === 'boolean'
        mensaje = ok ? 'Conexión correcta: API_UNDC respondió con la API key configurada.' : (respuesta.ok ? 'API_UNDC respondió en un formato no reconocido.' : mensajePorEstado(respuesta.status))
    } catch (error) {
        const agotado = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        mensaje = error instanceof Error && error.name === 'HttpError'
            ? error.message
            : agotado ? 'API_UNDC no respondió a tiempo.' : 'No se pudo conectar con API_UNDC.'
    }
    const actualizada = await prisma.configuracionSistema.update({
        where: { id: 1 },
        data: ok
            ? { undcUltimoEstado: 'OK', undcUltimoError: null, undcUltimaPruebaEn: new Date() }
            : { undcUltimoEstado: 'ERROR', undcUltimoError: mensaje.slice(0, 500), undcUltimaPruebaEn: new Date() },
        include: conEditor,
    })
    establecerConfiguracion(actualizada)
    return { ok, mensaje, codigoHttp, latenciaMs: Date.now() - inicio, configuracion: aConfiguracion(actualizada) }
}

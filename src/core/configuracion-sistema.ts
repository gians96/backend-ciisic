import type { ConfiguracionSistema } from '@prisma/client'
import { prisma } from '../database/prisma'
import { descifrar } from './crypto'

/**
 * Configuración global (spec 008) leída de la fila única `configuracion_sistema`, con caché en
 * memoria de 30 s. Guardar desde el panel actualiza la caché al instante (`establecerConfiguracion`);
 * otras instancias la ven como máximo 30 s después. Si la BD falla se usa el último valor o, en
 * su defecto, los valores por defecto (nada configurado, rutas legacy activas).
 */
export interface ConfiguracionVigente {
    undcApiUrl: string | null
    undcApiKeyCifrada: string | null
    undcApiTimeoutMs: number
    googleClientId: string | null
    urlPanel: string | null
    rutasLegacyActivas: boolean
}

const TTL_MS = 30 * 1000
const AVISO_ERROR_MS = 60 * 1000
const POR_DEFECTO: ConfiguracionVigente = Object.freeze({
    undcApiUrl: null,
    undcApiKeyCifrada: null,
    undcApiTimeoutMs: 8000,
    googleClientId: null,
    urlPanel: null,
    rutasLegacyActivas: true,
})

let cache: { valor: ConfiguracionVigente, expira: number } | null = null
let enCurso: Promise<ConfiguracionVigente> | null = null
let ultimoAvisoError = 0

function aVigente(fila: ConfiguracionSistema): ConfiguracionVigente {
    return {
        undcApiUrl: fila.undcApiUrl,
        undcApiKeyCifrada: fila.undcApiKeyCifrada,
        undcApiTimeoutMs: fila.undcApiTimeoutMs,
        googleClientId: fila.googleClientId,
        urlPanel: fila.urlPanel,
        rutasLegacyActivas: fila.rutasLegacyActivas,
    }
}

export function establecerConfiguracion(fila: ConfiguracionSistema): void {
    cache = { valor: aVigente(fila), expira: Date.now() + TTL_MS }
}

/** Solo para pruebas. */
export function reiniciarCacheConfiguracion(): void {
    cache = null
    enCurso = null
}

export async function obtenerConfiguracion(): Promise<ConfiguracionVigente> {
    if (cache && cache.expira > Date.now()) return cache.valor
    if (enCurso) return enCurso
    enCurso = (async () => {
        try {
            const fila = await prisma.configuracionSistema.findUnique({ where: { id: 1 } })
            const valor = fila ? aVigente(fila) : POR_DEFECTO
            cache = { valor, expira: Date.now() + TTL_MS }
            return valor
        } catch (error) {
            if (process.env.NODE_ENV !== 'test' && Date.now() - ultimoAvisoError > AVISO_ERROR_MS) {
                ultimoAvisoError = Date.now()
                console.error('No se pudo leer la configuración del sistema:', error instanceof Error ? error.message : error)
            }
            return cache?.valor ?? POR_DEFECTO
        } finally {
            enCurso = null
        }
    })()
    return enCurso
}

/** URL, API key (descifrada) y timeout de API_UNDC, o `null` si no está configurada. */
export async function configuracionUndc(): Promise<{ url: string, apiKey: string, timeoutMs: number } | null> {
    const c = await obtenerConfiguracion()
    if (!c.undcApiUrl || !c.undcApiKeyCifrada) return null
    return { url: c.undcApiUrl, apiKey: descifrar(c.undcApiKeyCifrada), timeoutMs: c.undcApiTimeoutMs }
}

export interface ConfiguracionPublica {
    google: { clientId: string | null }
    urlPanel: string | null
}

/** Lo que pueden leer el panel (sin sesión) y la landing (con su token): nada secreto. */
export async function configuracionPublica(): Promise<ConfiguracionPublica> {
    const c = await obtenerConfiguracion()
    return { google: { clientId: c.googleClientId }, urlPanel: c.urlPanel }
}

export interface ConfiguracionPanel extends ConfiguracionPublica {
    /** Si la pantalla de ingreso ofrece el código por correo (spec 014). */
    accesoCodigo: { disponible: boolean }
}

/**
 * Configuración pública del panel (`/v1/auth/config`): la pública más la disponibilidad del acceso
 * por código, que decide el módulo de acceso (credencial de correo, plantilla y disyuntor). La landing
 * (`/v1/site/config`) sigue recibiendo solo `configuracionPublica`.
 */
export async function configuracionPanel(accesoCodigoDisponible: () => Promise<boolean>): Promise<ConfiguracionPanel> {
    const [publica, disponible] = await Promise.all([configuracionPublica(), accesoCodigoDisponible().catch(() => false)])
    return { ...publica, accesoCodigo: { disponible } }
}

import dns from 'dns/promises'
import net from 'net'
import { unprocessable } from './http-error'

/**
 * Validación de URLs salientes configuradas por administradores (API_UNDC, deportes-fi):
 * evita SSRF sin necesitar una lista de hosts permitidos (spec 008).
 * - Solo https (http únicamente hacia localhost fuera de producción, para pruebas locales).
 * - En producción se rechazan destinos internos: IP privadas, loopback, link-local, CGNAT,
 *   multicast y nombres como `localhost`, `*.local` o `*.internal`, tanto literales como
 *   resueltos por DNS antes de cada llamada.
 */
const BLOQUEADAS = new net.BlockList()
const REDES_V4: [string, number][] = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
// Las IPv6 con IPv4 incrustada (::ffff:a.b.c.d) ya se comparan con las reglas IPv4 de BlockList;
// agregar ::ffff:0:0/96 bloquearía todas las IPv4. NAT64 (64:ff9b::/96) se bloquea completo.
const REDES_V6: [string, number][] = [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]
for (const [red, prefijo] of REDES_V4) BLOQUEADAS.addSubnet(red, prefijo, 'ipv4')
for (const [red, prefijo] of REDES_V6) BLOQUEADAS.addSubnet(red, prefijo, 'ipv6')

const NOMBRES_INTERNOS = /^(localhost|.+\.localhost|.+\.local|.+\.internal)$/i

export interface OpcionesUrl {
    /** Por defecto `NODE_ENV === 'production'`; las pruebas lo fijan explícitamente. */
    produccion?: boolean
    campo?: string
}

function esProduccion(opciones: OpcionesUrl): boolean {
    return opciones.produccion ?? process.env.NODE_ENV === 'production'
}

function hostDe(url: URL): string {
    return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

export function esDireccionInterna(ip: string): boolean {
    const tipo = net.isIP(ip)
    if (tipo === 4) return BLOQUEADAS.check(ip, 'ipv4')
    if (tipo === 6) return BLOQUEADAS.check(ip, 'ipv6')
    return false
}

/** Valida la URL y la devuelve sin `/` final; lanza 422 `INVALID_URL` o `HOST_NOT_ALLOWED`. */
export function validarUrlSaliente(valor: string, opciones: OpcionesUrl = {}): string {
    const campo = opciones.campo ?? 'La URL'
    let url: URL
    try {
        url = new URL(String(valor).trim())
    } catch {
        throw unprocessable('INVALID_URL', `${campo} no es válida.`)
    }
    if (url.username || url.password) throw unprocessable('INVALID_URL', `${campo} no debe incluir usuario ni contraseña.`)
    const host = hostDe(url)
    const produccion = esProduccion(opciones)
    const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && esLocal && !produccion)) {
        throw unprocessable('INVALID_URL', `${campo} debe usar https.`)
    }
    if (produccion && (NOMBRES_INTERNOS.test(host) || esDireccionInterna(host))) {
        throw unprocessable('HOST_NOT_ALLOWED', `${campo} apunta a una dirección interna.`)
    }
    return url.toString().replace(/\/+$/, '')
}

type Resolver = (host: string) => Promise<{ address: string }[]>
const resolverPorDefecto: Resolver = (host) => dns.lookup(host, { all: true })

/** En producción, comprueba justo antes de llamar que el host resuelva solo a direcciones públicas. */
export async function asegurarDestinoPublico(valor: string, opciones: OpcionesUrl & { resolver?: Resolver } = {}): Promise<void> {
    if (!esProduccion(opciones)) return
    const host = hostDe(new URL(valor))
    if (net.isIP(host)) {
        if (esDireccionInterna(host)) throw unprocessable('HOST_NOT_ALLOWED', 'La URL apunta a una dirección interna.')
        return
    }
    let direcciones: { address: string }[]
    try {
        direcciones = await (opciones.resolver ?? resolverPorDefecto)(host)
    } catch {
        throw unprocessable('HOST_NOT_ALLOWED', `No se pudo resolver ${host}.`)
    }
    if (!direcciones.length || direcciones.some((d) => esDireccionInterna(d.address))) {
        throw unprocessable('HOST_NOT_ALLOWED', 'La URL apunta a una dirección interna.')
    }
}

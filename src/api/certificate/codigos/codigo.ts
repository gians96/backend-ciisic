import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { unprocessable } from '../../../core/http-error'

/**
 * Código local de los certificados (spec 015): `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>`, p. ej.
 * `CIISIC-2026-000123-7KQ2XM`.
 * - PREFIJO: `^[A-Z0-9]{2,20}$` (configuración; se bloquea al haber certificados generados).
 * - AÑO: año del evento (`fechaInicio`), 4 dígitos.
 * - NNNNNN: correlativo del certificado en su evento (`numero`), con ceros a la izquierda.
 * - XXXXXX: 30 bits aleatorios (`crypto.randomInt`) en base 32 de Crockford (sin I, L, O, U): el
 *   código no se adivina a partir del correlativo.
 * Se asigna al emitir y no cambia: va en el nombre de los archivos, en el `Subject` y en el QR.
 */
export const ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const REGEX_PREFIJO = /^[A-Z0-9]{2,20}$/
export const REGEX_CODIGO = /^([A-Z0-9]{2,20})-(\d{4})-(\d{6})-([0-9A-HJKMNP-TV-Z]{6})$/
/** Generación de un archivo: 8 caracteres Crockford (40 bits). */
export const REGEX_GENERACION = /^[0-9A-HJKMNP-TV-Z]{8}$/
export const NUMERO_MAXIMO = 999_999
/** Intentos en total ante una colisión del número o del código (dos emisiones simultáneas en el evento). */
export const INTENTOS_NUMERACION = 5

/** Código en cualquier parte de un nombre de archivo (tolera `[R]`, `_firmado`, `-signed`, minúsculas). */
const CODIGO_EN_TEXTO = /(?<![A-Z0-9])([A-Z0-9]{2,20})-(\d{4})-(\d{6})-([0-9A-HJKMNP-TV-Z]{6})/i

function aleatorioCrockford(caracteres: number): string {
    // 5 bits por carácter; randomInt admite hasta 2^48 - 1
    let valor = crypto.randomInt(0, 2 ** (5 * caracteres))
    let texto = ''
    for (let i = 0; i < caracteres; i++) {
        texto = ALFABETO_CROCKFORD[valor % 32] + texto
        valor = Math.floor(valor / 32)
    }
    return texto
}

export function esPrefijoValido(prefijo: unknown): prefijo is string {
    return typeof prefijo === 'string' && REGEX_PREFIJO.test(prefijo)
}

/** Prefijo en mayúsculas y sin espacios, o 422 `INVALID_PREFIX`. */
export function validarPrefijo(prefijo: string): string {
    const normalizado = String(prefijo ?? '').trim().toUpperCase()
    if (!REGEX_PREFIJO.test(normalizado)) {
        throw unprocessable('INVALID_PREFIX', 'El prefijo debe tener de 2 a 20 letras (A-Z) o números, sin espacios ni guiones.', { prefijo: 'Formato inválido' })
    }
    return normalizado
}

export interface DatosCodigo {
    prefijo: string
    /** Año del evento. */
    anio: number
    /** Correlativo en el evento (1–999999). */
    numero: number
}

/** Código nuevo con parte aleatoria. 422 `INVALID_PREFIX` si el prefijo no es válido. */
export function generarCodigo({ prefijo, anio, numero }: DatosCodigo): string {
    const valido = validarPrefijo(prefijo)
    if (!Number.isInteger(anio) || anio < 1000 || anio > 9999) throw new Error(`Año inválido para el código del certificado: ${anio}`)
    if (!Number.isInteger(numero) || numero < 1 || numero > NUMERO_MAXIMO) throw new Error(`Número de certificado fuera de rango: ${numero}`)
    return `${valido}-${anio}-${String(numero).padStart(6, '0')}-${aleatorioCrockford(6)}`
}

export function esCodigoValido(codigo: unknown): codigo is string {
    return typeof codigo === 'string' && REGEX_CODIGO.test(codigo)
}

export interface PartesCodigo {
    prefijo: string
    anio: number
    numero: number
    aleatorio: string
}

export function partesDeCodigo(codigo: string): PartesCodigo | null {
    const m = REGEX_CODIGO.exec(codigo)
    return m ? { prefijo: m[1], anio: Number(m[2]), numero: Number(m[3]), aleatorio: m[4] } : null
}

/**
 * Código escrito por una persona (verificación pública): sin espacios, en mayúsculas y con las
 * confusiones de Crockford corregidas en la parte aleatoria (O→0, I/L→1). `null` si no tiene el
 * formato: la ruta responde 404 sin consultar la BD.
 */
export function normalizarCodigo(valor: unknown): string | null {
    if (typeof valor !== 'string' || valor.length > 60) return null
    const texto = valor.trim().toUpperCase()
    const m = /^([A-Z0-9]{2,20})-(\d{4})-(\d{6})-([0-9A-Z]{6})$/.exec(texto)
    if (!m) return null
    const aleatorio = m[4].replace(/O/g, '0').replace(/[IL]/g, '1')
    const codigo = `${m[1]}-${m[2]}-${m[3]}-${aleatorio}`
    return REGEX_CODIGO.test(codigo) ? codigo : null
}

/**
 * Código dentro de un nombre de archivo (`CIISIC-2026-000123-7KQ2XM [R].pdf`,
 * `cert_ciisic-2026-000123-7kq2xm_firmado.pdf`…), en mayúsculas, o `null`. Con `prefijo`, se prueba
 * primero ese prefijo exacto (así `certCIISIC-…` también se reconoce).
 */
export function extraerCodigo(nombreArchivo: string, prefijo?: string | null): string | null {
    const nombre = String(nombreArchivo ?? '').split(/[\\/]/).pop() ?? ''
    if (prefijo && REGEX_PREFIJO.test(prefijo)) {
        const exacto = new RegExp(`${prefijo}-(\\d{4})-(\\d{6})-([0-9A-HJKMNP-TV-Z]{6})`, 'i').exec(nombre)
        if (exacto) return `${prefijo}-${exacto[1]}-${exacto[2]}-${exacto[3].toUpperCase()}`
    }
    const m = CODIGO_EN_TEXTO.exec(nombre)
    return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}`.toUpperCase() : null
}

/** Generación nueva de un archivo (8 caracteres Crockford): va en el `Subject` y en el nombre del generado. */
export function nuevaGeneracion(): string {
    return aleatorioCrockford(8)
}

/** Clave única de un certificado vigente: `<evento>:<participante>:<tipo>:<ponencia|->`. */
export function claveVigente(datos: { eventoId: number, participanteId: number, tipoCertificadoId: number, ponenciaId?: string | null }): string {
    return `${datos.eventoId}:${datos.participanteId}:${datos.tipoCertificadoId}:${datos.ponenciaId || '-'}`
}

function objetivoP2002(error: unknown): string | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null
    return JSON.stringify(error.meta?.target ?? '')
}

/** Choque con el número del evento o con el código (se reintenta con otro número y otro código). */
export function esColisionDeNumeracion(error: unknown): boolean {
    const objetivo = objetivoP2002(error)
    return objetivo !== null && /uq_certificados_evento_numero|uq_certificados_codigo\b|"numero"|"codigo"/.test(objetivo)
}

/** Ya hay un certificado vigente con esa clave (evento, participante, tipo, ponencia): 409 `CERTIFICATE_EXISTS`. */
export function esCertificadoDuplicado(error: unknown): boolean {
    const objetivo = objetivoP2002(error)
    return objetivo !== null && /clave_vigente|claveVigente/.test(objetivo)
}

/** Repite `fn` (hasta 5 intentos en total) si choca con el número o el código; otro error se propaga. */
export async function conReintentoDeNumeracion<T>(fn: () => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento++) {
        try {
            return await fn()
        } catch (error) {
            if (intento >= INTENTOS_NUMERACION || !esColisionDeNumeracion(error)) throw error
        }
    }
}

/** `max(numero) + 1` de los certificados del evento (incluidos los anulados: el número no se reutiliza). */
export async function siguienteNumero(tx: Pick<Prisma.TransactionClient, 'certificado'>, eventoId: number): Promise<number> {
    const { _max } = await tx.certificado.aggregate({ where: { eventoId }, _max: { numero: true } })
    return (_max.numero ?? 0) + 1
}

/**
 * Crea un certificado con el siguiente número del evento y un código nuevo, dentro de una
 * transacción, reintentando ante una colisión (dos emisiones a la vez). `crear` recibe la
 * transacción y `{ numero, codigo }`; un P2002 de `clave_vigente` se propaga (`esCertificadoDuplicado`).
 */
export async function crearConNumeroYCodigo<T>(
    datos: { eventoId: number, prefijo: string, anio: number },
    crear: (tx: Prisma.TransactionClient, numerado: { numero: number, codigo: string }) => Promise<T>,
): Promise<T> {
    return conReintentoDeNumeracion(() => prisma.$transaction(async (tx) => {
        const numero = await siguienteNumero(tx, datos.eventoId)
        const codigo = generarCodigo({ prefijo: datos.prefijo, anio: datos.anio, numero })
        return crear(tx, { numero, codigo })
    }))
}

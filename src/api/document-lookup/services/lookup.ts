import type { OrigenConsulta, ProveedorConsulta, ResultadoConsulta, TokenConsulta } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { env } from '../../../../config/env'
import { HttpError, notFound, unprocessable } from '../../../core/http-error'
import { descifrar } from '../../../core/crypto'
import { proveedores } from '../providers'
import { FallaProveedor, type PersonaDni, type TipoFalla } from '../providers/types'
import { guardarCache, leerCache } from './cache'
import { limiteAlcanzado, siguienteRenovacion } from './renewal'

export const REGEX_DNI = /^\d{8}$/

export function enmascarar(numero: string): string {
    return numero.length <= 4 ? '****' : `${numero.slice(0, 2)}${'*'.repeat(numero.length - 4)}${numero.slice(-2)}`
}

const RESULTADO_POR_FALLA: Record<TipoFalla, ResultadoConsulta> = {
    NO_ENCONTRADO: 'NO_ENCONTRADO',
    AGOTADO: 'AGOTADO',
    TOKEN_INVALIDO: 'TOKEN_INVALIDO',
    NO_DISPONIBLE: 'ERROR',
}

interface Registro {
    numero: string
    origen: OrigenConsulta
    resultado: ResultadoConsulta
    token?: Pick<TokenConsulta, 'id' | 'proveedor'>
    codigoHttp?: number
    duracionMs?: number
    detalle?: string
}

async function registrar(registro: Registro): Promise<void> {
    try {
        await prisma.consultaDocumento.create({
            data: {
                tokenConsultaId: registro.token?.id ?? null,
                proveedor: registro.token?.proveedor ?? null,
                tipoDocumento: 'dni',
                numeroMascara: enmascarar(registro.numero),
                resultado: registro.resultado,
                codigoHttp: registro.codigoHttp ?? null,
                duracionMs: registro.duracionMs ?? null,
                origen: registro.origen,
                detalle: registro.detalle?.slice(0, 300) ?? null,
            },
        })
    } catch {
        // La bitácora nunca debe impedir la consulta.
        console.error('No se pudo registrar una consulta de documento')
    }
}

/**
 * Renueva de forma perezosa los tokens cuya fecha de renovación ya pasó: reinicia el
 * contador, vuelve a ACTIVO (salvo INVALIDO) y agenda la siguiente renovación.
 * La actualización es condicional para ser idempotente ante solicitudes concurrentes.
 */
export async function renovarVencidos(ahora = new Date()): Promise<void> {
    const vencidos = await prisma.tokenConsulta.findMany({
        where: { activo: true, periodoRenovacion: { not: 'NINGUNO' }, fechaRenovacion: { lte: ahora } },
    })
    for (const token of vencidos) {
        if (!token.fechaRenovacion) continue
        await prisma.tokenConsulta.updateMany({
            where: { id: token.id, fechaRenovacion: token.fechaRenovacion },
            data: {
                consultasUsadas: 0,
                estado: token.estado === 'INVALIDO' ? 'INVALIDO' : 'ACTIVO',
                agotadoEn: null,
                fechaRenovacion: siguienteRenovacion(token.fechaRenovacion, token.periodoRenovacion, ahora),
            },
        })
    }
}

/** Tokens utilizables en orden de prioridad (menor número = primero). */
export async function tokensDisponibles(ahora = new Date()): Promise<TokenConsulta[]> {
    await renovarVencidos(ahora)
    const tokens = await prisma.tokenConsulta.findMany({
        where: { activo: true, estado: 'ACTIVO' },
        orderBy: [{ prioridad: 'asc' }, { id: 'asc' }],
    })
    return tokens.filter((token) => !limiteAlcanzado(token))
}

/** Suma un uso; si alcanza su límite local lo marca AGOTADO. */
async function contarUso(token: TokenConsulta, exito: boolean): Promise<void> {
    const actualizado = await prisma.tokenConsulta.update({
        where: { id: token.id },
        data: { consultasUsadas: { increment: 1 }, ultimoUsoEn: new Date(), ...(exito ? { ultimoError: null } : {}) },
    })
    if (limiteAlcanzado(actualizado) && actualizado.estado === 'ACTIVO') {
        await prisma.tokenConsulta.update({ where: { id: token.id }, data: { estado: 'AGOTADO', agotadoEn: new Date() } })
    }
}

async function marcar(token: TokenConsulta, falla: FallaProveedor): Promise<void> {
    const ultimoError = falla.message.slice(0, 500)
    if (falla.tipo === 'AGOTADO') {
        await prisma.tokenConsulta.update({ where: { id: token.id }, data: { estado: 'AGOTADO', agotadoEn: new Date(), ultimoError } })
    } else if (falla.tipo === 'TOKEN_INVALIDO') {
        await prisma.tokenConsulta.update({ where: { id: token.id }, data: { estado: 'INVALIDO', ultimoError } })
    } else if (falla.tipo === 'NO_DISPONIBLE') {
        await prisma.tokenConsulta.update({ where: { id: token.id }, data: { ultimoError } })
    }
}

export interface ResultadoDni extends PersonaDni {
    fuente: 'CACHE' | 'PROVEEDOR'
    proveedor: ProveedorConsulta | null
}

/** Consulta un DNI usando un token concreto (lo usa el pool y la prueba del panel). */
export async function consultarConToken(token: TokenConsulta, numero: string, origen: OrigenConsulta): Promise<PersonaDni> {
    const inicio = Date.now()
    try {
        const persona = await proveedores[token.proveedor].consultarDni(numero, descifrar(token.tokenCifrado), env.DNI_LOOKUP_TIMEOUT_MS)
        await contarUso(token, true)
        await guardarCache({ ...persona, numero }, token.proveedor)
        await registrar({ numero, origen, resultado: 'EXITO', token, codigoHttp: 200, duracionMs: Date.now() - inicio })
        return { ...persona, numero }
    } catch (error) {
        const falla = error instanceof FallaProveedor ? error : new FallaProveedor('NO_DISPONIBLE', 'Error inesperado del proveedor')
        if (falla.tipo === 'NO_ENCONTRADO') await contarUso(token, false)
        else await marcar(token, falla)
        await registrar({
            numero, origen, token, resultado: RESULTADO_POR_FALLA[falla.tipo],
            codigoHttp: falla.codigoHttp, duracionMs: Date.now() - inicio, detalle: falla.message,
        })
        throw falla
    }
}

/**
 * Consulta un DNI con el pool de tokens: caché → tokens por prioridad; si un token se agota
 * o es inválido se pasa al siguiente; si un proveedor no encuentra el DNI se prueba otro
 * proveedor antes de responder 404.
 */
export async function consultarDni(numero: string, origen: OrigenConsulta): Promise<ResultadoDni> {
    if (!REGEX_DNI.test(numero)) throw unprocessable('INVALID_DNI', 'El DNI debe tener 8 dígitos.')

    const enCache = await leerCache(numero)
    if (enCache) {
        await registrar({ numero, origen, resultado: 'CACHE' })
        return { ...enCache, fuente: 'CACHE', proveedor: null }
    }

    const tokens = await tokensDisponibles()
    if (!tokens.length) {
        await registrar({ numero, origen, resultado: 'SIN_TOKENS', detalle: 'No hay tokens disponibles' })
        throw new HttpError(503, 'LOOKUP_UNAVAILABLE', 'El servicio de consulta no está disponible. Ingresa tus nombres manualmente.')
    }

    const sinResultado = new Set<ProveedorConsulta>()
    for (const token of tokens) {
        if (sinResultado.has(token.proveedor)) continue
        try {
            const persona = await consultarConToken(token, numero, origen)
            return { ...persona, fuente: 'PROVEEDOR', proveedor: token.proveedor }
        } catch (error) {
            if (error instanceof FallaProveedor && error.tipo === 'NO_ENCONTRADO') sinResultado.add(token.proveedor)
        }
    }

    if (sinResultado.size) throw notFound('DOCUMENT_NOT_FOUND', 'No se encontraron datos para el DNI ingresado.')
    throw new HttpError(503, 'LOOKUP_UNAVAILABLE', 'El servicio de consulta no está disponible. Ingresa tus nombres manualmente.')
}

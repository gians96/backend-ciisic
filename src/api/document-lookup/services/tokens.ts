import type { Prisma, TokenConsulta } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { cifrar, sufijo } from '../../../core/crypto'
import { fechaLima } from '../../../core/fechas'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { FallaProveedor } from '../providers/types'
import { consultarConToken } from './lookup'
import { limiteAlcanzado } from './renewal'
import type { ActualizarTokenInput, CrearTokenInput } from '../validation'

/** Representación segura de un token: nunca incluye el valor, solo su sufijo. */
export function aTokenPublico(token: TokenConsulta) {
    const restante = token.limiteConsultas === null ? null : Math.max(0, token.limiteConsultas - token.consultasUsadas)
    return {
        id: token.id,
        proveedor: token.proveedor,
        nombre: token.nombre,
        tokenEnmascarado: `••••${token.tokenSufijo}`,
        limiteConsultas: token.limiteConsultas,
        consultasUsadas: token.consultasUsadas,
        consultasRestantes: restante,
        porcentajeUso: token.limiteConsultas ? Math.min(100, Math.round((token.consultasUsadas / token.limiteConsultas) * 100)) : null,
        periodoRenovacion: token.periodoRenovacion,
        fechaRenovacion: token.fechaRenovacion,
        prioridad: token.prioridad,
        estado: token.estado,
        activo: token.activo,
        disponible: token.activo && token.estado === 'ACTIVO' && !limiteAlcanzado(token),
        ultimoError: token.ultimoError,
        ultimoUsoEn: token.ultimoUsoEn,
        agotadoEn: token.agotadoEn,
        creadoEn: token.creadoEn,
        actualizadoEn: token.actualizadoEn,
    }
}

async function obtener(id: number): Promise<TokenConsulta> {
    const token = await prisma.tokenConsulta.findUnique({ where: { id } })
    if (!token) throw notFound('LOOKUP_TOKEN_NOT_FOUND', 'El token de consulta no existe.')
    return token
}

export async function listarTokens() {
    const tokens = await prisma.tokenConsulta.findMany({ orderBy: [{ prioridad: 'asc' }, { id: 'asc' }] })
    return tokens.map(aTokenPublico)
}

export async function crearToken(input: CrearTokenInput) {
    const token = await prisma.tokenConsulta.create({
        data: {
            proveedor: input.proveedor,
            nombre: input.nombre,
            tokenCifrado: cifrar(input.token),
            tokenSufijo: sufijo(input.token),
            limiteConsultas: input.limiteConsultas ?? null,
            consultasUsadas: input.consultasUsadas ?? 0,
            periodoRenovacion: input.periodoRenovacion ?? 'MENSUAL',
            fechaRenovacion: input.fechaRenovacion ?? null,
            prioridad: input.prioridad ?? 100,
            activo: input.activo ?? true,
        },
    })
    return aTokenPublico(token)
}

export async function actualizarToken(id: number, input: ActualizarTokenInput) {
    await obtener(id)
    const data: Prisma.TokenConsultaUpdateInput = {}
    if (input.proveedor !== undefined) data.proveedor = input.proveedor
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.token !== undefined) {
        // Un token nuevo vuelve a estar disponible
        data.tokenCifrado = cifrar(input.token)
        data.tokenSufijo = sufijo(input.token)
        data.estado = 'ACTIVO'
        data.ultimoError = null
        data.agotadoEn = null
    }
    if (input.limiteConsultas !== undefined) data.limiteConsultas = input.limiteConsultas
    if (input.consultasUsadas !== undefined) data.consultasUsadas = input.consultasUsadas
    if (input.periodoRenovacion !== undefined) data.periodoRenovacion = input.periodoRenovacion
    if (input.fechaRenovacion !== undefined) data.fechaRenovacion = input.fechaRenovacion
    if (input.prioridad !== undefined) data.prioridad = input.prioridad
    if (input.activo !== undefined) data.activo = input.activo
    const token = await prisma.tokenConsulta.update({ where: { id }, data })
    // Si al ajustar el límite queda agotado o deja de estarlo, se refleja en el estado
    if (token.estado !== 'INVALIDO') {
        const estado = limiteAlcanzado(token) ? 'AGOTADO' : (token.estado === 'AGOTADO' && input.limiteConsultas !== undefined ? 'ACTIVO' : token.estado)
        if (estado !== token.estado) return aTokenPublico(await prisma.tokenConsulta.update({ where: { id }, data: { estado } }))
    }
    return aTokenPublico(token)
}

export async function eliminarToken(id: number) {
    await obtener(id)
    await prisma.tokenConsulta.delete({ where: { id } })
}

/** Reinicia el contador y vuelve a ACTIVO (p. ej. tras renovar el plan manualmente). */
export async function reiniciarToken(id: number) {
    await obtener(id)
    const token = await prisma.tokenConsulta.update({
        where: { id },
        data: { consultasUsadas: 0, estado: 'ACTIVO', agotadoEn: null, ultimoError: null },
    })
    return aTokenPublico(token)
}

/** Prueba un token con un DNI real (consume una consulta del proveedor). */
export async function probarToken(id: number, numero: string) {
    const token = await obtener(id)
    try {
        const persona = await consultarConToken(token, numero, 'PANEL')
        return { ok: true, persona, token: aTokenPublico(await obtener(id)) }
    } catch (error) {
        const falla = error instanceof FallaProveedor ? error : new FallaProveedor('NO_DISPONIBLE', 'Error inesperado')
        return { ok: false, falla: { tipo: falla.tipo, mensaje: falla.message, codigoHttp: falla.codigoHttp ?? null }, token: aTokenPublico(await obtener(id)) }
    }
}

/** Uso agregado de los últimos `dias` días: por día/resultado y por token. */
export async function usoConsultas(dias: number) {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    const [filas, porToken, tokens] = await Promise.all([
        prisma.consultaDocumento.findMany({ where: { creadoEn: { gte: desde } }, select: { creadoEn: true, resultado: true } }),
        prisma.consultaDocumento.groupBy({ by: ['tokenConsultaId', 'resultado'], where: { creadoEn: { gte: desde } }, _count: { _all: true } }),
        prisma.tokenConsulta.findMany({ select: { id: true, nombre: true, proveedor: true } }),
    ])
    const porDia = new Map<string, Record<string, number>>()
    for (const fila of filas) {
        const dia = fechaLima(fila.creadoEn)
        const acumulado = porDia.get(dia) ?? {}
        acumulado[fila.resultado] = (acumulado[fila.resultado] ?? 0) + 1
        porDia.set(dia, acumulado)
    }
    const nombres = new Map(tokens.map((token) => [token.id, token]))
    const resumenTokens = new Map<string, { tokenConsultaId: number | null, nombre: string, proveedor: string | null, resultados: Record<string, number> }>()
    for (const fila of porToken) {
        const clave = String(fila.tokenConsultaId ?? 'cache')
        const info = fila.tokenConsultaId ? nombres.get(fila.tokenConsultaId) : undefined
        const entrada = resumenTokens.get(clave) ?? {
            tokenConsultaId: fila.tokenConsultaId,
            nombre: info?.nombre ?? (fila.tokenConsultaId ? 'Token eliminado' : 'Caché / sin token'),
            proveedor: info?.proveedor ?? null,
            resultados: {},
        }
        entrada.resultados[fila.resultado] = fila._count._all
        resumenTokens.set(clave, entrada)
    }
    return {
        desde,
        porDia: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, resultados]) => ({ fecha, ...resultados })),
        porToken: [...resumenTokens.values()],
    }
}

export async function bitacora(paginacion: Pagination) {
    const [total, filas] = await Promise.all([
        prisma.consultaDocumento.count(),
        prisma.consultaDocumento.findMany({
            orderBy: { id: 'desc' },
            skip: paginacion.skip,
            take: paginacion.take,
            include: { token: { select: { nombre: true } } },
        }),
    ])
    return {
        data: filas.map((fila) => ({
            id: fila.id,
            creadoEn: fila.creadoEn,
            numero: fila.numeroMascara,
            proveedor: fila.proveedor,
            token: fila.token?.nombre ?? null,
            resultado: fila.resultado,
            codigoHttp: fila.codigoHttp,
            duracionMs: fila.duracionMs,
            origen: fila.origen,
            detalle: fila.detalle,
        })),
        meta: pageMeta(paginacion, total),
    }
}

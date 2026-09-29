import type { Prisma, TokenAcceso } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { generarTokenAcceso } from '../../../core/tokens-acceso'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { CrearTokenAccesoInput } from '../validation'

const conCreador = { creadoPor: { select: { id: true, nombres: true, apellidos: true } } } satisfies Prisma.TokenAccesoInclude
type TokenConCreador = TokenAcceso & { creadoPor: { id: number, nombres: string, apellidos: string } | null }

export function estadoDelToken(token: Pick<TokenAcceso, 'revocadoEn' | 'expiraEn'>, ahora = new Date()) {
    if (token.revocadoEn) return 'REVOCADO' as const
    if (token.expiraEn && token.expiraEn <= ahora) return 'EXPIRADO' as const
    return 'ACTIVO' as const
}

export function aTokenAcceso(token: TokenConCreador) {
    return {
        id: token.id,
        eventoId: token.eventoId,
        nombre: token.nombre,
        prefijo: token.prefijo,
        estado: estadoDelToken(token),
        ultimoUsoEn: token.ultimoUsoEn,
        expiraEn: token.expiraEn,
        revocadoEn: token.revocadoEn,
        creadoPor: token.creadoPor,
        creadoEn: token.creadoEn,
    }
}

export async function listarTokensAcceso(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const tokens = await prisma.tokenAcceso.findMany({ where: { eventoId }, include: conCreador, orderBy: { id: 'desc' } })
    return tokens.map(aTokenAcceso)
}

/** Crea un token y devuelve su valor en claro UNA sola vez (en BD solo queda el hash). */
export async function crearTokenAcceso(eventoId: number, input: CrearTokenAccesoInput, creadoPorId?: number) {
    await obtenerEventoPorId(eventoId)
    const { token, prefijo, hash } = generarTokenAcceso()
    const creado = await prisma.tokenAcceso.create({
        data: {
            eventoId,
            nombre: input.nombre,
            prefijo,
            tokenHash: hash,
            expiraEn: input.expiraEn ?? null,
            creadoPorId: creadoPorId ?? null,
        },
        include: conCreador,
    })
    return { ...aTokenAcceso(creado), token }
}

/** Revoca el token (se conserva el registro para auditoría). Idempotente. */
export async function revocarTokenAcceso(id: number) {
    const token = await prisma.tokenAcceso.findUnique({ where: { id }, include: conCreador })
    if (!token) throw notFound('ACCESS_TOKEN_NOT_FOUND', 'El token de acceso no existe.')
    if (token.revocadoEn) return aTokenAcceso(token)
    return aTokenAcceso(await prisma.tokenAcceso.update({ where: { id }, data: { revocadoEn: new Date() }, include: conCreador }))
}

import net from 'net'
import type { Evento } from '@prisma/client'
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../database/prisma'
import { HttpError, notFound } from '../core/http-error'
import { hashTokenAcceso, tieneFormatoDeTokenAcceso } from '../core/tokens-acceso'

/**
 * API del sitio (spec 007): la landing de cada evento llama a `/api/v1/site/*` desde su
 * servidor con `X-Api-Key: <token del evento>`. El evento sale SOLO del token.
 * Con un token válido se acepta `X-Client-Ip` (IP del visitante que reenvía el BFF de la
 * landing) para aplicar los límites por visitante y no por servidor.
 */
export interface SitioRequest extends Request {
    eventoSitio?: Evento
    tokenAccesoId?: number
    clienteIp?: string
}

// Un sitio puede prepararse con el evento en borrador; los archivados dejan de responder.
const ESTADOS_CON_SITIO = new Set<Evento['estado']>(['BORRADOR', 'PUBLICADO', 'FINALIZADO'])
const INTERVALO_REGISTRO_USO_MS = 5 * 60 * 1000
const ultimoRegistroDeUso = new Map<number, number>()

function ipDelVisitante(req: Request): string | undefined {
    const valor = String(req.headers['x-client-ip'] ?? '').trim()
    return net.isIP(valor) ? valor : undefined
}

/** Guarda `ultimo_uso_en` como máximo cada 5 minutos por token (sin bloquear la respuesta). */
function registrarUso(tokenId: number, ahora: Date) {
    const anterior = ultimoRegistroDeUso.get(tokenId) ?? 0
    if (ahora.getTime() - anterior < INTERVALO_REGISTRO_USO_MS) return
    ultimoRegistroDeUso.set(tokenId, ahora.getTime())
    Promise.resolve()
        .then(() => prisma.tokenAcceso.update({ where: { id: tokenId }, data: { ultimoUsoEn: ahora } }))
        .catch(() => undefined)
}

export async function requireTokenEvento(req: SitioRequest, _res: Response, next: NextFunction): Promise<void> {
    const token = String(req.headers['x-api-key'] ?? '').trim()
    if (!token) throw new HttpError(401, 'EVENT_TOKEN_REQUIRED', 'Falta el token de acceso del evento (cabecera X-Api-Key).')

    const registro = tieneFormatoDeTokenAcceso(token)
        ? await prisma.tokenAcceso.findUnique({ where: { tokenHash: hashTokenAcceso(token) }, include: { evento: true } })
        : null
    const ahora = new Date()
    if (!registro || registro.revocadoEn || (registro.expiraEn && registro.expiraEn <= ahora)) {
        throw new HttpError(401, 'INVALID_EVENT_TOKEN', 'El token de acceso del evento no es válido, fue revocado o expiró.')
    }
    if (!ESTADOS_CON_SITIO.has(registro.evento.estado)) throw notFound('EVENT_NOT_FOUND', 'El evento no está disponible.')

    req.eventoSitio = registro.evento
    req.tokenAccesoId = registro.id
    req.clienteIp = ipDelVisitante(req) ?? req.ip
    registrarUso(registro.id, ahora)
    next()
}

/** Evento resuelto por `requireTokenEvento`. */
export function eventoDelSitio(req: Request): Evento {
    const evento = (req as SitioRequest).eventoSitio
    if (!evento) throw new HttpError(401, 'EVENT_TOKEN_REQUIRED', 'Falta el token de acceso del evento (cabecera X-Api-Key).')
    return evento
}

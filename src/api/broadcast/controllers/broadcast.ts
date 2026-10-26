import type { Request, Response } from 'express'
import { badRequest, idParam } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { parsePagination } from '../../../core/pagination'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import * as destinatarios from '../services/destinatarios'
import * as enviar from '../services/enviar'
import type { EnviarEnlacesCredencialInput, EnviarInvitacionPonenciasInput, ProbarInvitacionPonenciasInput } from '../validation'

/** La guarda de permisos deja la cuenta en `req.actor`; sin ella la ruta está mal cableada. */
function actorDe(req: Request): Actor {
    const actor = (req as AuthenticatedRequest).actor
    if (!actor) throw new Error('Ruta de envíos masivos sin guarda de permisos')
    return actor
}

function filtrosDe(query: Request['query']): destinatarios.FiltrosDestinatarios {
    const { q, enviado } = query
    if (q !== undefined && typeof q !== 'string') throw badRequest('INVALID_FILTER', 'Filtro inválido.')
    if (enviado !== undefined && enviado !== '' && enviado !== 'si' && enviado !== 'no') throw badRequest('INVALID_FILTER', 'El filtro enviado no es válido.')
    return { q: q?.trim().slice(0, 100) || undefined, enviado: enviado === 'si' || enviado === 'no' ? enviado : undefined }
}

/** Respuestas con datos de personas: nunca en cachés. */
function sinCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
}

/** `GET …/credential-links` y `…/specialized-talk-invitations`: una página de destinatarios con su marca de envío. */
export function listar(canal: destinatarios.Canal) {
    return async (req: Request, res: Response) => {
        const { data, meta } = await destinatarios.listarDestinatarios(idParam(req.params.eventId, 'eventId'), canal, filtrosDe(req.query), parsePagination(req.query, 20, 100))
        sinCache(res)
        res.json({ success: true, data, meta })
    }
}

/** `GET …/ids`: todos los ids con los filtros dados, para elegirlos y enviar por tandas. */
export function ids(canal: destinatarios.Canal) {
    return async (req: Request, res: Response) => {
        const { ids: lista, total } = await destinatarios.idsDestinatarios(idParam(req.params.eventId, 'eventId'), canal, filtrosDe(req.query))
        sinCache(res)
        res.json({ success: true, data: lista, meta: { total } })
    }
}

export async function sendCredentialLinks(req: Request, res: Response) {
    res.json({ success: true, data: await enviar.enviarEnlacesCredencial(idParam(req.params.eventId, 'eventId'), req.body as EnviarEnlacesCredencialInput, actorDe(req)) })
}

export async function sendTalkInvitations(req: Request, res: Response) {
    res.json({ success: true, data: await enviar.enviarInvitacionPonencias(idParam(req.params.eventId, 'eventId'), req.body as EnviarInvitacionPonenciasInput, actorDe(req)) })
}

export async function testTalkInvitation(req: Request, res: Response) {
    res.json({ success: true, data: await enviar.probarInvitacionPonencias(idParam(req.params.eventId, 'eventId'), req.body as ProbarInvitacionPonenciasInput, actorDe(req)) })
}

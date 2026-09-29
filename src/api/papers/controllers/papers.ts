import type { Request, Response } from 'express'
import { ValidationError } from 'yup'
import path from 'path'
import { badRequest, idParam, notFound, unprocessable } from '../../../core/http-error'
import { obtenerEventoPorId, obtenerEventoPrincipal } from '../../event/services/public-event'
import { paperSchema } from '../validation'
import { hasPdfSignature } from '../upload'
import { createPaper, findPaper, listPapers, papersDirectory, PAPERS_POR_PAGINA } from '../services/papers'
import { eventoDelSitio } from '../../../middlewares/sitio'

async function registrar(eventoId: number, req: Request) {
    if (!req.file || !hasPdfSignature(req.file.buffer)) throw unprocessable('INVALID_PDF', 'Adjunta un archivo PDF válido y no vacío.')
    try {
        const raw = JSON.parse(typeof req.body.data === 'string' ? req.body.data : '')
        const data = await paperSchema.validate(raw, { abortEarly: false, stripUnknown: true })
        return await createPaper(eventoId, data, req.file)
    } catch (error) {
        if (error instanceof SyntaxError || error instanceof ValidationError) {
            throw unprocessable('INVALID_PAPER', 'Completa título, nombres, apellidos y universidad de cada autor. Se permiten hasta tres coautores.')
        }
        throw error
    }
}

export async function publicCreate(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    res.status(201).json({ success: true, data: await registrar(evento.id, req) })
}

/** Legacy: `POST /v1/papers` asociado al evento principal. */
export async function create(req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    res.status(201).json({ success: true, data: await registrar(evento.id, req) })
}

function pagina(req: Request): number {
    const page = Number(req.query.page || 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw badRequest('INVALID_PAGE', 'Página inválida.')
    return page
}

export async function listByEvent(req: Request, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const page = pagina(req)
    const { total, ponencias } = await listPapers(evento.id, page)
    res.json({ success: true, data: ponencias, meta: { page, pageSize: PAPERS_POR_PAGINA, total } })
}

/** Legacy: `GET /v1/papers` (evento principal). */
export async function list(req: Request, res: Response) {
    const evento = await obtenerEventoPrincipal()
    const page = pagina(req)
    const { ponencias } = await listPapers(evento.id, page)
    res.json({ success: true, data: ponencias, page, pageSize: PAPERS_POR_PAGINA })
}

export async function download(req: Request, res: Response) {
    const id = String(req.params.id)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw badRequest('INVALID_ID', 'Código de recepción inválido.')
    const paper = await findPaper(id)
    if (!paper) throw notFound('PAPER_NOT_FOUND', 'Ponencia no encontrada.')
    res.setHeader('Cache-Control', 'private, no-store')
    await new Promise<void>((resolve, reject) => {
        res.download(path.join(papersDirectory, path.basename(paper.archivo)), `ponencia-${paper.id}.pdf`, (error) => {
            if (error && !res.headersSent) reject(notFound('FILE_NOT_FOUND', 'Archivo no encontrado.'))
            else resolve()
        })
    })
}

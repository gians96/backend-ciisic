import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import * as service from '../services/participant'

export async function list(req: Request, res: Response) {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined
    res.json({ success: true, ...(await service.listarParticipantes(q, parsePagination(req.query))) })
}

export async function find(req: Request, res: Response) {
    res.json({ success: true, data: await service.obtenerParticipante(idParam(req.params.id)) })
}

export async function update(req: Request, res: Response) {
    res.json({ success: true, data: await service.actualizarParticipante(idParam(req.params.id), req.body) })
}

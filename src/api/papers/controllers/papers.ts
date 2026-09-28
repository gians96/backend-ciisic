import type { Request, Response, NextFunction } from 'express'
import { ValidationError } from 'yup'
import path from 'path'
import { paperSchema } from '../validation'
import { hasPdfSignature } from '../upload'
import { createPaper, findPaper, listPapers, papersDirectory } from '../services/papers'

export async function create(req: Request, res: Response, next: NextFunction) {
  if (!req.file || !hasPdfSignature(req.file.buffer)) {
    res.status(422).json({ success: false, code: 'INVALID_PDF', message: 'Adjunta un archivo PDF válido y no vacío.' })
    return
  }
  try {
    const raw = JSON.parse(typeof req.body.data === 'string' ? req.body.data : '')
    const data = await paperSchema.validate(raw, { abortEarly: false, stripUnknown: true })
    const receipt = await createPaper(data, req.file)
    res.status(201).json({ success: true, data: receipt })
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ValidationError) {
      res.status(422).json({ success: false, code: 'INVALID_PAPER', message: 'Completa título, nombres, apellidos y universidad de cada autor. Se permiten hasta tres coautores.' })
      return
    }
    next(error)
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  const page = Number(req.query.page || 1)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) {
    res.status(400).json({ success: false, message: 'Página inválida.' })
    return
  }
  try { res.json({ success: true, data: await listPapers(page), page, pageSize: 50 }) } catch (error) { next(error) }
}

export async function download(req: Request, res: Response, next: NextFunction) {
  const id = String(req.params.id)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ success: false, message: 'Código de recepción inválido.' })
    return
  }
  try {
    const paper = await findPaper(id)
    if (!paper) { res.status(404).json({ success: false, message: 'Paper no encontrado.' }); return }
    res.setHeader('Cache-Control', 'private, no-store')
    res.download(path.join(papersDirectory, path.basename(paper.filename)), `paper-${paper.id}.pdf`, error => {
      if (error && !res.headersSent) next(Object.assign(error, { statusCode: 404, message: 'Archivo no encontrado.' }))
    })
  } catch (error) { next(error) }
}

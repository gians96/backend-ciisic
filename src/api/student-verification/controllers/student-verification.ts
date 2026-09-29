import { Request, Response } from 'express'
import { aRespuestaPublica, verificarEstudiante } from '../services/student-verification'
import { eventoDelSitio } from '../../../middlewares/sitio'

export async function publicVerify(req: Request, res: Response) {
    const evento = eventoDelSitio(req)
    const resultado = await verificarEstudiante(evento, req.body)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: aRespuestaPublica(resultado) })
}

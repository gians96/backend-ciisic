import { Request, Response } from 'express'
import { obtenerEventoPublico } from '../../event/services/public-event'
import { aRespuestaPublica, verificarEstudiante } from '../services/student-verification'

export async function publicVerify(req: Request, res: Response) {
    const evento = await obtenerEventoPublico(String(req.params.codigo))
    const resultado = await verificarEstudiante(evento, req.body)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: aRespuestaPublica(resultado) })
}

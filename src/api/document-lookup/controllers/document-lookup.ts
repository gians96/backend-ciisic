import { Request, Response } from 'express'
import { idParam } from '../../../core/http-error'
import { parsePagination } from '../../../core/pagination'
import { apellidosDe } from '../services/cache'
import { consultarDni } from '../services/lookup'
import * as tokens from '../services/tokens'

function respuestaPersona(persona: Awaited<ReturnType<typeof consultarDni>>) {
    return {
        numero: persona.numero,
        nombres: persona.nombres,
        apellidoPaterno: persona.apellidoPaterno,
        apellidoMaterno: persona.apellidoMaterno,
        apellidos: apellidosDe(persona),
    }
}

// Público (landing)
export async function publicDni(req: Request, res: Response) {
    const persona = await consultarDni(String(req.params.numero), 'LANDING')
    res.setHeader('Cache-Control', 'no-store')
    res.json({ success: true, data: respuestaPersona(persona) })
}

// Legacy: GET /v1/reniec/dni?number= (forma normalizada anterior)
export async function legacyReniec(req: Request, res: Response) {
    const persona = await consultarDni(String(req.query.number ?? ''), 'LANDING')
    res.setHeader('Cache-Control', 'no-store')
    res.json({ numero: persona.numero, idTipoDocumento: 'dni', nombres: persona.nombres, apellidos: apellidosDe(persona) })
}

// Administración
export async function adminDni(req: Request, res: Response) {
    const persona = await consultarDni(String(req.params.numero), 'PANEL')
    res.json({ success: true, data: { ...respuestaPersona(persona), fuente: persona.fuente, proveedor: persona.proveedor } })
}

export async function listTokens(_req: Request, res: Response) {
    res.json({ success: true, data: await tokens.listarTokens() })
}

export async function createToken(req: Request, res: Response) {
    res.status(201).json({ success: true, data: await tokens.crearToken(req.body) })
}

export async function updateToken(req: Request, res: Response) {
    res.json({ success: true, data: await tokens.actualizarToken(idParam(req.params.id), req.body) })
}

export async function removeToken(req: Request, res: Response) {
    await tokens.eliminarToken(idParam(req.params.id))
    res.json({ success: true, data: null })
}

export async function resetToken(req: Request, res: Response) {
    res.json({ success: true, data: await tokens.reiniciarToken(idParam(req.params.id)) })
}

export async function testToken(req: Request, res: Response) {
    res.json({ success: true, data: await tokens.probarToken(idParam(req.params.id), req.body.numero) })
}

export async function usage(req: Request, res: Response) {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 366)
    res.json({ success: true, data: await tokens.usoConsultas(dias) })
}

export async function logs(req: Request, res: Response) {
    const resultado = await tokens.bitacora(parsePagination(req.query, 50))
    res.json({ success: true, ...resultado })
}

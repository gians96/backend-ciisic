import type { Request, Response } from 'express'
import { unprocessable } from '../../../core/http-error'
import { generarExcel } from '../exports/excel'
import { generarPdf } from '../exports/pdf'
import { contentDisposition, nombreDeArchivo, type DatosReporte } from '../exports/reporte'
import { enlaceInvalido } from '../services/enlaces'
import { seguimientoDelCiclo, seguimientoDelEnlace } from '../services/publico'

/**
 * Rutas **sin sesión** del docente (spec 026) y del ciclo (spec 027). El token va en `X-Link-Token` y no en la
 * URL: así no queda en los registros de acceso ni en el historial; el navegador lo lleva tras el `#` del enlace,
 * que no se envía a ningún servidor. Un token faltante, mal formado, desconocido o desactivado responde lo mismo.
 */
function tokenDe(req: Request): string {
    const token = req.header('x-link-token')
    if (typeof token !== 'string' || !token.trim()) throw enlaceInvalido()
    return token.trim()
}

/** Datos de personas y pagos: nada de esto se guarda en cachés compartidas ni se indexa. */
function privado(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
}

function formatoDe(req: Request): 'xlsx' | 'pdf' {
    const pedido = typeof req.query.formato === 'string' ? req.query.formato.trim().toLowerCase() : 'xlsx'
    if (pedido !== 'xlsx' && pedido !== 'pdf') throw unprocessable('VALIDATION_ERROR', 'Los filtros no son válidos', { formato: 'Debe ser xlsx o pdf' })
    return pedido
}

async function enviarReporte(res: Response, reporte: DatosReporte, formato: 'xlsx' | 'pdf') {
    const contenido = formato === 'pdf' ? await generarPdf(reporte) : await generarExcel(reporte)
    privado(res)
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', contentDisposition(nombreDeArchivo(reporte.titulo, formato)))
    res.send(contenido)
}

/** `GET /v1/public/advisor` — el avance de los estudiantes del docente dueño del enlace. */
export async function view(req: Request, res: Response) {
    const { vista } = await seguimientoDelEnlace(tokenDe(req))
    privado(res)
    res.json({ success: true, data: vista })
}

/** `GET /v1/public/advisor/export?formato=xlsx|pdf` — su reporte, sin DNI, correo ni montos. */
export async function exportFile(req: Request, res: Response) {
    const formato = formatoDe(req)
    const { reporte } = await seguimientoDelEnlace(tokenDe(req))
    await enviarReporte(res, reporte, formato)
}

/** `GET /v1/public/cycle` — el avance de todos los estudiantes del ciclo dueño del enlace. */
export async function cycleView(req: Request, res: Response) {
    const { vista } = await seguimientoDelCiclo(tokenDe(req))
    privado(res)
    res.json({ success: true, data: vista })
}

/** `GET /v1/public/cycle/export?formato=xlsx|pdf` — su reporte, sin DNI, correo, celular ni montos. */
export async function cycleExportFile(req: Request, res: Response) {
    const formato = formatoDe(req)
    const { reporte } = await seguimientoDelCiclo(tokenDe(req))
    await enviarReporte(res, reporte, formato)
}

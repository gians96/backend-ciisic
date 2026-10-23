import type { Request, Response } from 'express'
import { conflict, idParam, notFound, unprocessable } from '../../../core/http-error'
import { parsePagination, pageMeta } from '../../../core/pagination'
import { fechaLima } from '../../../core/fechas'
import { esLibroXlsx } from '../../../middlewares/upload'
import type { AuthenticatedRequest } from '../../../middlewares/auth'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { cargarSeguimiento } from '../services/consulta'
import { importarPadron, MODOS_ASESORES, type ModoAsesores } from '../services/importacion'
import {
    ETIQUETA_SITUACION,
    FILTROS_SITUACION,
    etiquetaSeccion,
    filtrarAlcance,
    filtrarFilas,
    opcionesDeFiltro,
    resumir,
    type CursoEstudiante,
    type FiltroSituacion,
    type FiltrosSeguimiento,
    type ResumenSeguimiento,
} from '../services/seguimiento'
import { generarExcel } from '../exports/excel'
import { generarPdf } from '../exports/pdf'
import { contentDisposition, nombreDeArchivo, type DatosReporte } from '../exports/reporte'

/** Sin «pagos.ver» (Comisión) no salen montos, recaudado ni fechas de pago; la situación sí. */
function conPago(req: AuthenticatedRequest): boolean {
    return req.actor?.permisos.has('pagos.ver') === true
}

function texto(valor: unknown, maximo = 10): string | undefined {
    return typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, maximo) : undefined
}

/** Lee los filtros de la consulta; uno inválido responde 422 en lugar de ignorarse (el reporte saldría sin filtrar). */
function filtrosDe(query: Request['query']): FiltrosSeguimiento {
    const errores: Record<string, string> = {}
    let asesorId: number | undefined
    if (query.asesorId !== undefined && query.asesorId !== '') {
        const numero = Number(query.asesorId)
        if (Number.isSafeInteger(numero) && numero > 0) asesorId = numero
        else errores.asesorId = 'Debe ser un número válido'
    }
    let cursoId: number | undefined
    if (query.cursoId !== undefined && query.cursoId !== '') {
        const numero = Number(query.cursoId)
        if (Number.isSafeInteger(numero) && numero > 0) cursoId = numero
        else errores.cursoId = 'Debe ser un número válido'
    }
    let situacion: FiltroSituacion | undefined
    const pedida = texto(query.situacion, 20)?.toUpperCase()
    if (pedida) {
        if ((FILTROS_SITUACION as readonly string[]).includes(pedida)) situacion = pedida as FiltroSituacion
        else errores.situacion = `Debe ser ${FILTROS_SITUACION.join(', ')}`
    }
    if (Object.keys(errores).length) throw unprocessable('VALIDATION_ERROR', 'Los filtros no son válidos', errores)
    return {
        asesorId,
        cursoId,
        ciclo: texto(query.ciclo),
        seccion: texto(query.seccion),
        turno: texto(query.turno),
        situacion,
        q: texto(query.q, 100),
    }
}

function hayAlcance(filtros: FiltrosSeguimiento): boolean {
    return filtros.asesorId !== undefined || filtros.cursoId !== undefined || Boolean(filtros.ciclo || filtros.seccion || filtros.turno)
}

/** Con un alcance elegido, los asesores sin alumnos en él no aportan filas al resumen. */
function resumenDelAlcance(resumen: ResumenSeguimiento, filtros: FiltrosSeguimiento): ResumenSeguimiento {
    if (!hayAlcance(filtros)) return resumen
    return { ...resumen, porAsesor: resumen.porAsesor.filter((asesor) => asesor.alumnos > 0 && (filtros.asesorId === undefined || asesor.id === filtros.asesorId)) }
}

/** `GET /v1/events/:eventId/advisory/summary` — indicadores y cuadros del alcance elegido (asesor, ciclo, sección, turno). */
export async function summary(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const filtros = filtrosDe(req.query)
    const pago = conPago(req)
    const seguimiento = await cargarSeguimiento(evento.id, pago)
    const resumen = resumir(filtrarAlcance(seguimiento.filas, filtros), seguimiento.asesores, pago)
    res.json({
        success: true,
        data: {
            semestre: seguimiento.semestre,
            importadoEn: seguimiento.importadoEn?.toISOString() ?? null,
            generadoEn: new Date().toISOString(),
            hayPadron: seguimiento.filas.length > 0,
            conPago: pago,
            opciones: opcionesDeFiltro(seguimiento.filas, seguimiento.asesores),
            ...resumenDelAlcance(resumen, filtros),
        },
    })
}

/** `GET /v1/events/:eventId/advisory/students` — listado paginado con todos los filtros. */
export async function students(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const filtros = filtrosDe(req.query)
    const seguimiento = await cargarSeguimiento(evento.id, conPago(req))
    const filas = filtrarFilas(seguimiento.filas, filtros)
    const paginacion = parsePagination(req.query, 50, 200)
    res.json({ success: true, data: filas.slice(paginacion.skip, paginacion.skip + paginacion.take), meta: pageMeta(paginacion, filas.length) })
}

function descripcionDeFiltros(filtros: FiltrosSeguimiento, curso?: CursoEstudiante): string[] {
    return [
        ...(curso ? [`Curso: ${curso.nombre} (${etiquetaSeccion(curso.ciclo, curso.seccion)})`] : []),
        ...(filtros.ciclo ? [`Ciclo: ${filtros.ciclo.toUpperCase()}`] : []),
        ...(filtros.seccion ? [`Sección: ${filtros.seccion.toUpperCase()}`] : []),
        ...(filtros.turno ? [`Turno: ${filtros.turno.toUpperCase()}`] : []),
        ...(filtros.situacion ? [`Situación: ${filtros.situacion === 'NO_PAGADO' ? 'No pagaron' : ETIQUETA_SITUACION[filtros.situacion]}`] : []),
        ...(filtros.q ? [`Búsqueda: «${filtros.q}»`] : []),
    ]
}

/**
 * `GET /v1/events/:eventId/advisory/export?formato=xlsx|pdf` — el reporte con los filtros de la consulta.
 * Con `asesorId` es el reporte de ese docente (su nombre es el del archivo). Siempre se calcula en el
 * momento de la descarga.
 */
export async function exportFile(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    const formato = texto(req.query.formato, 10)?.toLowerCase() ?? 'xlsx'
    if (formato !== 'xlsx' && formato !== 'pdf') {
        throw unprocessable('VALIDATION_ERROR', 'Los filtros no son válidos', { formato: 'Debe ser xlsx o pdf' })
    }
    const filtros = filtrosDe(req.query)
    const pago = conPago(req)
    const seguimiento = await cargarSeguimiento(evento.id, pago)
    if (!seguimiento.filas.length) throw conflict('PADRON_NOT_LOADED', 'Aún no se cargó el padrón de estudiantes de este evento.')
    const asesor = filtros.asesorId === undefined ? undefined : seguimiento.asesores.find((a) => a.id === filtros.asesorId)
    if (filtros.asesorId !== undefined && !asesor) throw notFound('ADVISOR_NOT_FOUND', 'El asesor no existe en este evento.')
    const curso = filtros.cursoId === undefined ? undefined : seguimiento.filas.flatMap((f) => f.cursos).find((c) => c.id === filtros.cursoId)
    if (filtros.cursoId !== undefined && !curso) throw notFound('COURSE_NOT_FOUND', 'El curso no existe en este evento.')

    const alcance = filtrarAlcance(seguimiento.filas, filtros)
    const generadoEn = new Date()
    const datos: DatosReporte = {
        evento: { nombre: evento.nombre, codigo: evento.codigo },
        semestre: seguimiento.semestre,
        generadoEn,
        titulo: asesor ? asesor.nombre : curso ? `${curso.nombre} · ${etiquetaSeccion(curso.ciclo, curso.seccion)}` : 'Seguimiento de estudiantes por asesor',
        filtros: descripcionDeFiltros(filtros, curso),
        conPago: pago,
        alcance,
        filas: filtrarFilas(seguimiento.filas, filtros),
        resumen: resumenDelAlcance(resumir(alcance, seguimiento.asesores, pago), filtros),
        conTablaDeAsesores: !asesor && !curso,
    }

    const base = asesor
        ? asesor.nombre
        : curso
            ? `${curso.nombre} ${etiquetaSeccion(curso.ciclo, curso.seccion)}`
            : ['Seguimiento', evento.codigo, filtros.ciclo, filtros.seccion, fechaLima(generadoEn)].filter(Boolean).join(' ')
    const archivo = nombreDeArchivo(base, formato)
    const contenido = formato === 'pdf' ? await generarPdf(datos) : await generarExcel(datos)
    res.setHeader('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', contentDisposition(archivo))
    res.setHeader('Cache-Control', 'no-store')
    res.send(contenido)
}

/**
 * `POST /v1/events/:eventId/advisory/import` (multipart `file`, opcional `semestre`) — carga el Excel de la
 * facultad. Con `?simular=true` solo valida y cuenta; sin él, reemplaza el padrón de estudiantes del evento. Los docentes ya cargados se
 * conservan salvo que se envíe `asesores=reemplazar` (spec 028).
 */
export async function importPadron(req: AuthenticatedRequest, res: Response) {
    const evento = await obtenerEventoPorId(idParam(req.params.eventId, 'eventId'))
    if (!req.file) throw unprocessable('VALIDATION_ERROR', 'Adjunta el Excel del padrón.', { file: 'Requerido' })
    if (!esLibroXlsx(req.file.buffer)) throw unprocessable('INVALID_FILE_CONTENT', 'El contenido del archivo no coincide con un Excel (.xlsx).')
    const simular = req.query.simular === 'true'
    const semestre = typeof req.body?.semestre === 'string' && req.body.semestre.trim() ? req.body.semestre.trim() : undefined
    // Qué hacer con los docentes ya cargados (spec 028): sin indicarlo se conservan; solo se reemplazan si se pide
    const pedido = typeof req.body?.asesores === 'string' ? req.body.asesores.trim().toLowerCase() : undefined
    if (pedido && !(MODOS_ASESORES as readonly string[]).includes(pedido)) {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { asesores: 'Debe ser conservar o reemplazar' })
    }
    const resultado = await importarPadron(evento.id, req.file.buffer, { aplicar: !simular, semestre, asesores: pedido as ModoAsesores | undefined })
    res.status(simular ? 200 : 201).json({ success: true, data: resultado })
}

import { fechaLima, horaLima } from '../../../core/fechas'
import {
    ETIQUETA_SITUACION,
    etiquetaSeccion,
    type Contadores,
    type FilaSeguimiento,
    type ResumenSeguimiento,
    type Situacion,
} from '../services/seguimiento'

/** Lo que necesitan los dos formatos (Excel y PDF) para armar el mismo reporte. */
export interface DatosReporte {
    evento: { nombre: string, codigo: string }
    /** Semestre del padrón. */
    semestre: string | null
    generadoEn: Date
    /** Título: el nombre del asesor o «Seguimiento de estudiantes por asesor». */
    titulo: string
    /** Filtros aplicados, ya redactados («Ciclo: VI»). */
    filtros: string[]
    conPago: boolean
    /** Todos los estudiantes del alcance elegido (resumen y hojas «Pagaron» / «No pagaron»). */
    alcance: FilaSeguimiento[]
    /** El listado: el alcance más la situación y la búsqueda. */
    filas: FilaSeguimiento[]
    resumen: ResumenSeguimiento
    /** Incluye la tabla «Por asesor» (un reporte de un solo asesor no la necesita). */
    conTablaDeAsesores: boolean
    /**
     * Reporte de un enlace público. `DOCENTE` (spec 026): sin DNI, correo ni nombres de otros asesores.
     * `CICLO` (spec 027): sin DNI, correo ni celular, pero con el asesor de cada sección.
     */
    publico?: 'DOCENTE' | 'CICLO'
}

/** Columnas de alumnos que un reporte público no incluye: lo que no hace falta para el seguimiento. */
export function columnasOcultas(publico: DatosReporte['publico']): string[] {
    if (publico === 'DOCENTE') return ['DNI', 'Correo', 'Asesores']
    if (publico === 'CICLO') return ['DNI', 'Correo', 'Celular']
    return []
}

/** Las demás secciones del alumno dentro del alcance del reporte («II-A, IV-B»), además de la que muestran Ciclo y Sección (spec 033). */
export function otrasSeccionesDe(fila: FilaSeguimiento): string {
    return fila.secciones.slice(1).map((s) => etiquetaSeccion(s.ciclo, s.seccion)).join(', ')
}

export function marcaDeTiempo(fecha: Date): string {
    return `${fechaLima(fecha)} ${horaLima(fecha)}`
}

export function textoAvance(avance: number): string {
    return `${Math.round(avance * 1000) / 10}%`
}

/** Columnas de contadores que repiten todas las tablas del resumen. */
export function columnasDeContadores(conPago: boolean): Array<{ titulo: string, valor: (c: Contadores) => string | number, ancho: number }> {
    return [
        { titulo: 'Alumnos', valor: (c) => c.alumnos, ancho: 10 },
        { titulo: 'Pagaron', valor: (c) => c.pagaron, ancho: 10 },
        { titulo: 'En revisión', valor: (c) => c.enRevision, ancho: 12 },
        { titulo: 'Rechazados', valor: (c) => c.rechazados, ancho: 12 },
        { titulo: 'Sin inscripción', valor: (c) => c.sinInscripcion, ancho: 15 },
        { titulo: 'No pagaron', valor: (c) => c.noPagaron, ancho: 12 },
        { titulo: 'Avance', valor: (c) => textoAvance(c.avance), ancho: 10 },
        ...(conPago ? [{ titulo: 'Recaudado (S/)', valor: (c: Contadores) => c.recaudado ?? 0, ancho: 15 }] : []),
    ]
}

export function etiquetaDeSituacion(situacion: Situacion): string {
    return ETIQUETA_SITUACION[situacion]
}

/** Nombres de los asesores de una fila, separados por «; ». */
export function asesoresDe(fila: Pick<FilaSeguimiento, 'asesores'>): string {
    return fila.asesores.map((asesor) => asesor.nombre).join('; ')
}

/** Nombre de archivo seguro: sin rutas ni caracteres reservados de Windows. */
export function nombreDeArchivo(base: string, extension: string): string {
    const limpio = Array.from(base, (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c)).join('').replace(/\s+/g, ' ').trim().slice(0, 120)
    return `${limpio || 'reporte'}.${extension}`
}

/** `Content-Disposition` con el nombre en ASCII de respaldo y el real en UTF-8 (RFC 5987). */
export function contentDisposition(nombre: string): string {
    const ascii = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    const utf8 = encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

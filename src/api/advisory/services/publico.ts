import { cargarSeguimiento } from './consulta'
import { asesorDelDocumento, asesorDelEnlace, type AsesorDelEnlace } from './enlaces'
import { cicloDelEnlace } from './enlaces-ciclo'
import {
    etiquetaSeccion,
    filtrarAlcance,
    resumir,
    type Contadores,
    type FilaSeguimiento,
    type Situacion,
} from './seguimiento'
import type { DatosReporte } from '../exports/reporte'

/**
 * Vista pública del docente (spec 026): lo que ve con su enlace. Es la **mínima necesaria** para dar
 * seguimiento: sin DNI, sin correo, sin montos ni fechas de pago, sin número de operación y sin datos de otros
 * asesores. Solo sus estudiantes (de todas sus secciones) y la situación de cada uno.
 */

export interface ContadoresPublicos {
    alumnos: number
    pagaron: number
    enRevision: number
    rechazados: number
    sinInscripcion: number
    noPagaron: number
    avance: number
}

export interface AlumnoPublico {
    nombre: string
    codigo: string
    ciclo: string
    seccion: string
    turno: string | null
    /** Etiquetas («VI-A1») de **todas** sus secciones dentro del alcance del docente; nunca las de otro docente (spec 033). */
    secciones: string[]
    celular: string | null
    situacion: Situacion
}

export interface VistaPublica {
    asesor: { nombre: string }
    evento: { nombre: string, nombreCorto: string }
    semestre: string | null
    generadoEn: string
    totales: ContadoresPublicos
    secciones: Array<ContadoresPublicos & { ciclo: string, seccion: string, turnos: string[] }>
    alumnos: AlumnoPublico[]
}

/** Solo los conteos: el dinero (`recaudado`) nunca sale en la vista pública. */
function contadoresPublicos(c: Contadores): ContadoresPublicos {
    return {
        alumnos: c.alumnos,
        pagaron: c.pagaron,
        enRevision: c.enRevision,
        rechazados: c.rechazados,
        sinInscripcion: c.sinInscripcion,
        noPagaron: c.noPagaron,
        avance: c.avance,
    }
}

const aAlumnoPublico = (f: FilaSeguimiento): AlumnoPublico => ({
    nombre: f.nombre,
    codigo: f.codigo,
    ciclo: f.ciclo,
    seccion: f.seccion,
    turno: f.turno,
    secciones: f.secciones.map((s) => etiquetaSeccion(s.ciclo, s.seccion)),
    celular: f.celular,
    situacion: f.situacion,
})

export interface SeguimientoDelEnlace {
    vista: VistaPublica
    /** Mismos datos armados para el Excel y el PDF (sin DNI, correo ni montos). */
    reporte: DatosReporte
}

/** Lee el estado actual (cruce en vivo) de los estudiantes del docente dueño del token. */
export async function seguimientoDelEnlace(token: string): Promise<SeguimientoDelEnlace> {
    return seguimientoDelAsesor(await asesorDelEnlace(token))
}

/** Lo mismo para el docente con ese DNI (página común de consulta, spec 028): misma vista, otro modo de entrar. */
export async function seguimientoDelDocumento(documento: unknown): Promise<SeguimientoDelEnlace> {
    return seguimientoDelAsesor(await asesorDelDocumento(documento))
}

async function seguimientoDelAsesor(asesor: AsesorDelEnlace): Promise<SeguimientoDelEnlace> {
    const seguimiento = await cargarSeguimiento(asesor.evento.id, false)
    const alcance = filtrarAlcance(seguimiento.filas, { asesorId: asesor.id })
    const generadoEn = new Date()
    const resumen = resumir(alcance, [], false)
    return {
        vista: {
            asesor: { nombre: asesor.nombre },
            evento: { nombre: asesor.evento.nombre, nombreCorto: asesor.evento.nombreCorto },
            semestre: seguimiento.semestre,
            generadoEn: generadoEn.toISOString(),
            totales: contadoresPublicos(resumen.totales),
            secciones: resumen.porSeccion.map((s) => ({ ciclo: s.ciclo, seccion: s.seccion, turnos: s.turnos, ...contadoresPublicos(s) })),
            alumnos: alcance.map(aAlumnoPublico),
        },
        reporte: {
            evento: { nombre: asesor.evento.nombre, codigo: String(asesor.evento.id) },
            semestre: seguimiento.semestre,
            generadoEn,
            titulo: asesor.nombre,
            filtros: [],
            conPago: false,
            alcance,
            filas: alcance,
            resumen,
            conTablaDeAsesores: false,
            publico: 'DOCENTE',
        },
    }
}

// ─── Vista pública del ciclo (spec 027) ─────────────────────────────────────

/** Un estudiante en la vista de un ciclo: lo mismo que en la del docente, **sin celular** (la ve más gente). */
export interface AlumnoPublicoCiclo {
    nombre: string
    codigo: string
    ciclo: string
    seccion: string
    turno: string | null
    /** Etiquetas de sus secciones **dentro de ese ciclo** (spec 033). */
    secciones: string[]
    situacion: Situacion
}

export interface VistaPublicaCiclo {
    ciclo: string
    evento: { nombre: string, nombreCorto: string }
    semestre: string | null
    generadoEn: string
    totales: ContadoresPublicos
    /** Cada sección con el nombre de su(s) asesor(es): es dato institucional, no de los estudiantes. */
    secciones: Array<ContadoresPublicos & { ciclo: string, seccion: string, turnos: string[], asesores: string[] }>
    alumnos: AlumnoPublicoCiclo[]
}

const aAlumnoPublicoCiclo = (f: FilaSeguimiento): AlumnoPublicoCiclo => ({
    nombre: f.nombre,
    codigo: f.codigo,
    ciclo: f.ciclo,
    seccion: f.seccion,
    turno: f.turno,
    secciones: f.secciones.map((s) => etiquetaSeccion(s.ciclo, s.seccion)),
    situacion: f.situacion,
})

export interface SeguimientoDelCiclo {
    vista: VistaPublicaCiclo
    /** Mismos datos armados para el Excel y el PDF (sin DNI, correo, celular ni montos). */
    reporte: DatosReporte
}

/**
 * Lee el estado actual (cruce en vivo) de todos los estudiantes del ciclo dueño del token. Muestra lo mínimo
 * para el seguimiento, como el del docente, y además el asesor de cada sección; el celular no sale porque
 * quien recibe el enlace de un ciclo no es el asesor de todos sus estudiantes.
 */
export async function seguimientoDelCiclo(token: string): Promise<SeguimientoDelCiclo> {
    const { ciclo, evento } = await cicloDelEnlace(token)
    const seguimiento = await cargarSeguimiento(evento.id, false)
    const alcance = filtrarAlcance(seguimiento.filas, { ciclo })
    const generadoEn = new Date()
    const resumen = resumir(alcance, [], false)
    return {
        vista: {
            ciclo,
            evento: { nombre: evento.nombre, nombreCorto: evento.nombreCorto },
            semestre: seguimiento.semestre,
            generadoEn: generadoEn.toISOString(),
            totales: contadoresPublicos(resumen.totales),
            secciones: resumen.porSeccion.map((s) => ({
                ciclo: s.ciclo,
                seccion: s.seccion,
                turnos: s.turnos,
                asesores: s.asesores.map((a) => a.nombre),
                ...contadoresPublicos(s),
            })),
            alumnos: alcance.map(aAlumnoPublicoCiclo),
        },
        reporte: {
            evento: { nombre: evento.nombre, codigo: String(evento.id) },
            semestre: seguimiento.semestre,
            generadoEn,
            titulo: `Seguimiento ciclo ${ciclo}`,
            filtros: [],
            conPago: false,
            alcance,
            filas: alcance,
            // La nota «alumnos sin asesor» es de gestión interna: no se muestra a quien recibe el enlace
            resumen: { ...resumen, alumnosSinAsesor: 0 },
            conTablaDeAsesores: false,
            publico: 'CICLO',
        },
    }
}

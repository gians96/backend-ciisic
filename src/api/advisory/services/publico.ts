import { cargarSeguimiento } from './consulta'
import { asesorDelEnlace } from './enlaces'
import {
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
    const asesor = await asesorDelEnlace(token)
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
            publico: true,
        },
    }
}

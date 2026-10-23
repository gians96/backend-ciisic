import type { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { unprocessable } from '../../../core/http-error'
import { leerLibroDePadron, type EstudianteLeido, type PadronLeido } from './lector-excel'
import { claveDeTexto, claveSeccion, etiquetaSeccion, type SeccionEstudiante } from './seguimiento'

/** Estudiante listo para guardar: sus datos y todas las secciones en que cursa (las columnas `ciclo`, `turno` y `seccion` son la principal). */
export interface EstudiantePadron extends EstudianteLeido {
    secciones: SeccionEstudiante[]
    /** `jpCargaId` de los cursos de SIVIRENO en que está matriculado (spec 034); ausente en el padrón del Excel. */
    matriculas?: number[]
}

/** Un curso de SIVIRENO listo para guardar (spec 034): su docente ya es un `Asesor` del evento. */
export interface CursoPadron {
    jpCargaId: number
    codigo: string
    nombre: string
    ciclo: string
    turno: string | null
    seccion: string
    asesorId: number | null
    docenteNombre: string | null
}

/** El Excel de la facultad trae una sola sección por alumno. */
const conSuSeccion = (e: EstudianteLeido): EstudiantePadron => ({ ...e, secciones: [{ ciclo: e.ciclo, seccion: e.seccion, turno: e.turno, cursos: 1 }] })

/**
 * Reemplaza el padrón del evento por `estudiantes`, sus secciones y, si vienen, los cursos de SIVIRENO con las matrículas de cada
 * uno (specs 033 y 034). Va dentro de la transacción de quien llama; las secciones y matrículas anteriores se borran en cascada
 * con los estudiantes y los cursos anteriores se borran siempre (el padrón del Excel no tiene cursos).
 */
export async function guardarPadron(
    tx: Prisma.TransactionClient,
    eventoId: number,
    semestre: string,
    estudiantes: readonly EstudiantePadron[],
    cursos: readonly CursoPadron[] = [],
): Promise<void> {
    await tx.padronEstudiante.deleteMany({ where: { eventoId } })
    await tx.padronCurso.deleteMany({ where: { eventoId } })
    await tx.padronEstudiante.createMany({
        data: estudiantes.map((e) => ({
            eventoId,
            semestre,
            documento: e.documento,
            codigo: e.codigo,
            correo: e.correo,
            nombre: e.nombre,
            celular: e.celular,
            carrera: e.carrera,
            ciclo: e.ciclo,
            turno: e.turno,
            seccion: e.seccion,
            distrito: e.distrito,
            provincia: e.provincia,
            departamento: e.departamento,
        })),
    })
    await tx.padronSeccion.createMany({
        data: estudiantes.flatMap((e) => e.secciones.map((s) => ({ eventoId, codigo: e.codigo, ciclo: s.ciclo, seccion: s.seccion, turno: s.turno, cursos: s.cursos }))),
    })
    if (!cursos.length) return

    await tx.padronCurso.createMany({ data: cursos.map((c) => ({ eventoId, ...c })) })
    const guardados = await tx.padronCurso.findMany({ where: { eventoId }, select: { id: true, jpCargaId: true } })
    const idDeCurso = new Map(guardados.map((c) => [c.jpCargaId, c.id]))
    await tx.padronMatricula.createMany({
        data: estudiantes.flatMap((e) => (e.matriculas ?? []).flatMap((jpCargaId) => {
            const cursoId = idDeCurso.get(jpCargaId)
            return cursoId === undefined ? [] : [{ eventoId, codigo: e.codigo, cursoId }]
        })),
    })
}

export interface ResultadoImportacion {
    semestre: string
    estudiantes: number
    /** Docentes que quedan tras la carga: los del Excel, o los que ya había si se conservan. */
    asesores: number
    /** Ciclo y sección distintos que tienen al menos un asesor. */
    secciones: number
    advertencias: string[]
    /** `false` en la simulación: se leyó y validó el archivo, pero no se guardó nada. */
    aplicado: boolean
    /** `true`: se conservaron los docentes, sus DNI y sus secciones (spec 028); del Excel solo se usan los estudiantes. */
    asesoresConservados: boolean
}

/** Qué hacer con los docentes al recargar el padrón: dejar los que ya hay (editados a mano) o reemplazarlos por los del Excel. */
export type ModoAsesores = 'conservar' | 'reemplazar'
export const MODOS_ASESORES: readonly ModoAsesores[] = ['conservar', 'reemplazar']

const SEMESTRE = /^\d{4}-[12]$/

/**
 * Lee el Excel y, si `aplicar`, **reemplaza** el padrón de estudiantes del evento por su contenido (los datos de
 * seguimiento viven solo en estas tablas: ninguna otra depende de ellas). Con `aplicar` en `false` solo valida y
 * cuenta, para mostrar la vista previa antes de confirmar.
 *
 * Los docentes (spec 028): si el evento ya tiene, **se conservan** con su DNI, sus secciones editadas y su enlace
 * (`asesores: 'conservar'`, lo habitual); con `'reemplazar'` se vuelven a leer del Excel, conservando su enlace y su
 * DNI por nombre. Sin docentes previos se cargan siempre los del Excel.
 */
export async function importarPadron(
    eventoId: number,
    contenido: Buffer,
    opciones: { aplicar: boolean, semestre?: string, asesores?: ModoAsesores },
): Promise<ResultadoImportacion> {
    const leido: PadronLeido = await leerLibroDePadron(contenido)
    const estudiantes = leido.estudiantes.map(conSuSeccion)
    const semestre = (opciones.semestre ?? leido.semestre).trim()
    if (!SEMESTRE.test(semestre)) {
        throw unprocessable('PADRON_SEMESTER_REQUIRED', 'Indica el semestre del padrón (por ejemplo 2026-2).', {
            semestre: leido.semestre ? 'Debe tener el formato AAAA-1 o AAAA-2' : 'No se pudo deducir del nombre de la hoja',
        })
    }

    const previos = await prisma.asesor.findMany({ where: { eventoId }, select: { nombre: true, secciones: { select: { ciclo: true, seccion: true } } } })
    const conservar = previos.length > 0 && (opciones.asesores ?? 'conservar') === 'conservar'

    const advertencias = [...leido.advertencias]
    let asesores = leido.asesores.length
    let secciones = new Set(leido.asesores.flatMap((asesor) => asesor.secciones.map((s) => claveSeccion(s.ciclo, s.seccion)))).size
    if (conservar) {
        asesores = previos.length
        secciones = new Set(previos.flatMap((asesor) => asesor.secciones.map((s) => claveSeccion(s.ciclo, s.seccion)))).size
        if (leido.asesores.length) advertencias.unshift('Se conservaron los docentes y sus secciones actuales: los de la hoja RESUMEN no se usaron.')
        // Un padrón nuevo puede no traer una sección que un docente conserva
        const delPadron = new Set(estudiantes.flatMap((e) => e.secciones.map((s) => claveSeccion(s.ciclo, s.seccion))))
        for (const asesor of previos) {
            for (const s of asesor.secciones) {
                if (!delPadron.has(claveSeccion(s.ciclo, s.seccion))) advertencias.push(`${asesor.nombre} tiene la sección ${etiquetaSeccion(s.ciclo, s.seccion)}, que no está en este padrón.`)
            }
        }
    }

    const resultado: ResultadoImportacion = { semestre, estudiantes: estudiantes.length, asesores, secciones, advertencias, aplicado: false, asesoresConservados: conservar }
    if (!opciones.aplicar) return resultado

    await prisma.$transaction(async (tx) => {
        if (!conservar) {
            // Los enlaces públicos (spec 026) y el DNI (spec 028) ya entregados a los docentes sobreviven: se reasignan al
            // asesor del mismo nombre (sin acentos ni mayúsculas); el resto empieza sin enlace ni DNI
            const conDatos = await tx.asesor.findMany({
                where: { eventoId, OR: [{ enlaceToken: { not: null } }, { documento: { not: null } }] },
                select: { nombre: true, documento: true, enlaceToken: true, enlaceCreadoEn: true, enlaceUltimoAcceso: true },
            })
            const guardados = new Map(conDatos.map((a) => [claveDeTexto(a.nombre), a]))

            // Las secciones de cada asesor se borran en cascada
            await tx.asesor.deleteMany({ where: { eventoId } })
            await guardarPadron(tx, eventoId, semestre, estudiantes)
            for (const asesor of leido.asesores) {
                const previo = guardados.get(claveDeTexto(asesor.nombre))
                await tx.asesor.create({
                    data: {
                        eventoId,
                        nombre: asesor.nombre,
                        ...(previo?.documento ? { documento: previo.documento } : {}),
                        ...(previo?.enlaceToken ? { enlaceToken: previo.enlaceToken, enlaceCreadoEn: previo.enlaceCreadoEn, enlaceUltimoAcceso: previo.enlaceUltimoAcceso } : {}),
                        secciones: { create: asesor.secciones.map(({ ciclo, seccion }) => ({ eventoId, ciclo, seccion })) },
                    },
                })
            }
            return
        }
        await guardarPadron(tx, eventoId, semestre, estudiantes)
    }, { maxWait: 10_000, timeout: 60_000 })

    return { ...resultado, aplicado: true }
}

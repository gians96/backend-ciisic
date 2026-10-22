import { prisma } from '../../../database/prisma'
import { unprocessable } from '../../../core/http-error'
import { leerLibroDePadron, type PadronLeido } from './lector-excel'
import { claveDeTexto } from './seguimiento'

export interface ResultadoImportacion {
    semestre: string
    estudiantes: number
    asesores: number
    /** Ciclo y sección distintos que tienen al menos un asesor. */
    secciones: number
    advertencias: string[]
    /** `false` en la simulación: se leyó y validó el archivo, pero no se guardó nada. */
    aplicado: boolean
}

const SEMESTRE = /^\d{4}-[12]$/

/**
 * Lee el Excel y, si `aplicar`, **reemplaza** el padrón y los asesores del evento por su contenido (los
 * datos de seguimiento viven solo en estas tablas: ninguna otra depende de ellas). Con `aplicar` en
 * `false` solo valida y cuenta, para mostrar la vista previa antes de confirmar.
 */
export async function importarPadron(eventoId: number, contenido: Buffer, opciones: { aplicar: boolean, semestre?: string }): Promise<ResultadoImportacion> {
    const leido: PadronLeido = await leerLibroDePadron(contenido)
    const semestre = (opciones.semestre ?? leido.semestre).trim()
    if (!SEMESTRE.test(semestre)) {
        throw unprocessable('PADRON_SEMESTER_REQUIRED', 'Indica el semestre del padrón (por ejemplo 2026-2).', {
            semestre: leido.semestre ? 'Debe tener el formato AAAA-1 o AAAA-2' : 'No se pudo deducir del nombre de la hoja',
        })
    }

    const resultado: ResultadoImportacion = {
        semestre,
        estudiantes: leido.estudiantes.length,
        asesores: leido.asesores.length,
        secciones: new Set(leido.asesores.flatMap((asesor) => asesor.secciones.map((s) => `${s.ciclo}|${s.seccion}`))).size,
        advertencias: leido.advertencias,
        aplicado: false,
    }
    if (!opciones.aplicar) return resultado

    await prisma.$transaction(async (tx) => {
        // Los enlaces públicos ya entregados a los docentes (spec 026) sobreviven a una nueva carga: se
        // reasignan al asesor del mismo nombre (sin acentos ni mayúsculas); el resto empieza sin enlace
        const conEnlace = await tx.asesor.findMany({
            where: { eventoId, enlaceToken: { not: null } },
            select: { nombre: true, enlaceToken: true, enlaceCreadoEn: true, enlaceUltimoAcceso: true },
        })
        const enlaces = new Map(conEnlace.map((a) => [claveDeTexto(a.nombre), a]))

        // Las secciones de cada asesor se borran en cascada
        await tx.asesor.deleteMany({ where: { eventoId } })
        await tx.padronEstudiante.deleteMany({ where: { eventoId } })
        await tx.padronEstudiante.createMany({ data: leido.estudiantes.map((e) => ({ ...e, eventoId, semestre })) })
        for (const asesor of leido.asesores) {
            const enlace = enlaces.get(claveDeTexto(asesor.nombre))
            await tx.asesor.create({
                data: {
                    eventoId,
                    nombre: asesor.nombre,
                    ...(enlace ? { enlaceToken: enlace.enlaceToken, enlaceCreadoEn: enlace.enlaceCreadoEn, enlaceUltimoAcceso: enlace.enlaceUltimoAcceso } : {}),
                    secciones: { create: asesor.secciones.map(({ ciclo, seccion }) => ({ eventoId, ciclo, seccion })) },
                },
            })
        }
    }, { maxWait: 10_000, timeout: 60_000 })

    return { ...resultado, aplicado: true }
}

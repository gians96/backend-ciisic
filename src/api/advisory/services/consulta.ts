import { prisma } from '../../../database/prisma'
import { aNumero } from '../../../core/catalogos'
import {
    asesoresPorSeccion,
    construirFilas,
    normalizarCodigo,
    normalizarCorreo,
    normalizarDocumento,
    type AsesorConSecciones,
    type FilaSeguimiento,
    type InscripcionBase,
} from './seguimiento'

/** Id del tipo de documento DNI: el padrón de la facultad solo trae DNI. */
const TIPO_DOCUMENTO_DNI = 'dni'

/** Estudiantes por consulta: mantiene las listas `IN` en un tamaño que MySQL resuelve sin esfuerzo. */
const LOTE = 500

export interface Seguimiento {
    /** Semestre del padrón cargado; `null` si aún no hay padrón. */
    semestre: string | null
    importadoEn: Date | null
    asesores: AsesorConSecciones[]
    /** Una fila por estudiante del padrón, sin filtrar. */
    filas: FilaSeguimiento[]
}

function lotes<T>(lista: readonly T[], tamano: number): T[][] {
    const resultado: T[][] = []
    for (let i = 0; i < lista.length; i += tamano) resultado.push(lista.slice(i, i + tamano))
    return resultado
}

/** El DNI como lo escribe la BD (con ceros) y como lo pierde Excel (sin ellos). */
function variantesDeDocumento(documento: string): string[] {
    const normalizado = normalizarDocumento(documento)
    return /^\d+$/.test(normalizado) ? [normalizado, normalizado.replace(/^0+/, '') || '0'] : [normalizado]
}

const unicos = (valores: readonly string[]) => [...new Set(valores.filter(Boolean))]

/**
 * Cruce en vivo del padrón con las inscripciones del evento: cada llamada lee el estado actual, así
 * que un voucher aprobado hace un momento ya cuenta. Solo se leen las inscripciones que coinciden por
 * documento, código de estudiante o correo con alguien del padrón.
 */
export async function cargarSeguimiento(eventoId: number, conPago: boolean): Promise<Seguimiento> {
    const [padron, asesores] = await Promise.all([
        prisma.padronEstudiante.findMany({ where: { eventoId }, orderBy: [{ ciclo: 'asc' }, { seccion: 'asc' }, { nombre: 'asc' }] }),
        prisma.asesor.findMany({ where: { eventoId }, include: { secciones: true }, orderBy: { nombre: 'asc' } }),
    ])

    const inscripciones = new Map<number, InscripcionBase>()
    for (const lote of lotes(padron, LOTE)) {
        const encontradas = await prisma.inscripcion.findMany({
            where: {
                eventoId,
                OR: [
                    { participante: { tipoDocumentoId: TIPO_DOCUMENTO_DNI, numeroDocumento: { in: unicos(lote.flatMap((e) => variantesDeDocumento(e.documento))) } } },
                    { codigoEstudiante: { in: unicos(lote.map((e) => normalizarCodigo(e.codigo))) } },
                    { participante: { correo: { in: unicos(lote.map((e) => normalizarCorreo(e.correo))) } } },
                ],
            },
            select: {
                id: true,
                monto: true,
                fechaPago: true,
                codigoEstudiante: true,
                estado: { select: { codigo: true } },
                participante: { select: { tipoDocumentoId: true, numeroDocumento: true, correo: true } },
            },
        })
        for (const inscripcion of encontradas) {
            inscripciones.set(inscripcion.id, {
                id: inscripcion.id,
                estado: inscripcion.estado.codigo,
                monto: aNumero(inscripcion.monto),
                fechaPago: inscripcion.fechaPago,
                documento: inscripcion.participante.tipoDocumentoId === TIPO_DOCUMENTO_DNI ? inscripcion.participante.numeroDocumento : null,
                correo: inscripcion.participante.correo,
                codigoEstudiante: inscripcion.codigoEstudiante,
            })
        }
    }

    const asesoresConSecciones: AsesorConSecciones[] = asesores.map((asesor) => ({
        id: asesor.id,
        nombre: asesor.nombre,
        secciones: asesor.secciones.map(({ ciclo, seccion }) => ({ ciclo, seccion })),
    }))

    return {
        semestre: padron[0]?.semestre ?? null,
        importadoEn: padron.reduce<Date | null>((ultimo, e) => (ultimo === null || e.creadoEn > ultimo ? e.creadoEn : ultimo), null),
        asesores: asesoresConSecciones,
        filas: construirFilas(padron, asesoresPorSeccion(asesoresConSecciones), [...inscripciones.values()], conPago),
    }
}

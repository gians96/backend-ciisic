import type { AsistentePonencia, ModalidadAsistencia } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { modalidadDe } from '../../../core/catalogos'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { SITUACIONES_CONGRESO, resolverElegibilidad, situacionDe, variantesDocumento, type SituacionCongreso } from '../../../core/ponencias-especializadas'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { aAsistente } from './asistentes'
import { esAccesoLibre } from './congresista'

/**
 * Resumen por persona de quienes están inscritos a ponencias especializadas (spec 031): una fila por persona (no por
 * ponencia) con su situación **actual** frente al congreso, calculada en cada consulta con el documento. Sirve para ver
 * quién puede estar inscrito (congresista con el pago aprobado) y quién no, y para cancelar y avisar.
 */
export interface PersonaResumen {
    asistente: AsistentePonencia
    /** Inscripciones vigentes a ponencias. */
    ponencias: number
    /** De ellas, a cuántas ya asistió. */
    asistencias: number
    /** Todas sus inscripciones vigentes se validaron al registrarse (con el acceso libre apagado). */
    validada: boolean
    avisadoEn: Date | null
    situacion: SituacionCongreso
    congreso: { estado: string, tipo: string | null, categoria: string | null, modo: ModalidadAsistencia } | null
    /** Con el acceso libre todos pueden; si no, solo el congresista con el pago aprobado. */
    puede: boolean
}

export interface FiltrosResumen {
    situacion?: SituacionCongreso
    puede?: 'si' | 'no'
    /** `si`: todas sus inscripciones vigentes están validadas; `no`: alguna no lo está. */
    validacion?: 'si' | 'no'
    /** Modo con el que asiste al congreso (no es la modalidad de la ponencia). */
    modo?: ModalidadAsistencia
    /** `si`: ya se le envió el comunicado. */
    aviso?: 'si' | 'no'
    q?: string
}

export interface TotalesResumen {
    personas: number
    inscripciones: number
    pueden: number
    noPueden: number
    porSituacion: Record<SituacionCongreso, number>
    sinValidar: number
    avisadas: number
}

/** Quien tiene problemas va primero: es lo que el staff necesita revisar. */
const ORDEN_SITUACION: Record<SituacionCongreso, number> = { NO_INSCRITO: 0, RECHAZADO: 1, PAGO_PENDIENTE: 2, APROBADO: 3 }

/** Las personas con inscripciones vigentes del evento y su situación actual en el congreso. */
export async function cargarPersonas(eventoId: number): Promise<{ personas: PersonaResumen[], accesoLibre: boolean }> {
    const [accesoLibre, filas] = await Promise.all([
        esAccesoLibre(eventoId),
        prisma.inscripcionPonencia.findMany({
            where: { estado: 'INSCRITO', ponencia: { eventoId } },
            select: { asistenteId: true, asistioEn: true, inscripcionCongresoId: true, avisoEnviadoEn: true, asistente: true },
        }),
    ])

    const porAsistente = new Map<number, { asistente: AsistentePonencia, ponencias: number, asistencias: number, validadas: number, avisadoEn: Date | null }>()
    for (const fila of filas) {
        const actual = porAsistente.get(fila.asistenteId) ?? { asistente: fila.asistente, ponencias: 0, asistencias: 0, validadas: 0, avisadoEn: null }
        actual.ponencias += 1
        if (fila.asistioEn) actual.asistencias += 1
        if (fila.inscripcionCongresoId !== null) actual.validadas += 1
        if (fila.avisoEnviadoEn && (!actual.avisadoEn || fila.avisoEnviadoEn > actual.avisadoEn)) actual.avisadoEn = fila.avisoEnviadoEn
        porAsistente.set(fila.asistenteId, actual)
    }

    // Una sola consulta por todos los documentos (y su variante sin ceros a la izquierda)
    const documentos = new Set<string>()
    for (const { asistente } of porAsistente.values()) variantesDocumento(asistente.tipoDocumentoId, asistente.numeroDocumento).forEach((d) => documentos.add(d))
    const participantes = documentos.size
        ? await prisma.participante.findMany({
            where: { numeroDocumento: { in: [...documentos] } },
            select: {
                tipoDocumentoId: true,
                numeroDocumento: true,
                inscripciones: {
                    where: { eventoId },
                    take: 1,
                    select: { estado: { select: { codigo: true } }, tipoInscripcion: { select: { nombre: true, modalidad: true, categoria: { select: { nombre: true } } } } },
                },
            },
        })
        : []

    const personas = [...porAsistente.values()].map(({ asistente, ponencias, asistencias, validadas, avisadoEn }): PersonaResumen => {
        const variantes = variantesDocumento(asistente.tipoDocumentoId, asistente.numeroDocumento)
        const candidatas = participantes
            .filter((p) => p.tipoDocumentoId === asistente.tipoDocumentoId && variantes.includes(p.numeroDocumento))
            .flatMap((p) => p.inscripciones)
        // Si el documento estuviera dos veces (con y sin ceros), la aprobada gana
        const inscripcion = candidatas.find((i) => i.estado.codigo === 'APROBADO') ?? candidatas[0] ?? null
        const veredicto = resolverElegibilidad(inscripcion ? { estado: inscripcion.estado.codigo, modalidadTipo: inscripcion.tipoInscripcion?.modalidad } : null)
        const situacion = situacionDe(veredicto)
        return {
            asistente,
            ponencias,
            asistencias,
            validada: validadas === ponencias,
            avisadoEn,
            situacion,
            congreso: inscripcion
                ? {
                    estado: inscripcion.estado.codigo,
                    tipo: inscripcion.tipoInscripcion?.nombre ?? null,
                    categoria: inscripcion.tipoInscripcion?.categoria.nombre ?? null,
                    modo: modalidadDe(inscripcion.tipoInscripcion?.modalidad),
                }
                : null,
            puede: accesoLibre || situacion === 'APROBADO',
        }
    })
    personas.sort((a, b) =>
        ORDEN_SITUACION[a.situacion] - ORDEN_SITUACION[b.situacion]
        || a.asistente.apellidos.localeCompare(b.asistente.apellidos, 'es')
        || a.asistente.nombres.localeCompare(b.asistente.nombres, 'es'),
    )
    return { personas, accesoLibre }
}

export function filtrar(personas: readonly PersonaResumen[], filtros: FiltrosResumen): PersonaResumen[] {
    // Cada palabra de la búsqueda debe aparecer en alguno de los datos de la persona
    const palabras = (filtros.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)
    return personas.filter((p) => {
        if (filtros.situacion && p.situacion !== filtros.situacion) return false
        if (filtros.puede && p.puede !== (filtros.puede === 'si')) return false
        if (filtros.validacion && p.validada !== (filtros.validacion === 'si')) return false
        if (filtros.modo && p.congreso?.modo !== filtros.modo) return false
        if (filtros.aviso && (p.avisadoEn !== null) !== (filtros.aviso === 'si')) return false
        if (!palabras.length) return true
        const a = p.asistente
        const texto = [a.numeroDocumento, a.nombres, a.apellidos, a.correo, a.celular].filter(Boolean).join(' ').toLowerCase()
        return palabras.every((palabra) => texto.includes(palabra))
    })
}

export function resumir(personas: readonly PersonaResumen[]): TotalesResumen {
    const porSituacion = Object.fromEntries(SITUACIONES_CONGRESO.map((s) => [s, 0])) as Record<SituacionCongreso, number>
    for (const p of personas) porSituacion[p.situacion] += 1
    return {
        personas: personas.length,
        inscripciones: personas.reduce((suma, p) => suma + p.ponencias, 0),
        pueden: personas.filter((p) => p.puede).length,
        noPueden: personas.filter((p) => !p.puede).length,
        porSituacion,
        sinValidar: personas.filter((p) => !p.validada).length,
        avisadas: personas.filter((p) => p.avisadoEn !== null).length,
    }
}

export function aPersona(p: PersonaResumen) {
    return {
        asistenteId: p.asistente.id,
        asistente: aAsistente(p.asistente),
        ponencias: p.ponencias,
        asistencias: p.asistencias,
        validada: p.validada,
        avisadoEn: p.avisadoEn,
        situacion: p.situacion,
        congreso: p.congreso,
        puede: p.puede,
    }
}

/** `GET …/specialized-talk-attendees`: una página de personas y, en `meta.resumen`, los totales de todo el evento. */
export async function listarResumen(eventoId: number, filtros: FiltrosResumen, paginacion: Pagination) {
    await obtenerEventoPorId(eventoId)
    const { personas, accesoLibre } = await cargarPersonas(eventoId)
    const filtradas = filtrar(personas, filtros)
    const pagina = filtradas.slice(paginacion.skip, paginacion.skip + paginacion.take)
    return { data: pagina.map(aPersona), meta: { ...pageMeta(paginacion, filtradas.length), resumen: resumir(personas), accesoLibre } }
}

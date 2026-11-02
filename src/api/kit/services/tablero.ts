import { prisma } from '../../../database/prisma'
import { fechaLima, horaLima } from '../../../core/fechas'
import { KIT_SELECT, TIPO_CON_KIT, tipoIncluyeKit } from '../../../core/kit'
import { obtenerEventoPorId } from '../../event/services/public-event'

/**
 * Tablero de kits (spec 045): cómo va la entrega, en una sola consulta del panel. Usa las mismas reglas que el resumen de la puerta
 * (`resumenKits`, spec 037), así que `conKit`, `entregados` y `pendientes` coinciden con él: le corresponde un kit a una inscripción
 * `APROBADO` con un tipo que lo entrega (presencial con `incluye_kit`).
 * - `porAprobar`: con kit, sin entregar y con el pago aún sin aprobar (lo que viene).
 * - `aRevisar`: kits ya entregados que hoy no corresponden (la inscripción se canceló o rechazó, o su tipo ya no entrega kit).
 * Solo lleva cifras y los nombres de quienes entregan: las personas se ven en el listado de inscripciones (`?kit=`, `inscripciones.ver`).
 */

interface Cifras {
    conKit: number
    entregados: number
    porAprobar: number
    aRevisar: number
}

const SIN_CIFRAS = (): Cifras => ({ conKit: 0, entregados: 0, porAprobar: 0, aRevisar: 0 })

interface Entregador {
    persona: { id: number, nombres: string, apellidos: string } | null
    total: number
    ultimaEn: Date
}

export async function tableroKits(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const [grupos, tipos, estados, entregas] = await Promise.all([
        // Por tipo y estado: cuántas inscripciones hay y a cuántas ya se les entregó (solo tipos con kit o con alguna entrega)
        prisma.inscripcion.groupBy({
            by: ['tipoInscripcionId', 'estadoId'],
            where: { eventoId, OR: [{ tipoInscripcion: TIPO_CON_KIT }, { kitEntregadoEn: { not: null } }] },
            _count: { _all: true, kitEntregadoEn: true },
        }),
        prisma.tipoInscripcion.findMany({
            where: { categoria: { eventoId } },
            select: {
                id: true, nombre: true, etiqueta: true, modalidad: true, incluyeKit: true, orden: true,
                categoria: { select: { codigo: true, nombre: true, orden: true, delegacionId: true } },
            },
        }),
        prisma.estadoInscripcion.findMany({ select: { id: true, codigo: true } }),
        prisma.inscripcion.findMany({ where: { eventoId, kitEntregadoEn: { not: null } }, select: KIT_SELECT }),
    ])

    const codigoDeEstado = new Map(estados.map((estado) => [estado.id, estado.codigo]))
    const tipoPorId = new Map(tipos.map((tipo) => [tipo.id, tipo]))
    const cifrasPorTipo = new Map<number | null, Cifras>()
    for (const grupo of grupos) {
        const tipo = grupo.tipoInscripcionId === null ? null : tipoPorId.get(grupo.tipoInscripcionId) ?? null
        const estado = codigoDeEstado.get(grupo.estadoId)
        const total = grupo._count._all
        const entregados = grupo._count.kitEntregadoEn
        const entregaKit = tipoIncluyeKit(tipo)
        const cifras = cifrasPorTipo.get(grupo.tipoInscripcionId) ?? SIN_CIFRAS()
        if (entregaKit && estado === 'APROBADO') {
            cifras.conKit += total
            cifras.entregados += entregados
        } else {
            // Se entregó pero hoy no le corresponde (una cortesía sin tipo cae aquí)
            cifras.aRevisar += entregados
        }
        if (entregaKit && (estado === 'PENDIENTE' || estado === 'EN_REVISION')) cifras.porAprobar += total - entregados
        cifrasPorTipo.set(grupo.tipoInscripcionId, cifras)
    }

    const suma = SIN_CIFRAS()
    for (const cifras of cifrasPorTipo.values()) {
        suma.conKit += cifras.conKit
        suma.entregados += cifras.entregados
        suma.porAprobar += cifras.porAprobar
        suma.aRevisar += cifras.aRevisar
    }

    // Solo los tipos con alguna cifra (los planes de las delegaciones son muchos y casi todos están vacíos). Siguen el orden de la
    // categoría y del tipo; la cortesía sin tipo va al final.
    const filas = [...cifrasPorTipo.entries()]
        .map(([tipoId, cifras]) => ({ tipo: tipoId === null ? null : tipoPorId.get(tipoId) ?? null, cifras }))
        .filter(({ cifras }) => cifras.conKit > 0 || cifras.porAprobar > 0 || cifras.aRevisar > 0)
        .sort((a, b) => {
            if (!a.tipo || !b.tipo) return Number(!a.tipo) - Number(!b.tipo)
            return a.tipo.categoria.orden - b.tipo.categoria.orden || a.tipo.orden - b.tipo.orden || a.tipo.id - b.tipo.id
        })

    // Ritmo (por día y hora de Lima) y quién entrega
    const porHora = new Map<string, number>()
    const entregadores = new Map<number | null, Entregador>()
    for (const { kitEntregadoEn, kitEntregadoPor } of entregas) {
        if (!kitEntregadoEn) continue
        const hora = `${fechaLima(kitEntregadoEn)} ${horaLima(kitEntregadoEn).slice(0, 2)}`
        porHora.set(hora, (porHora.get(hora) ?? 0) + 1)
        const id = kitEntregadoPor?.id ?? null
        const actual = entregadores.get(id)
        if (!actual) {
            entregadores.set(id, { persona: kitEntregadoPor ?? null, total: 1, ultimaEn: kitEntregadoEn })
        } else {
            actual.total += 1
            if (kitEntregadoEn > actual.ultimaEn) actual.ultimaEn = kitEntregadoEn
        }
    }

    return {
        totales: { conKit: suma.conKit, entregados: suma.entregados, pendientes: Math.max(0, suma.conKit - suma.entregados), porAprobar: suma.porAprobar, aRevisar: suma.aRevisar },
        porTipo: filas.map(({ tipo, cifras }) => ({
            tipoInscripcionId: tipo?.id ?? null,
            nombre: tipo?.nombre ?? 'Sin tipo (cortesía)',
            etiqueta: tipo?.etiqueta ?? null,
            categoria: tipo ? { codigo: tipo.categoria.codigo, nombre: tipo.categoria.nombre } : null,
            // Los planes de una delegación viven en una categoría oculta: con esto el panel los agrupa como delegaciones
            delegacionId: tipo?.categoria.delegacionId ?? null,
            conKit: cifras.conKit,
            entregados: cifras.entregados,
            pendientes: Math.max(0, cifras.conKit - cifras.entregados),
            porAprobar: cifras.porAprobar,
            aRevisar: cifras.aRevisar,
        })),
        entregas: [...porHora.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([clave, total]) => ({ fecha: clave.slice(0, 10), hora: Number(clave.slice(11)), total })),
        porPersona: [...entregadores.values()]
            .sort((a, b) => b.total - a.total || b.ultimaEn.getTime() - a.ultimaEn.getTime())
            .map(({ persona, total, ultimaEn }) => ({ id: persona?.id ?? null, nombres: persona?.nombres ?? null, apellidos: persona?.apellidos ?? null, total, ultimaEn })),
    }
}

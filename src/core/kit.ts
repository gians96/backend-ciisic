import type { Prisma } from '@prisma/client'
import { modalidadDe } from './catalogos'

/**
 * Entrega del kit en la puerta (spec 037). El kit es de la **inscripción** (una persona recibe uno en todo el
 * congreso, no uno por actividad): `inscripciones.kit_entregado_en` y `kit_entregado_por_id`; `NULL` = aún no se
 * entrega y deshacer la entrega las deja en `NULL`. Qué tipos lo incluyen lo dice `tipos_inscripcion.incluye_kit`.
 */

/** Lo que el servidor lee de una inscripción para saber su kit (se une al `select` de cada consulta). */
export const KIT_SELECT = {
    kitEntregadoEn: true,
    kitEntregadoPor: { select: { id: true, nombres: true, apellidos: true } },
} as const

export interface KitEstado {
    /** El tipo de la inscripción incluye kit y es presencial (un tipo virtual nunca lo incluye). */
    incluye: boolean
    entregado: boolean
    entregadoEn: Date | null
    entregadoPor: { id: number, nombres: string, apellidos: string } | null
}

interface DatosKit {
    kitEntregadoEn?: Date | null
    kitEntregadoPor?: { id: number, nombres: string, apellidos: string } | null
    tipoInscripcion?: { modalidad?: unknown, incluyeKit?: boolean | null } | null
}

/** El tipo incluye kit y se asiste en persona; una cortesía sin tipo no tiene kit. */
export function tipoIncluyeKit(tipo: { modalidad?: unknown, incluyeKit?: boolean | null } | null | undefined): boolean {
    return tipo?.incluyeKit === true && modalidadDe(tipo.modalidad) === 'PRESENCIAL'
}

/** Estado del kit de una inscripción; tolera filas sin las columnas (consultas que no las traen). */
export function aKit(inscripcion: DatosKit): KitEstado {
    const entregadoEn = inscripcion.kitEntregadoEn ?? null
    return {
        incluye: tipoIncluyeKit(inscripcion.tipoInscripcion),
        entregado: entregadoEn !== null,
        entregadoEn,
        entregadoPor: inscripcion.kitEntregadoPor ?? null,
    }
}

// ─── Qué inscripciones corresponden al kit (spec 037 y 045) ─────────────────

/** Los tipos que entregan kit en la puerta: lo incluyen y se asiste en persona (la regla de `tipoIncluyeKit`, para consultas). */
export const TIPO_CON_KIT = { incluyeKit: true, modalidad: 'PRESENCIAL' } as const

/**
 * Inscripciones a las que les corresponde un kit en un evento: aprobadas, con un tipo que lo entrega. Es la base del resumen de la
 * puerta y del tablero, así que los dos dan siempre los mismos números.
 */
export const aEntregar = (eventoId: number) => ({ eventoId, estado: { codigo: 'APROBADO' }, tipoInscripcion: TIPO_CON_KIT }) satisfies Prisma.InscripcionWhereInput

/**
 * `?kit=` del listado y del CSV de inscripciones (spec 045):
 * - `CON_KIT`: el tipo entrega kit (cualquier estado); `SIN_KIT`: no lo entrega (tipo sin kit, virtual o cortesía sin tipo).
 * - `PENDIENTE`: le corresponde y aún no se le entregó; `ENTREGADO`: ya se le entregó; `POR_APROBAR`: con kit, sin entregar y con el
 *   pago aún sin aprobar.
 * - `REVISAR`: ya se le entregó pero hoy no le corresponde (su inscripción dejó de estar aprobada o su tipo ya no entrega kit).
 */
export const FILTROS_KIT = ['CON_KIT', 'SIN_KIT', 'PENDIENTE', 'ENTREGADO', 'POR_APROBAR', 'REVISAR'] as const
export type FiltroKit = typeof FILTROS_KIT[number]

export function esFiltroKit(valor: unknown): valor is FiltroKit {
    return typeof valor === 'string' && (FILTROS_KIT as readonly string[]).includes(valor)
}

/** Tipo que no entrega kit: sin kit o virtual. */
const TIPO_SIN_KIT: Prisma.TipoInscripcionWhereInput = { OR: [{ incluyeKit: false }, { modalidad: 'VIRTUAL' }] }

/**
 * Condición de cada filtro sobre la inscripción. Siempre en positivo y sin `NOT`: una cortesía sin tipo tiene el `tipoInscripcionId`
 * nulo y la negación de una relación la dejaría fuera. Quien la usa la une con `AND` para que no pise las claves de los demás filtros.
 */
export function condicionKit(filtro: FiltroKit): Prisma.InscripcionWhereInput {
    switch (filtro) {
        case 'CON_KIT':
            return { tipoInscripcion: TIPO_CON_KIT }
        case 'SIN_KIT':
            return { OR: [{ tipoInscripcionId: null }, { tipoInscripcion: TIPO_SIN_KIT }] }
        case 'PENDIENTE':
            return { estado: { codigo: 'APROBADO' }, tipoInscripcion: TIPO_CON_KIT, kitEntregadoEn: null }
        case 'ENTREGADO':
            return { kitEntregadoEn: { not: null } }
        case 'POR_APROBAR':
            return { estado: { codigo: { in: ['PENDIENTE', 'EN_REVISION'] } }, tipoInscripcion: TIPO_CON_KIT, kitEntregadoEn: null }
        case 'REVISAR':
            return { kitEntregadoEn: { not: null }, OR: [{ estado: { codigo: { not: 'APROBADO' } } }, { tipoInscripcionId: null }, { tipoInscripcion: TIPO_SIN_KIT }] }
    }
}

/** Dónde está el kit de una persona (columna «Kit» del CSV). */
export type SituacionKit = 'ENTREGADO' | 'PENDIENTE' | 'POR_APROBAR' | 'NO_INCLUYE' | 'NO_CORRESPONDE'

/**
 * Entregado; pendiente de entrega (aprobada y con kit); con el pago aún por aprobar; sin kit en su tipo; o con kit pero con la
 * inscripción ya no vigente (rechazada o cancelada).
 */
export function situacionKit(kit: Pick<KitEstado, 'incluye' | 'entregado'>, codigoEstado: string): SituacionKit {
    if (kit.entregado) return 'ENTREGADO'
    if (!kit.incluye) return 'NO_INCLUYE'
    if (codigoEstado === 'APROBADO') return 'PENDIENTE'
    return codigoEstado === 'PENDIENTE' || codigoEstado === 'EN_REVISION' ? 'POR_APROBAR' : 'NO_CORRESPONDE'
}

export const TEXTO_SITUACION_KIT: Readonly<Record<SituacionKit, string>> = {
    ENTREGADO: 'Entregado',
    PENDIENTE: 'Pendiente de entrega',
    POR_APROBAR: 'Pago por aprobar',
    NO_INCLUYE: 'No incluye',
    NO_CORRESPONDE: 'No corresponde',
}

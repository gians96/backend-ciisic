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

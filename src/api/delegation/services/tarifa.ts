import type { Delegacion, Prisma, TipoInscripcion } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { monto, type ModalidadAsistencia } from '../../../core/catalogos'

/**
 * Tarifa y tipo de una delegación (spec 023). Los códigos de abajo son contrato: con ellos el
 * servidor resuelve el tipo y el precio de cada inscripción del grupo.
 * - Presencial: `delegacion_general` (precio estándar) por debajo del mínimo de integrantes y
 *   `delegacion_grupal` (promocional, sin kit) desde el mínimo.
 * - Virtual: `delegacion_virtual`, una tarifa única sin escalas.
 */
export const CATEGORIA_DELEGACIONES = 'DELEGACIONES'
export const CODIGO_TIPO_GENERAL = 'delegacion_general'
export const CODIGO_TIPO_PROMOCIONAL = 'delegacion_grupal'
export const CODIGO_TIPO_VIRTUAL = 'delegacion_virtual'

export const redondear = (valor: number) => Math.round(valor * 100) / 100

/** Tarifa por persona: la promocional en cuanto la delegación alcanza el mínimo de integrantes. */
export function precioUnitario(precioEstandar: number, precioPromocional: number, minIntegrantes: number, totalIntegrantes: number): number {
    return totalIntegrantes >= minIntegrantes ? precioPromocional : precioEstandar
}

/** Cuántos integrantes faltan para la tarifa promocional; `null` si ya aplica o no hay escala. */
export function faltanParaPromocional(precioEstandar: number, precioPromocional: number, minIntegrantes: number, totalIntegrantes: number): number | null {
    if (precioPromocional >= precioEstandar || totalIntegrantes >= minIntegrantes) return null
    return minIntegrantes - totalIntegrantes
}

/** Los tipos de delegación de un evento que el servidor usa para tarificar y tipificar. */
export interface TiposDeDelegacion {
    general: TipoInscripcion | null
    promocional: TipoInscripcion | null
    virtual: TipoInscripcion | null
}

type Lector = Pick<Prisma.TransactionClient, 'categoriaInscripcion'>

/** Tipos activos de la categoría `DELEGACIONES` de un evento, por su código de contrato. */
export async function tiposDeDelegacion(eventoId: number, db: Lector = prisma): Promise<TiposDeDelegacion> {
    const categoria = await db.categoriaInscripcion.findUnique({
        where: { eventoId_codigo: { eventoId, codigo: CATEGORIA_DELEGACIONES } },
        include: { tipos: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
    })
    const tipos = categoria?.tipos ?? []
    return {
        general: tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_GENERAL) ?? null,
        promocional: tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_PROMOCIONAL) ?? null,
        virtual: tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_VIRTUAL) ?? null,
    }
}

/**
 * El tipo que corresponde a un grupo de `total` integrantes. `null` si el evento no tiene ese tipo
 * configurado: las inscripciones quedan entonces sin tipo, con la misma tarifa.
 */
export function tipoParaGrupo(
    tipos: TiposDeDelegacion,
    delegacion: Pick<Delegacion, 'modalidad' | 'minIntegrantes'>,
    total: number,
): TipoInscripcion | null {
    if (delegacion.modalidad === 'VIRTUAL') return tipos.virtual
    return total >= delegacion.minIntegrantes ? tipos.promocional : tipos.general
}

/** Tarifa que copia una delegación al crearse (un cambio de precio posterior no altera lo ya cobrado). */
export interface TarifaCopiada {
    minIntegrantes: number
    precioEstandar: number
    precioPromocional: number
}

/**
 * Tarifa de un evento para una modalidad. Presencial: los precios de los tipos (o, si faltan, la
 * tarifa por defecto del evento). Virtual: el precio del tipo virtual para todos, o `null` si el
 * evento aún no lo tiene (la modalidad no se ofrece).
 */
export function tarifaParaModalidad(
    evento: { delegacionesMinIntegrantes: number, delegacionesPrecioEstandar: Prisma.Decimal, delegacionesPrecioPromocional: Prisma.Decimal },
    tipos: TiposDeDelegacion,
    modalidad: ModalidadAsistencia,
): TarifaCopiada | null {
    if (modalidad === 'VIRTUAL') {
        if (!tipos.virtual) return null
        const precio = monto(tipos.virtual.precio)
        return { minIntegrantes: evento.delegacionesMinIntegrantes, precioEstandar: precio, precioPromocional: precio }
    }
    return {
        minIntegrantes: evento.delegacionesMinIntegrantes,
        precioEstandar: monto(tipos.general?.precio ?? evento.delegacionesPrecioEstandar),
        precioPromocional: monto(tipos.promocional?.precio ?? evento.delegacionesPrecioPromocional),
    }
}

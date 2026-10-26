import { Prisma } from '@prisma/client'
import type { TipoInscripcion } from '@prisma/client'
import { monto, type ModalidadAsistencia } from '../../../core/catalogos'
import { conflict } from '../../../core/http-error'
import type { PlanesInput } from '../validation'

/**
 * Planes de una delegación (spec 029). Cada delegación tiene los suyos: tres tipos de inscripción dentro de su
 * categoría oculta `DELEGACION_<id>`, cada uno con su precio, su estado y, opcional, un precio promocional desde
 * `delegaciones.min_integrantes`. El integrante lleva el tipo del plan que eligió, así la credencial, el correo,
 * el escáner, el resumen y el CSV lo muestran como cualquier otro tipo. Los códigos de abajo son contrato.
 */
export const CODIGOS_PLAN = ['CON_KIT', 'SIN_KIT', 'VIRTUAL'] as const
export type CodigoPlan = typeof CODIGOS_PLAN[number]

interface DefinicionPlan {
    codigo: CodigoPlan
    /** `tipos_inscripcion.codigo` dentro de la categoría de la delegación. */
    codigoTipo: string
    etiqueta: string
    modalidad: ModalidadAsistencia
    /** Spec 037: el plan incluye el kit (solo `CON_KIT`): el escáner avisa y deja marcar su entrega. */
    incluyeKit: boolean
    orden: number
}

export const PLANES: readonly DefinicionPlan[] = [
    { codigo: 'CON_KIT', codigoTipo: 'delegacion_con_kit', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL', incluyeKit: true, orden: 1 },
    { codigo: 'SIN_KIT', codigoTipo: 'delegacion_sin_kit', etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL', incluyeKit: false, orden: 2 },
    { codigo: 'VIRTUAL', codigoTipo: 'delegacion_virtual', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', incluyeKit: false, orden: 3 },
]

/** Prefijo del código de la categoría oculta de cada delegación. */
export const PREFIJO_CATEGORIA_DELEGACION = 'DELEGACION_'
/** Las categorías de delegación van después de las de la landing. */
const ORDEN_BASE_CATEGORIA = 1000

export const redondear = (valor: number) => Math.round(valor * 100) / 100

export function esCodigoPlan(valor: unknown): valor is CodigoPlan {
    return typeof valor === 'string' && (CODIGOS_PLAN as readonly string[]).includes(valor)
}

/** El plan al que corresponde un tipo de la categoría de una delegación (`null` si no es uno de los tres). */
export function planDeTipo(tipo: Pick<TipoInscripcion, 'codigo'>): CodigoPlan | null {
    return PLANES.find((plan) => plan.codigoTipo === tipo.codigo)?.codigo ?? null
}

export const definicionDe = (codigo: CodigoPlan): DefinicionPlan => PLANES.find((plan) => plan.codigo === codigo) as DefinicionPlan

/** Nombre del tipo: lo que se imprime en la credencial junto a la etiqueta («DELEGACION UNAC · CON KIT»). */
export const nombreDeTipo = (nombreDelegacion: string) => `DELEGACION ${nombreDelegacion.toLocaleUpperCase('es')}`.slice(0, 191)

export const codigoCategoria = (delegacionId: number) => `${PREFIJO_CATEGORIA_DELEGACION}${delegacionId}`
export const ordenCategoria = (delegacionId: number) => ORDEN_BASE_CATEGORIA + delegacionId

/** Precio por persona de un plan: el promocional en cuanto la delegación alcanza el mínimo de integrantes. */
export function precioUnitario(precio: number, precioPromocional: number | null, minIntegrantes: number, totalIntegrantes: number): number {
    return precioPromocional !== null && precioPromocional < precio && totalIntegrantes >= minIntegrantes ? precioPromocional : precio
}

/** Un plan de la delegación tal como lo ven las pantallas. Sin `pagos.ver` los importes van en `null`. */
export interface PlanDelegacion {
    codigo: CodigoPlan
    tipoInscripcionId: number
    etiqueta: string | null
    modalidad: ModalidadAsistencia
    activo: boolean
    precio: number | null
    precioPromocional: number | null
    /** Lo que paga hoy cada integrante de este plan (con el promocional si el grupo ya llegó al mínimo). */
    precioUnitario: number | null
    integrantes: number
}

/** Los tipos de una delegación, ordenados como los planes y con su código de plan. */
export function planesOrdenados(tipos: readonly TipoInscripcion[]): Array<{ plan: CodigoPlan, tipo: TipoInscripcion }> {
    return PLANES.flatMap((definicion) => {
        const tipo = tipos.find((candidato) => candidato.codigo === definicion.codigoTipo)
        return tipo ? [{ plan: definicion.codigo, tipo }] : []
    })
}

export function aPlan(
    plan: CodigoPlan,
    tipo: TipoInscripcion,
    contexto: { minIntegrantes: number, totalIntegrantes: number, integrantes: number, conPago: boolean },
): PlanDelegacion {
    const precio = monto(tipo.precio)
    const promocional = tipo.precioPromocional === null || tipo.precioPromocional === undefined ? null : monto(tipo.precioPromocional)
    const unitario = precioUnitario(precio, promocional, contexto.minIntegrantes, contexto.totalIntegrantes)
    return {
        codigo: plan,
        tipoInscripcionId: tipo.id,
        etiqueta: tipo.etiqueta,
        modalidad: tipo.modalidad,
        activo: tipo.activo,
        precio: contexto.conPago ? precio : null,
        precioPromocional: contexto.conPago ? promocional : null,
        precioUnitario: contexto.conPago ? unitario : null,
        integrantes: contexto.integrantes,
    }
}

/** Cuántos integrantes faltan para el precio promocional (`null` si ningún plan lo tiene o ya aplica). */
export function faltanParaPromocional(tipos: readonly TipoInscripcion[], minIntegrantes: number, totalIntegrantes: number): number | null {
    const hayEscala = tipos.some((tipo) => tipo.activo && tipo.precioPromocional !== null && tipo.precioPromocional !== undefined && monto(tipo.precioPromocional) < monto(tipo.precio))
    if (!hayEscala || totalIntegrantes >= minIntegrantes) return null
    return minIntegrantes - totalIntegrantes
}

// ─── Creación y edición de los planes ───────────────────────────────────────

/** Datos con los que nace cada plan de una delegación: apagado y sin precio hasta que un Owner o Administrador lo fije. */
export function datosDePlan(categoriaId: number, nombreDelegacion: string, plan: CodigoPlan, cambios?: PlanesInput[CodigoPlan]): Prisma.TipoInscripcionUncheckedCreateInput {
    const definicion = definicionDe(plan)
    const precio = cambios?.precio ?? 0
    return {
        categoriaId,
        codigo: definicion.codigoTipo,
        nombre: nombreDeTipo(nombreDelegacion),
        etiqueta: definicion.etiqueta,
        precio,
        precioInstitucional: precio,
        precioPromocional: cambios?.precioPromocional ?? null,
        disponiblePara: 'TODOS',
        modalidad: definicion.modalidad,
        incluyeKit: definicion.incluyeKit,
        activo: cambios?.activo ?? false,
        orden: definicion.orden,
    }
}

/**
 * Mezcla lo que llega con lo vigente de un plan y comprueba las reglas: un plan activo necesita precio, y el
 * promocional no puede superar al precio (`409 INVALID_PRICES`, como en los tipos).
 */
export function resultadoDePlan(actual: Pick<TipoInscripcion, 'precio' | 'precioPromocional' | 'activo'> | null, cambios: PlanesInput[CodigoPlan] | undefined) {
    const precio = cambios?.precio ?? (actual ? monto(actual.precio) : 0)
    const promocional = cambios?.precioPromocional !== undefined
        ? cambios.precioPromocional
        : (actual?.precioPromocional === null || actual?.precioPromocional === undefined ? null : monto(actual.precioPromocional))
    const activo = cambios?.activo ?? actual?.activo ?? false
    if (promocional !== null && promocional > precio) throw conflict('INVALID_PRICES', 'El precio promocional no puede ser mayor que el precio del plan.')
    if (activo && precio <= 0) throw conflict('INVALID_PRICES', 'Un plan activo necesita un precio mayor que cero.')
    return { precio, promocional, activo }
}

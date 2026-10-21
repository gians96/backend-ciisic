import { Prisma } from '@prisma/client'
import type { Evento, TipoInscripcion } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { monto } from '../../../core/catalogos'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { TarifaDelegacionesInput } from '../validation'
import { CUENTAN_COMO_INTEGRANTE } from './delegation'
import { CATEGORIA_DELEGACIONES, CODIGO_TIPO_GENERAL, CODIGO_TIPO_PROMOCIONAL, CODIGO_TIPO_VIRTUAL } from './tarifa'

/**
 * Tarifa de las delegaciones de un evento, administrable desde el panel (spec 024). Los precios viven en
 * los tres tipos de la categoría `DELEGACIONES` (contrato de la spec 023) y el mínimo de integrantes en
 * `eventos.delegaciones_min_integrantes`; los precios del evento solo son el respaldo si falta un tipo y
 * aquí se mantienen iguales a los tipos. Cada delegación copia la tarifa al crearse: guardar aquí no toca
 * lo ya cobrado, salvo que se pida `aplicarAExistentes` y la delegación no tenga integrantes ni vouchers.
 */

/** Precio por persona de una delegación virtual cuando el evento aún no tiene su tipo ni se indica uno. */
const PRECIO_VIRTUAL_POR_DEFECTO = 30

type Lector = Pick<Prisma.TransactionClient, 'categoriaInscripcion' | 'delegacion'>
type EventoTarifa = Pick<Evento, 'delegacionesMinIntegrantes' | 'delegacionesPrecioEstandar' | 'delegacionesPrecioPromocional'>

export interface TarifaAdmin {
    minIntegrantes: number
    presencial: { precioEstandar: number, precioPromocional: number }
    /** `null` mientras el evento no tenga el tipo `delegacion_virtual`; con `activo: false` la landing no la ofrece. */
    virtual: { precio: number, activo: boolean } | null
    delegaciones: { total: number, sinIntegrantes: number }
}

/** Delegaciones del evento que aún no tienen integrantes activos ni vouchers: las únicas que se reprecian en bloque. */
const sinIntegrantesNiVouchers = (eventoId: number): Prisma.DelegacionWhereInput => ({
    eventoId,
    inscripciones: { none: CUENTAN_COMO_INTEGRANTE },
    pagos: { none: {} },
})

async function categoriaDelegaciones(eventoId: number, db: Lector) {
    return db.categoriaInscripcion.findUnique({
        where: { eventoId_codigo: { eventoId, codigo: CATEGORIA_DELEGACIONES } },
        include: { tipos: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
    })
}

async function contarDelegaciones(eventoId: number, db: Lector): Promise<TarifaAdmin['delegaciones']> {
    const [total, sinIntegrantes] = await Promise.all([
        db.delegacion.count({ where: { eventoId } }),
        db.delegacion.count({ where: sinIntegrantesNiVouchers(eventoId) }),
    ])
    return { total, sinIntegrantes }
}

/** Lo que cobra hoy el presencial: el precio del tipo activo o, si falta, el del evento (igual que la landing). */
function presencialVigente(evento: EventoTarifa, tipos: TipoInscripcion[]) {
    const activo = (codigo: string) => tipos.find((tipo) => tipo.codigo === codigo && tipo.activo) ?? null
    return {
        precioEstandar: monto(activo(CODIGO_TIPO_GENERAL)?.precio ?? evento.delegacionesPrecioEstandar),
        precioPromocional: monto(activo(CODIGO_TIPO_PROMOCIONAL)?.precio ?? evento.delegacionesPrecioPromocional),
    }
}

export async function obtenerTarifaAdmin(eventoId: number): Promise<TarifaAdmin> {
    const evento = await obtenerEventoPorId(eventoId)
    const tipos = (await categoriaDelegaciones(eventoId, prisma))?.tipos ?? []
    const virtual = tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_VIRTUAL) ?? null
    return {
        minIntegrantes: evento.delegacionesMinIntegrantes,
        presencial: presencialVigente(evento, tipos),
        virtual: virtual ? { precio: monto(virtual.precio), activo: virtual.activo } : null,
        delegaciones: await contarDelegaciones(eventoId, prisma),
    }
}

/** El tipo virtual de un evento que no lo tiene: mismos textos que `prisma/preflight/configurar-delegacion-virtual.sql`. */
function datosTipoVirtual(categoriaId: number, tipos: TipoInscripcion[], precio: number, activo: boolean): Prisma.TipoInscripcionUncheckedCreateInput {
    return {
        categoriaId,
        codigo: CODIGO_TIPO_VIRTUAL,
        nombre: 'DELEGACION VIRTUAL',
        etiqueta: 'VIRTUAL',
        descripcion: `Tarifa de inscripción para delegaciones que asisten de forma virtual. El costo por persona es de S/ ${precio.toFixed(2)}, sin importar el número de participantes.`,
        caracteristicas: [
            { icon: 'heroicons:computer-desktop', text: 'Participación virtual en las ponencias transmitidas' },
            { icon: 'heroicons:x-mark', text: 'No incluye kit ni ingreso presencial' },
        ],
        precio,
        precioInstitucional: precio,
        disponiblePara: 'TODOS',
        modalidad: 'VIRTUAL',
        activo,
        orden: tipos.reduce((mayor, tipo) => Math.max(mayor, tipo.orden), 0) + 1,
    }
}

/**
 * Guarda la tarifa del evento: precios de los tipos, mínimo y respaldo del evento, todo en una transacción
 * con el evento bloqueado. Lo que no llega se conserva; el promocional no puede superar al estándar
 * (`409 INVALID_PRICES`, como en los tipos). Con `aplicarAExistentes` también copia la tarifa a las
 * delegaciones sin integrantes ni vouchers (las demás se editan una por una).
 */
export async function guardarTarifa(eventoId: number, input: TarifaDelegacionesInput) {
    await obtenerEventoPorId(eventoId)
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM eventos WHERE id = ${eventoId} FOR UPDATE`
        const evento = await tx.evento.findUnique({ where: { id: eventoId } })
        if (!evento) throw notFound('EVENT_NOT_FOUND', 'El evento no existe.')
        const categoria = await categoriaDelegaciones(eventoId, tx)
        const tipos = categoria?.tipos ?? []
        const general = tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_GENERAL) ?? null
        const promocional = tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_PROMOCIONAL) ?? null
        const virtual = tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_VIRTUAL) ?? null

        const vigente = presencialVigente(evento, tipos)
        const minIntegrantes = input.minIntegrantes ?? evento.delegacionesMinIntegrantes
        const precioEstandar = input.precioEstandar ?? vigente.precioEstandar
        const precioPromocional = input.precioPromocional ?? vigente.precioPromocional
        if (precioPromocional > precioEstandar) throw conflict('INVALID_PRICES', 'El precio promocional no puede ser mayor que el precio estándar.')

        await tx.evento.update({
            where: { id: eventoId },
            data: { delegacionesMinIntegrantes: minIntegrantes, delegacionesPrecioEstandar: precioEstandar, delegacionesPrecioPromocional: precioPromocional },
        })
        if (general && input.precioEstandar !== undefined) {
            await tx.tipoInscripcion.update({ where: { id: general.id }, data: { precio: precioEstandar, precioInstitucional: precioEstandar } })
        }
        if (promocional && input.precioPromocional !== undefined) {
            await tx.tipoInscripcion.update({ where: { id: promocional.id }, data: { precio: precioPromocional, precioInstitucional: precioPromocional } })
        }

        let precioVirtual: number | null = virtual ? monto(virtual.precio) : null
        let virtualActivo = virtual?.activo ?? false
        if (virtual) {
            const cambios: Prisma.TipoInscripcionUpdateInput = {}
            if (input.precioVirtual !== undefined) {
                cambios.precio = input.precioVirtual
                cambios.precioInstitucional = input.precioVirtual
                precioVirtual = input.precioVirtual
            }
            if (input.virtualActivo !== undefined) {
                cambios.activo = input.virtualActivo
                virtualActivo = input.virtualActivo
            }
            if (Object.keys(cambios).length) await tx.tipoInscripcion.update({ where: { id: virtual.id }, data: cambios })
        } else if (input.precioVirtual !== undefined || input.virtualActivo === true) {
            if (!categoria) throw unprocessable('DELEGATION_CATEGORY_NOT_FOUND', 'El evento no tiene la categoría DELEGACIONES: créala en Tipos de inscripción.')
            precioVirtual = input.precioVirtual ?? PRECIO_VIRTUAL_POR_DEFECTO
            virtualActivo = input.virtualActivo ?? true
            await tx.tipoInscripcion.create({ data: datosTipoVirtual(categoria.id, tipos, precioVirtual, virtualActivo) })
        }

        let delegacionesActualizadas = 0
        if (input.aplicarAExistentes) {
            // Con las delegaciones del evento bloqueadas, nadie les suma integrantes mientras se reprecian
            await tx.$queryRaw`SELECT id FROM delegaciones WHERE evento_id = ${eventoId} ORDER BY id FOR UPDATE`
            const vacias = await tx.delegacion.findMany({ where: sinIntegrantesNiVouchers(eventoId), select: { id: true, modalidad: true } })
            const presenciales = vacias.filter((delegacion) => delegacion.modalidad === 'PRESENCIAL').map((delegacion) => delegacion.id)
            const virtuales = vacias.filter((delegacion) => delegacion.modalidad === 'VIRTUAL').map((delegacion) => delegacion.id)
            if (presenciales.length) {
                await tx.delegacion.updateMany({ where: { id: { in: presenciales } }, data: { minIntegrantes, precioEstandar, precioPromocional } })
                delegacionesActualizadas += presenciales.length
            }
            if (virtuales.length && precioVirtual !== null) {
                await tx.delegacion.updateMany({ where: { id: { in: virtuales } }, data: { minIntegrantes, precioEstandar: precioVirtual, precioPromocional: precioVirtual } })
                delegacionesActualizadas += virtuales.length
            }
        }

        const tarifa: TarifaAdmin = {
            minIntegrantes,
            presencial: { precioEstandar, precioPromocional },
            virtual: precioVirtual === null ? null : { precio: precioVirtual, activo: virtualActivo },
            delegaciones: await contarDelegaciones(eventoId, tx),
        }
        return { ...tarifa, delegacionesActualizadas }
    })
}

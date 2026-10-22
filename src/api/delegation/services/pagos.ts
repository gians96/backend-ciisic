import fs from 'fs'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import type { DelegacionPago } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import { monto } from '../../../core/catalogos'
import { aColumnaFecha, fechaSoloDia } from '../../../core/fechas'
import { uploadedFilePath } from '../../../middlewares/upload'
import { redondear } from './planes'
import type { AgregarPagosInput, EstadoPagoDelegacionInput, PagoDelegacionInput } from '../validation'

/**
 * Pagos de una delegación (spec 023). Una delegación puede pagar en varias partes: cada voucher es
 * una fila con su archivo, su número de operación y el monto que declara el delegado. El staff
 * contrasta cada uno con el banco y lo marca VERIFICADO o RECHAZADO.
 */

/** Resumen de lo que debe y lo que ya declaró la delegación. Un voucher rechazado no cuenta. */
export function resumenPagos(totalAPagar: number, pagos: ReadonlyArray<{ monto: Prisma.Decimal | number, estado: string }>) {
    const suma = (filas: ReadonlyArray<{ monto: Prisma.Decimal | number }>) => redondear(filas.reduce((total, fila) => total + monto(fila.monto), 0))
    const declarado = suma(pagos.filter((pago) => pago.estado !== 'RECHAZADO'))
    return {
        totalAPagar: redondear(totalAPagar),
        declarado,
        verificado: suma(pagos.filter((pago) => pago.estado === 'VERIFICADO')),
        saldo: redondear(totalAPagar - declarado),
        cantidad: pagos.length,
    }
}

/** El número de operación se enmascara en la vista pública: solo se reconocen los últimos dígitos. */
export function enmascararOperacion(numero: string): string {
    const limpio = numero.trim()
    return limpio.length <= 4 ? '****' : `****${limpio.slice(-4)}`
}

/** Forma de un pago para el staff. El archivo se pide aparte (`GET …/payments/:id/voucher`). */
export function aPago(pago: DelegacionPago) {
    return {
        id: pago.id,
        modalidadPago: pago.modalidadPago,
        banco: pago.banco,
        billeteraDigital: pago.billeteraDigital,
        tipoOperacion: pago.tipoOperacion,
        numeroOperacion: pago.numeroOperacion,
        fechaPago: fechaSoloDia(pago.fechaPago),
        monto: monto(pago.monto),
        estado: pago.estado,
        motivoRechazo: pago.motivoRechazo,
        revisadoEn: pago.revisadoEn,
        creadoEn: pago.creadoEn,
    }
}

/** Forma de un pago para el delegado (link público): sin el motivo interno ni el número completo. */
export function aPagoPublico(pago: DelegacionPago) {
    return {
        id: pago.id,
        medio: pago.modalidadPago === 'banco' ? pago.banco : pago.billeteraDigital,
        numeroOperacion: enmascararOperacion(pago.numeroOperacion),
        fechaPago: fechaSoloDia(pago.fechaPago),
        monto: monto(pago.monto),
        estado: pago.estado,
        creadoEn: pago.creadoEn,
    }
}

/**
 * Rechaza con `409 OPERATION_ALREADY_REGISTERED` un número repetido en el mismo envío o que ya
 * existe en el evento (en otro voucher de delegación o en una inscripción individual).
 */
export async function exigirOperacionesLibres(eventoId: number, pagos: ReadonlyArray<Pick<PagoDelegacionInput, 'numeroOperacion'>>): Promise<void> {
    const numeros = pagos.map((pago) => pago.numeroOperacion.trim())
    if (new Set(numeros.map((numero) => numero.toLowerCase())).size !== numeros.length) {
        throw conflict('OPERATION_ALREADY_REGISTERED', 'Hay números de operación repetidos en el envío.')
    }
    const [enPagos, enInscripciones] = await Promise.all([
        prisma.delegacionPago.findFirst({ where: { eventoId, numeroOperacion: { in: numeros } }, select: { id: true } }),
        prisma.inscripcion.findFirst({ where: { eventoId, numeroOperacion: { in: numeros } }, select: { id: true } }),
    ])
    if (enPagos || enInscripciones) throw conflict('OPERATION_ALREADY_REGISTERED', 'El número de operación ya está registrado.')
}

/** Traduce la violación del índice único del número de operación (dos envíos a la vez). */
export function errorDeOperacionDuplicada(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '')
        if (target.includes('numero_operacion')) throw conflict('OPERATION_ALREADY_REGISTERED', 'El número de operación ya está registrado.')
    }
    throw error
}

/** Guarda los vouchers dentro de la transacción del llamador (el archivo `i` es el del pago `i`). */
export async function insertarPagos(
    tx: Prisma.TransactionClient,
    delegacion: { id: number, eventoId: number },
    pagos: ReadonlyArray<PagoDelegacionInput>,
    archivos: ReadonlyArray<string>,
): Promise<void> {
    for (const [indice, pago] of pagos.entries()) {
        await tx.delegacionPago.create({
            data: {
                delegacionId: delegacion.id,
                eventoId: delegacion.eventoId,
                modalidadPago: pago.modalidadPago,
                banco: pago.modalidadPago === 'banco' ? pago.banco ?? null : null,
                tipoOperacion: pago.modalidadPago === 'banco' ? pago.tipoOperacion ?? null : null,
                billeteraDigital: pago.modalidadPago === 'billetera' ? pago.billeteraDigital ?? null : null,
                numeroOperacion: pago.numeroOperacion.trim(),
                fechaPago: aColumnaFecha(pago.fechaPago),
                monto: pago.monto,
                voucherArchivo: archivos[indice] ?? '',
            },
        })
    }
}

/** Suma vouchers a una delegación ya registrada (por su link o desde el panel). */
export async function agregarPagos(delegacion: { id: number, eventoId: number }, input: AgregarPagosInput, archivos: ReadonlyArray<string>): Promise<void> {
    await exigirOperacionesLibres(delegacion.eventoId, input.pagos)
    try {
        await prisma.$transaction((tx) => insertarPagos(tx, delegacion, input.pagos, archivos))
    } catch (error) {
        throw errorDeOperacionDuplicada(error)
    }
}

async function pagoDe(delegacionId: number, pagoId: number): Promise<DelegacionPago> {
    const pago = await prisma.delegacionPago.findFirst({ where: { id: pagoId, delegacionId } })
    if (!pago) throw notFound('PAYMENT_NOT_FOUND', `Pago ${pagoId} no encontrado en la delegación ${delegacionId}`)
    return pago
}

/** El staff marca un voucher como VERIFICADO, RECHAZADO (con motivo) o lo devuelve a PENDIENTE. */
export async function cambiarEstadoPago(delegacionId: number, pagoId: number, input: EstadoPagoDelegacionInput, adminId?: number) {
    await pagoDe(delegacionId, pagoId)
    const pago = await prisma.delegacionPago.update({
        where: { id: pagoId },
        data: input.estado === 'PENDIENTE'
            ? { estado: 'PENDIENTE', motivoRechazo: null, revisadoEn: null, revisadoPorId: null }
            : {
                estado: input.estado,
                motivoRechazo: input.estado === 'RECHAZADO' ? input.motivo ?? null : null,
                revisadoEn: new Date(),
                revisadoPorId: adminId ?? null,
            },
    })
    return aPago(pago)
}

/** Borra un voucher y su archivo. Uno ya verificado no se borra: primero se devuelve a PENDIENTE. */
export async function eliminarPago(delegacionId: number, pagoId: number): Promise<void> {
    const pago = await pagoDe(delegacionId, pagoId)
    if (pago.estado === 'VERIFICADO') throw conflict('PAYMENT_VERIFIED', 'El voucher ya está verificado: devuélvelo a pendiente antes de eliminarlo.')
    await prisma.delegacionPago.delete({ where: { id: pagoId } })
    quitarArchivo(pago.voucherArchivo)
}

/** Ruta del archivo de un voucher, para servirlo al staff. */
export async function archivoVoucherPago(delegacionId: number, pagoId: number): Promise<string> {
    const pago = await pagoDe(delegacionId, pagoId)
    const ruta = uploadedFilePath(pago.voucherArchivo)
    if (!fs.existsSync(ruta)) throw notFound('VOUCHER_NOT_FOUND', 'El archivo del voucher no existe en el servidor.')
    return ruta
}

/** Borra un archivo de `uploads` sin fallar si ya no está. */
export function quitarArchivo(nombre: string | null | undefined): void {
    if (!nombre) return
    try {
        const ruta = uploadedFilePath(nombre)
        if (fs.existsSync(ruta)) fs.unlinkSync(ruta)
    } catch {
        console.warn('[delegaciones] No se pudo borrar un archivo de voucher')
    }
}

/** Código interno de la inscripción de un integrante: el pago es de la delegación, no de la persona. */
export const numeroOperacionInterno = () => `DELEGACION-${crypto.randomUUID()}`

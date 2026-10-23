import type { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, unprocessable } from '../../../core/http-error'
import { modalidadDe, monto, type ModalidadAsistencia } from '../../../core/catalogos'
import { bloquearPonencias, exigirCupo } from '../../specialized-talk/services/registrations'
import { borrarCredenciales } from '../utils/generatePdf'
import { obtenerInscripcion } from './inscription'
import { descuentoSobreLista } from './pricing'
import type { InscripcionDetalle } from './mappers'
import type { CambiarTipoInput } from '../validation'

/**
 * Cambio del tipo de una inscripción (spec 035). El Owner corrige a quien eligió mal su tipo al inscribirse (con el
 * tipo cambia la categoría). Es una corrección de **clasificación**, no de pago:
 * - El monto pagado **no cambia** (es lo que dice su voucher); el descuento se recalcula contra el precio de lista del
 *   tipo nuevo (sin descuento en las cortesías).
 * - No se aplican `disponiblePara` ni `excluyeEstudiantesUndc`: esas reglas frenan inscripciones nuevas y esta es una
 *   corrección deliberada. Sí se exige que el tipo sea del mismo evento y no de una delegación.
 * - Las inscripciones de una delegación no se mueven aquí: su plan lo decide y recalcula Delegaciones.
 * - Cada cambio queda en `cambios_tipo_inscripcion` con el texto de los dos tipos y quién lo hizo.
 */

interface TipoRotulable {
    nombre: string
    etiqueta: string | null
    categoria: { nombre: string }
}

/**
 * «Tipo · etiqueta», con la categoría entre paréntesis solo si su nombre no está ya dentro del nombre del tipo (lo
 * normal es que el tipo ya la nombre). Sin tipo (cortesía) es «Sin tipo».
 */
export function etiquetaDeTipo(tipo: TipoRotulable | null | undefined): string {
    if (!tipo) return 'Sin tipo'
    const base = [tipo.nombre, tipo.etiqueta].filter(Boolean).join(' · ')
    const yaLaNombra = tipo.nombre.toLowerCase().includes(tipo.categoria.nombre.toLowerCase())
    return (yaLaNombra ? base : `${base} (${tipo.categoria.nombre})`).slice(0, 400)
}

export interface CambioDeTipo {
    inscripcion: InscripcionDetalle
    /** Inscripciones a ponencias especializadas que pasaron al modo del tipo nuevo (0 si la modalidad no cambió). */
    ponenciasActualizadas: number
}

/**
 * Las inscripciones **pendientes** a ponencias especializadas de esta persona (vigentes, sin asistencia y que aún no
 * terminan) toman el modo de asistencia del tipo nuevo: la presencial ocupa aforo y la virtual no. Las que ya
 * asistieron conservan el modo con el que asistieron. Pasar a presencial pide cupo en cada una (409 `TALK_FULL_ON_TYPE_CHANGE`: no se
 * cambia nada); pasar a virtual libera el suyo. Corre dentro de la transacción del cambio.
 */
async function sincronizarPonencias(tx: Prisma.TransactionClient, inscripcionId: number, modo: ModalidadAsistencia, ahora: Date): Promise<number> {
    const pendientes = await tx.inscripcionPonencia.findMany({
        where: { inscripcionCongresoId: inscripcionId, estado: 'INSCRITO', asistioEn: null, modoAsistencia: { not: modo }, ponencia: { horaFin: { gt: ahora } } },
        select: { id: true, ponenciaId: true },
    })
    if (!pendientes.length) return 0
    if (modo === 'PRESENCIAL') {
        for (const ponencia of await bloquearPonencias(tx, pendientes.map((fila) => fila.ponenciaId))) {
            try {
                await exigirCupo(tx, ponencia, 'PRESENCIAL')
            } catch (error) {
                if (error instanceof HttpError && error.code === 'TALK_FULL') {
                    throw conflict('TALK_FULL_ON_TYPE_CHANGE', `No se puede pasar a una modalidad presencial: la persona está inscrita a «${ponencia.tema}», que ya no tiene cupos presenciales. Amplía su cupo o cancela esa inscripción y vuelve a intentarlo.`)
                }
                throw error
            }
        }
    }
    await tx.inscripcionPonencia.updateMany({ where: { id: { in: pendientes.map((fila) => fila.id) } }, data: { modoAsistencia: modo } })
    return pendientes.length
}

export async function cambiarTipo(id: number, input: CambiarTipoInput, adminId: number, ahora = new Date()): Promise<CambioDeTipo> {
    const actual = await obtenerInscripcion(id)
    if (actual.delegacionId !== null || actual.tipoInscripcion?.categoria.delegacionId) {
        throw conflict('INSCRIPTION_IN_DELEGATION', 'Esta inscripción pertenece a una delegación: su plan se cambia desde Delegaciones.')
    }
    if (actual.tipoInscripcionId === input.tipoInscripcionId) throw conflict('TYPE_UNCHANGED', 'La inscripción ya tiene ese tipo.')

    const nuevo = await prisma.tipoInscripcion.findFirst({
        where: { id: input.tipoInscripcionId, categoria: { eventoId: actual.eventoId, delegacionId: null } },
        include: { categoria: true },
    })
    if (!nuevo) throw unprocessable('REGISTRATION_TYPE_INVALID', 'El tipo de inscripción no existe o no pertenece a este evento.', { tipoInscripcionId: 'Elige un tipo del evento' })

    // Lo pagado no cambia; el descuento es contra el precio de lista del tipo nuevo (una cortesía no tiene descuento)
    const descuento = actual.modalidadPago === 'cortesia' ? 0 : descuentoSobreLista(monto(nuevo.precio), monto(actual.monto))
    const modoNuevo = modalidadDe(nuevo.modalidad)
    const cambiaElModo = modalidadDe(actual.tipoInscripcion?.modalidad) !== modoNuevo

    const ponenciasActualizadas = await prisma.$transaction(async (tx) => {
        // Condicionada al tipo que se leyó: si otra petición lo cambió (o sumó a la persona a una delegación), no pisa
        const { count } = await tx.inscripcion.updateMany({
            where: { id, tipoInscripcionId: actual.tipoInscripcionId, delegacionId: null },
            data: { tipoInscripcionId: nuevo.id, descuento, tieneDescuento: descuento > 0 },
        })
        if (count !== 1) throw conflict('INSCRIPTION_CHANGED', 'La inscripción cambió mientras se guardaba. Ábrela de nuevo e inténtalo otra vez.')
        await tx.cambioTipoInscripcion.create({
            data: { inscripcionId: id, anterior: etiquetaDeTipo(actual.tipoInscripcion), nuevo: etiquetaDeTipo(nuevo), motivo: input.motivo?.trim() || null, realizadoPorId: adminId },
        })
        return cambiaElModo ? sincronizarPonencias(tx, id, modoNuevo, ahora) : 0
    })

    // La credencial lleva el tipo: se descartan los PDF guardados y el siguiente se genera con el tipo nuevo
    borrarCredenciales(id)
    console.info(`[inscripciones] La cuenta ${adminId} cambió el tipo de la inscripción ${id} (${actual.tipoInscripcionId ?? 'sin tipo'} → ${nuevo.id})`)
    return { inscripcion: await obtenerInscripcion(id), ponenciasActualizadas }
}

/** Correcciones de tipo de una inscripción, de la más reciente a la más antigua. */
export async function historialDeTipo(inscripcionId: number) {
    const filas = await prisma.cambioTipoInscripcion.findMany({
        where: { inscripcionId },
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        take: 50,
        include: { realizadoPor: { select: { id: true, nombres: true, apellidos: true } } },
    })
    return filas.map((fila) => ({
        id: fila.id,
        creadoEn: fila.creadoEn,
        anterior: fila.anterior,
        nuevo: fila.nuevo,
        motivo: fila.motivo,
        realizadoPor: fila.realizadoPor,
    }))
}

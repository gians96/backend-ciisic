import { Prisma } from '@prisma/client'
import type { AsistentePonencia } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { HttpError, unprocessable } from '../../../core/http-error'
import { consultarDni } from '../../document-lookup/services/lookup'
import { apellidosDe, nombresOficiales } from '../../document-lookup/services/cache'
import { enmascararDocumento } from '../../activity/services/activity'
import type { AsistenteInput } from '../validation'
import type { Congresista } from './congresista'

/**
 * - `SITIO`: el visitante anónimo de la landing. Los nombres oficiales salen solo de la caché de
 *   consultas (la landing ya consultó el DNI), como en la inscripción: no gasta consultas del proveedor.
 * - `PANEL`: una cuenta de staff. Consulta el DNI si hace falta y completa datos vacíos del asistente.
 */
export type ModoResolucion = 'SITIO' | 'PANEL'

export function aAsistente(asistente: AsistentePonencia, enmascarar = false) {
    return {
        id: asistente.id,
        tipoDocumento: asistente.tipoDocumentoId,
        numeroDocumento: enmascarar ? enmascararDocumento(asistente.numeroDocumento) : asistente.numeroDocumento,
        nombres: asistente.nombres,
        apellidos: asistente.apellidos,
        correo: asistente.correo,
        celular: asistente.celular,
        procedencia: asistente.procedencia,
    }
}

const claveDocumento = (input: Pick<AsistenteInput, 'tipoDocumento' | 'numeroDocumento'>) =>
    ({ tipoDocumentoId_numeroDocumento: { tipoDocumentoId: input.tipoDocumento, numeroDocumento: input.numeroDocumento } })

/**
 * Nombres del documento: los oficiales de la consulta DNI y, si no hay, los enviados. Sin ninguno,
 * 422 `NAMES_REQUIRED` con los campos que faltan (el panel los pide a mano).
 */
async function nombresPara(input: AsistenteInput, modo: ModoResolucion): Promise<{ nombres: string, apellidos: string }> {
    if (input.tipoDocumento === 'dni') {
        if (modo === 'SITIO') {
            const oficial = await nombresOficiales(input.numeroDocumento)
            if (oficial) return { nombres: oficial.nombres, apellidos: apellidosDe(oficial) }
        } else {
            try {
                const persona = await consultarDni(input.numeroDocumento, 'PANEL')
                return { nombres: persona.nombres, apellidos: apellidosDe(persona) }
            } catch (error) {
                // 404 y 503 de la consulta son esperables; otro error se registra sin datos personales
                if (!(error instanceof HttpError)) console.error('No se pudo consultar el DNI de una ponencia especializada')
            }
        }
    }
    if (input.nombres && input.apellidos) return { nombres: input.nombres.slice(0, 120), apellidos: input.apellidos.slice(0, 120) }
    throw unprocessable('NAMES_REQUIRED', 'No se pudieron obtener los nombres del documento. Ingresa los nombres y apellidos.', {
        ...(input.nombres ? {} : { nombres: 'Ingresa los nombres' }),
        ...(input.apellidos ? {} : { apellidos: 'Ingresa los apellidos' }),
    })
}

/** El staff puede completar lo que falta (correo, celular, procedencia) pero no pisa lo que ya hay. */
async function completarVacios(actual: AsistentePonencia, input: AsistenteInput): Promise<AsistentePonencia> {
    const data: Prisma.AsistentePonenciaUpdateInput = {
        ...(actual.correo === null && input.correo ? { correo: input.correo } : {}),
        ...(actual.celular === null && input.celular ? { celular: input.celular } : {}),
        ...(actual.procedencia === null && input.procedencia ? { procedencia: input.procedencia as 'INTERNO' | 'EXTERNO' } : {}),
    }
    if (!Object.keys(data).length) return actual
    return prisma.asistentePonencia.update({ where: { id: actual.id }, data })
}

/**
 * Con un congresista validado (spec 030) los datos de la persona salen de su inscripción al congreso:
 * nombres, correo y celular, y la procedencia (interno = correo institucional o estudiante UNDC) si no
 * viene indicada. No se consulta el DNI: ya es el nombre con el que se inscribió.
 */
function conDatosDelCongreso(input: AsistenteInput, congresista: Congresista): AsistenteInput {
    const { participante, inscripcion } = congresista
    return {
        ...input,
        nombres: participante.nombres.slice(0, 120),
        apellidos: participante.apellidos.slice(0, 120),
        correo: participante.correo.slice(0, 191),
        celular: participante.celular,
        procedencia: input.procedencia ?? (inscripcion.interno ? 'INTERNO' : 'EXTERNO'),
    }
}

/**
 * Asistente por documento; lo crea si no existe. Va antes de abrir la transacción de inscripción para
 * no mantener bloqueos mientras se consulta una API externa. Desde el sitio nunca modifica a uno existente.
 */
export async function obtenerOCrearAsistente(
    entrada: AsistenteInput,
    modo: ModoResolucion,
    congresista: Congresista | null = null,
): Promise<{ asistente: AsistentePonencia, creado: boolean }> {
    const input = congresista ? conDatosDelCongreso(entrada, congresista) : entrada
    const where = claveDocumento(input)
    const existente = await prisma.asistentePonencia.findUnique({ where })
    if (existente) return { asistente: modo === 'PANEL' ? await completarVacios(existente, input) : existente, creado: false }

    const { nombres, apellidos } = congresista
        ? { nombres: input.nombres as string, apellidos: input.apellidos as string }
        : await nombresPara(input, modo)
    try {
        const asistente = await prisma.asistentePonencia.create({
            data: {
                tipoDocumentoId: input.tipoDocumento,
                numeroDocumento: input.numeroDocumento,
                nombres,
                apellidos,
                correo: input.correo ?? null,
                celular: input.celular ?? null,
                procedencia: (input.procedencia as 'INTERNO' | 'EXTERNO' | undefined) ?? null,
            },
        })
        return { asistente, creado: true }
    } catch (error) {
        // Dos altas a la vez con el mismo documento: se usa la que llegó primero
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const ganador = await prisma.asistentePonencia.findUnique({ where })
            if (ganador) return { asistente: ganador, creado: false }
        }
        throw error
    }
}

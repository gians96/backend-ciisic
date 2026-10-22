import type { ModalidadAsistencia } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, unprocessable } from '../../../core/http-error'
import { correosCoinciden, resolverElegibilidad, type MotivoSinAcceso } from '../../../core/ponencias-especializadas'

/**
 * Quién puede inscribirse a las ponencias especializadas (spec 030). Con el acceso libre del evento
 * encendido entra cualquiera con su documento; apagado, solo un congresista con el pago aprobado, y de
 * su inscripción al congreso sale el modo (presencial ocupa aforo, virtual no).
 */
export interface Congresista {
    participante: { id: number, nombres: string, apellidos: string, correo: string, celular: string }
    inscripcion: { id: number, estado: string, tipo: string | null, categoria: string | null, interno: boolean }
    modo: ModalidadAsistencia
}

export type Acceso = { libre: true } | ({ libre: false } & Congresista)

export interface PersonaAcceso {
    tipoDocumento: string
    numeroDocumento: string
    /** Solo la landing lo envía: con él se comprueba que la persona es la dueña del documento. */
    correo?: string
}

/** Lo que se guarda en la inscripción a la ponencia: con qué inscripción al congreso se validó y su modo. */
export interface Sello {
    inscripcionCongresoId: number | null
    modoAsistencia: ModalidadAsistencia
}

export const selloDe = (acceso: Acceso): Sello =>
    acceso.libre ? { inscripcionCongresoId: null, modoAsistencia: 'PRESENCIAL' } : { inscripcionCongresoId: acceso.inscripcion.id, modoAsistencia: acceso.modo }

/**
 * Con el correo en la petición, un documento desconocido, otro evento o un correo distinto dan el mismo
 * error: no se revela si el documento está inscrito. Sin correo (staff autenticado) se dice sin rodeos.
 */
function errorDeAcceso(motivo: MotivoSinAcceso, conCorreo: boolean) {
    switch (motivo) {
        case 'NO_ENCONTRADA':
            return unprocessable('CONGRESS_REGISTRATION_NOT_FOUND', conCorreo
                ? 'No encontramos una inscripción al congreso con ese documento y correo. Escribe los mismos datos con los que te inscribiste.'
                : 'El documento no está entre los inscritos al congreso.')
        case 'PAGO_PENDIENTE':
            return unprocessable('CONGRESS_PAYMENT_PENDING', 'La inscripción al congreso aún no tiene el pago aprobado. Cuando se valide podrá inscribirse a las ponencias.')
        case 'RECHAZADA':
            return unprocessable('CONGRESS_REGISTRATION_REJECTED', 'La inscripción al congreso fue rechazada o cancelada, por eso no puede inscribirse a las ponencias.')
    }
}

/** Si el evento deja inscribirse a las ponencias solo con el documento. Un evento inexistente no lo permite. */
export async function esAccesoLibre(eventoId: number): Promise<boolean> {
    const evento = await prisma.evento.findUnique({ where: { id: eventoId }, select: { ponenciasAccesoLibre: true } })
    return evento?.ponenciasAccesoLibre === true
}

/** La persona como congresista del evento con el pago aprobado; si no, 422 con el motivo. */
export async function validarCongresista(eventoId: number, persona: PersonaAcceso): Promise<Congresista> {
    const participante = await prisma.participante.findUnique({
        where: { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: persona.tipoDocumento, numeroDocumento: persona.numeroDocumento } },
        select: {
            id: true,
            nombres: true,
            apellidos: true,
            correo: true,
            celular: true,
            inscripciones: {
                where: { eventoId },
                take: 1,
                select: {
                    id: true,
                    esCorreoInstitucional: true,
                    esEstudianteUndc: true,
                    estado: { select: { codigo: true } },
                    tipoInscripcion: { select: { nombre: true, modalidad: true, categoria: { select: { nombre: true } } } },
                },
            },
        },
    })
    const conCorreo = Boolean(persona.correo)
    const inscripcion = participante?.inscripciones[0]
    if (!participante || !inscripcion || (persona.correo && !correosCoinciden(participante.correo, persona.correo))) {
        throw errorDeAcceso('NO_ENCONTRADA', conCorreo)
    }
    const veredicto = resolverElegibilidad({ estado: inscripcion.estado.codigo, modalidadTipo: inscripcion.tipoInscripcion?.modalidad })
    if (!veredicto.ok) throw errorDeAcceso(veredicto.motivo, conCorreo)
    return {
        participante: { id: participante.id, nombres: participante.nombres, apellidos: participante.apellidos, correo: participante.correo, celular: participante.celular },
        inscripcion: {
            id: inscripcion.id,
            estado: inscripcion.estado.codigo,
            tipo: inscripcion.tipoInscripcion?.nombre ?? null,
            categoria: inscripcion.tipoInscripcion?.categoria.nombre ?? null,
            interno: inscripcion.esCorreoInstitucional || inscripcion.esEstudianteUndc,
        },
        modo: veredicto.modo,
    }
}

/**
 * Único punto donde se decide el acceso (landing, alta manual y puerta). `exigirCorreo` es para la
 * landing: sin el acceso libre, el correo es obligatorio porque es lo que prueba que el documento es suyo.
 */
export async function resolverAcceso(eventoId: number, persona: PersonaAcceso, opciones: { exigirCorreo: boolean }): Promise<Acceso> {
    if (await esAccesoLibre(eventoId)) return { libre: true }
    if (opciones.exigirCorreo && !persona.correo) {
        throw unprocessable('VALIDATION_ERROR', 'Ingresa el correo con el que te inscribiste al congreso.', { correo: 'Ingresa el correo con el que te inscribiste al congreso' })
    }
    return { libre: false, ...(await validarCongresista(eventoId, persona)) }
}

/** Para la landing: verifica a la persona antes de elegir ponencias. Con el acceso libre no hay nada que verificar. */
export async function verificarCongresista(eventoId: number, persona: PersonaAcceso & { correo: string }) {
    if (await esAccesoLibre(eventoId)) {
        throw conflict('FREE_ACCESS_ENABLED', 'La inscripción a las ponencias es de acceso libre: no necesita verificar la inscripción al congreso.')
    }
    const congresista = await validarCongresista(eventoId, persona)
    return {
        nombres: congresista.participante.nombres,
        modoAsistencia: congresista.modo,
        tipo: congresista.inscripcion.tipo,
        categoria: congresista.inscripcion.categoria,
    }
}

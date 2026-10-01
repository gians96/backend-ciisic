import { Prisma } from '@prisma/client'
import type { Participante } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { enmascararCorreo } from '../../../core/codigos'
import { consultarDni } from '../../document-lookup/services/lookup'
import { apellidosDe } from '../../document-lookup/services/cache'
import { enDiferido, enviarAvisoCambioCorreo } from '../../inscription/utils/sendEmail'
import type { ActualizarParticipanteInput, CrearParticipanteInput } from '../validation'

export function aParticipante(p: Participante) {
    return {
        id: p.id,
        tipoDocumento: p.tipoDocumentoId,
        numeroDocumento: p.numeroDocumento,
        nombres: p.nombres,
        apellidos: p.apellidos,
        correo: p.correo,
        celular: p.celular,
        googleVinculado: Boolean(p.googleSub),
        googleVinculadoEn: p.googleVinculadoEn,
        creadoEn: p.creadoEn,
        actualizadoEn: p.actualizadoEn,
    }
}

export async function listarParticipantes(q: string | undefined, paginacion: Pagination) {
    const texto = q?.trim()
    const where: Prisma.ParticipanteWhereInput = texto
        ? { OR: [{ numeroDocumento: { contains: texto } }, { nombres: { contains: texto } }, { apellidos: { contains: texto } }, { correo: { contains: texto } }] }
        : {}
    const [total, filas] = await Promise.all([
        prisma.participante.count({ where }),
        prisma.participante.findMany({ where, orderBy: { id: 'desc' }, skip: paginacion.skip, take: paginacion.take }),
    ])
    return { data: filas.map(aParticipante), meta: pageMeta(paginacion, total) }
}

export async function obtenerParticipante(id: number) {
    const p = await prisma.participante.findUnique({
        where: { id },
        include: { inscripciones: { include: { evento: true, estado: true, tipoInscripcion: true }, orderBy: { id: 'desc' } } },
    })
    if (!p) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${id} no encontrado`)
    return {
        ...aParticipante(p),
        inscripciones: p.inscripciones.map((i) => ({
            id: i.id,
            evento: { id: i.evento.id, codigo: i.evento.codigo, nombreCorto: i.evento.nombreCorto },
            estado: { codigo: i.estado.codigo, nombre: i.estado.nombre },
            tipoInscripcion: i.tipoInscripcion?.nombre ?? null,
            creadoEn: i.creadoEn,
        })),
    }
}

// ─── Unicidad ───────────────────────────────────────────────────────────────

const correoEnUso = () => conflict('EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')

/** 409 `PARTICIPANT_EXISTS` con el id del registro existente, para que el panel lo abra. */
function participanteExistente(id: number): HttpError {
    return new HttpError(409, 'PARTICIPANT_EXISTS', 'Ya existe un participante con ese documento.', { id: String(id) })
}

function indiceDuplicado(error: unknown): string | null {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return JSON.stringify(error.meta?.target ?? '')
    return null
}

// ─── Alta desde el panel (spec 014) ─────────────────────────────────────────

/**
 * Nombres oficiales del DNI con la consulta del panel (caché → proveedores). Si la consulta no
 * responde o no encuentra el DNI, se usan los enviados; sin ellos, 422 `NAMES_REQUIRED`.
 */
async function nombresDelAlta(input: CrearParticipanteInput): Promise<{ nombres: string, apellidos: string }> {
    if (input.tipoDocumento === 'dni') {
        try {
            const persona = await consultarDni(input.numeroDocumento, 'PANEL')
            return { nombres: persona.nombres, apellidos: apellidosDe(persona) }
        } catch (error) {
            // 404 y 503 de la consulta son esperables; otro error se registra sin datos personales
            if (!(error instanceof HttpError)) console.error('No se pudo consultar el DNI del alta de participante')
        }
    }
    if (input.nombres && input.apellidos) return { nombres: input.nombres, apellidos: input.apellidos }
    throw unprocessable('NAMES_REQUIRED', 'No se pudieron obtener los nombres del documento. Ingresa los nombres y apellidos.', {
        ...(input.nombres ? {} : { nombres: 'Ingresa los nombres' }),
        ...(input.apellidos ? {} : { apellidos: 'Ingresa los apellidos' }),
    })
}

/**
 * `POST /v1/participants`: registra a una persona sin inscripción (organizadores, ponentes o quien
 * se inscribe en persona). Documento y correo son únicos; la unicidad se comprueba antes de
 * consultar el DNI, para no gastar una consulta. Responde como `GET /v1/participants/:id`.
 */
export async function crearParticipante(input: CrearParticipanteInput) {
    const porDocumentoWhere = { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: input.tipoDocumento, numeroDocumento: input.numeroDocumento } }
    const [porDocumento, porCorreo] = await Promise.all([
        prisma.participante.findUnique({ where: porDocumentoWhere, select: { id: true } }),
        prisma.participante.findUnique({ where: { correo: input.correo }, select: { id: true } }),
    ])
    if (porDocumento) throw participanteExistente(porDocumento.id)
    if (porCorreo) throw correoEnUso()

    const { nombres, apellidos } = await nombresDelAlta(input)
    try {
        const creado = await prisma.participante.create({
            data: {
                tipoDocumentoId: input.tipoDocumento,
                numeroDocumento: input.numeroDocumento,
                nombres: nombres.slice(0, 120),
                apellidos: apellidos.slice(0, 120),
                correo: input.correo,
                // La columna no admite NULL: sin celular queda vacío (la persona lo completa en su portal)
                celular: input.celular ?? '',
            },
        })
        return { ...aParticipante(creado), inscripciones: [] }
    } catch (error) {
        const indice = indiceDuplicado(error)
        // Dos altas a la vez con los mismos datos: se responde como si la otra hubiera llegado antes
        if (indice?.includes('participantes_documento')) {
            const ganador = await prisma.participante.findUnique({ where: porDocumentoWhere, select: { id: true } })
            if (ganador) throw participanteExistente(ganador.id)
        }
        if (indice?.includes('participantes_correo')) throw correoEnUso()
        throw error
    }
}

// ─── Edición por el staff ───────────────────────────────────────────────────

/** Aviso al correo anterior con el evento de la inscripción más reciente (su credencial de correo y contacto). */
async function avisarCambioDeCorreo(participanteId: number, nombres: string, correoAnterior: string, correoNuevo: string): Promise<boolean> {
    const ultima = await prisma.inscripcion.findFirst({
        where: { participanteId },
        orderBy: { id: 'desc' },
        select: { evento: { select: { nombre: true, nombreCorto: true, correoContacto: true, remitenteNombre: true, credencialCorreoId: true, fechaInicio: true } } },
    })
    return enviarAvisoCambioCorreo({ nombres, correoAnterior, correoNuevo: enmascararCorreo(correoNuevo), evento: ultima?.evento ?? null })
}

/**
 * `PUT /v1/participants/:id`. Cambiar el correo deshace el vínculo con Google, cierra las sesiones
 * del portal (`requireParticipante` compara el correo) y avisa en diferido al correo anterior (spec
 * 014). El registro de auditoría lleva solo ids, nunca datos personales.
 */
export async function actualizarParticipante(id: number, input: ActualizarParticipanteInput, actorId: number) {
    const actual = await prisma.participante.findUnique({ where: { id } })
    if (!actual) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${id} no encontrado`)
    const cambiaCorreo = input.correo !== undefined && input.correo.toLowerCase() !== actual.correo.toLowerCase()
    if (input.correo && cambiaCorreo) {
        const otro = await prisma.participante.findUnique({ where: { correo: input.correo } })
        if (otro && otro.id !== id) throw correoEnUso()
    }
    const { desvincularGoogle, ...datos } = input
    const data: Prisma.ParticipanteUpdateInput = {
        ...datos,
        // El vínculo con Google se deshace si cambia el correo o se pide explícitamente
        ...(cambiaCorreo || desvincularGoogle ? { googleSub: null, googleVinculadoEn: null } : {}),
    }
    let actualizado: Participante
    try {
        actualizado = await prisma.participante.update({ where: { id }, data })
    } catch (error) {
        if (indiceDuplicado(error)?.includes('participantes_correo')) throw correoEnUso()
        throw error
    }
    if (cambiaCorreo) {
        console.info(`[participantes] La cuenta ${actorId} cambió el correo del participante ${id}`)
        enDiferido(`el aviso de cambio de correo (participante ${id})`, () => avisarCambioDeCorreo(id, actual.nombres, actual.correo, actualizado.correo))
    }
    return aParticipante(actualizado)
}

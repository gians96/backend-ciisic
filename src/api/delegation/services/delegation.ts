import crypto from 'crypto'
import fs from 'fs'
import { Prisma } from '@prisma/client'
import type { Delegacion, Evento, Participante } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { monto, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { aColumnaFecha, fechaLima, fechaSoloDia } from '../../../core/fechas'
import { conReintentoDeCodigo, nuevoCodigoCredencial } from '../../../core/codigos'
import { uploadedFilePath } from '../../../middlewares/upload'
import { esCorreoInstitucional } from '../../inscription/services/pricing'
import { obtenerEventoPorId, inscripcionesAbiertas } from '../../event/services/public-event'
import type { CrearDelegacionInput, InscribirEnDelegacionInput, ParticipanteDelegacionInput, RegistroDelegacionInput } from '../validation'
import { registroDelegacionSchema } from '../validation'

const redondear = (valor: number) => Math.round(valor * 100) / 100
const ESTADOS_REINSCRIBIBLES: readonly CodigoEstadoInscripcion[] = ['RECHAZADO', 'CANCELADO']

/** Tarifa por persona: la promocional en cuanto la delegación alcanza el mínimo de integrantes. */
export function precioUnitario(precioEstandar: number, precioPromocional: number, minIntegrantes: number, totalIntegrantes: number): number {
    return totalIntegrantes >= minIntegrantes ? precioPromocional : precioEstandar
}

/** Códigos de contrato de los tipos de delegación (spec 022) y su categoría. */
export const CATEGORIA_DELEGACIONES = 'DELEGACIONES'
export const CODIGO_TIPO_GENERAL = 'delegacion_general'
export const CODIGO_TIPO_PROMOCIONAL = 'delegacion_grupal'

/** El tipo de delegación que puede traer una delegación (lo selecciona la landing). */
export interface TipoDelegacionResumido {
    id: number
    codigo: string
    nombre: string
    etiqueta: string | null
}

/** Delegación con su tipo ya cargado (las consultas lo incluyen con `select`). */
export type DelegacionConTipo = Delegacion & { tipoInscripcion?: TipoDelegacionResumido | null }

/**
 * Tipos activos de la categoría `DELEGACIONES` de un evento. Los códigos `delegacion_general`
 * (precio estándar) y `delegacion_grupal` (precio promocional) son contrato (spec 022).
 */
export async function tiposDeDelegacion(eventoId: number) {
    const categoria = await prisma.categoriaInscripcion.findUnique({
        where: { eventoId_codigo: { eventoId, codigo: CATEGORIA_DELEGACIONES } },
        include: { tipos: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
    })
    const tipos = categoria?.tipos ?? []
    return {
        general: tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_GENERAL) ?? null,
        promocional: tipos.find((tipo) => tipo.codigo === CODIGO_TIPO_PROMOCIONAL) ?? null,
    }
}

/**
 * Valida el tipo elegido en la tarjeta: debe ser un tipo activo del evento y de la categoría
 * `DELEGACIONES`; si no, `422 REGISTRATION_TYPE_NOT_AVAILABLE` (como en la inscripción individual).
 */
async function tipoDelegacionValido(eventoId: number, tipoInscripcionId: number | null | undefined): Promise<TipoDelegacionResumido | null> {
    if (tipoInscripcionId === null || tipoInscripcionId === undefined) return null
    const tipo = await prisma.tipoInscripcion.findFirst({
        where: { id: tipoInscripcionId, activo: true, categoria: { eventoId, codigo: CATEGORIA_DELEGACIONES } },
        select: { id: true, codigo: true, nombre: true, etiqueta: true },
    })
    if (!tipo) throw unprocessable('REGISTRATION_TYPE_NOT_AVAILABLE', 'El tipo de delegación no está disponible para este evento.')
    return tipo
}

/** Forma pública de una delegación (el detalle agrega su lista de inscripciones). */
export function aDelegacion(delegacion: DelegacionConTipo, totalIntegrantes: number, montoTotal?: number) {
    const estandar = monto(delegacion.precioEstandar)
    const promocional = monto(delegacion.precioPromocional)
    const unitario = precioUnitario(estandar, promocional, delegacion.minIntegrantes, totalIntegrantes)
    return {
        id: delegacion.id,
        eventoId: delegacion.eventoId,
        nombre: delegacion.nombre,
        codigoLink: delegacion.codigoLink,
        institucion: delegacion.institucion,
        representante: {
            nombre: delegacion.representanteNombre,
            email: delegacion.representanteEmail,
            telefono: delegacion.representanteTelefono,
        },
        minIntegrantes: delegacion.minIntegrantes,
        precioEstandar: estandar,
        precioPromocional: promocional,
        precioUnitario: unitario,
        totalIntegrantes,
        montoTotal: montoTotal ?? redondear(unitario * totalIntegrantes),
        /** Tipo elegido al registrar (spec 022): Delegación General / Promocional. */
        tipoInscripcion: delegacion.tipoInscripcion ?? null,
        activo: delegacion.activo,
        creadoEn: delegacion.creadoEn,
        actualizadoEn: delegacion.actualizadoEn,
    }
}

/** Link público de la delegación: 16 caracteres hexadecimales, sin significado ni datos del grupo. */
async function codigoLinkUnico(): Promise<string> {
    for (let intento = 0; intento < 5; intento++) {
        const codigo = crypto.randomBytes(8).toString('hex')
        const existente = await prisma.delegacion.findUnique({ where: { codigoLink: codigo }, select: { id: true } })
        if (!existente) return codigo
    }
    throw new Error('No se pudo generar un código único para el link de la delegación')
}

export async function crearDelegacion(eventoId: number, input: CrearDelegacionInput) {
    await obtenerEventoPorId(eventoId)
    const delegacion = await prisma.delegacion.create({
        data: {
            eventoId,
            nombre: input.nombre,
            codigoLink: await codigoLinkUnico(),
            institucion: input.institucion ?? null,
            representanteNombre: input.representanteNombre ?? null,
            representanteEmail: input.representanteEmail ?? null,
            representanteTelefono: input.representanteTelefono ?? null,
            minIntegrantes: input.minIntegrantes ?? 10,
            precioEstandar: input.precioEstandar ?? 60,
            precioPromocional: input.precioPromocional ?? 50,
        },
    })
    return aDelegacion(delegacion, 0, 0)
}

export async function listarDelegaciones(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const filas = await prisma.delegacion.findMany({
        where: { eventoId },
        include: {
            _count: { select: { inscripciones: true } },
            tipoInscripcion: { select: { id: true, codigo: true, nombre: true, etiqueta: true } },
        },
        orderBy: { creadoEn: 'desc' },
    })
    return filas.map((delegacion) => aDelegacion(delegacion, delegacion._count.inscripciones))
}

export async function obtenerDelegacion(id: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { id },
        include: {
            tipoInscripcion: { select: { id: true, codigo: true, nombre: true, etiqueta: true } },
            inscripciones: {
                include: { participante: true, estado: true },
                orderBy: { creadoEn: 'asc' },
            },
        },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    const total = delegacion.inscripciones.length
    const montoTotal = redondear(delegacion.inscripciones.reduce((suma, inscripcion) => suma + monto(inscripcion.monto), 0))
    return {
        ...aDelegacion(delegacion, total, montoTotal),
        /** Pago conjunto del grupo: un solo voucher y un solo número de operación. */
        pago: {
            modalidad: delegacion.modalidadPago,
            banco: delegacion.banco,
            billeteraDigital: delegacion.billeteraDigital,
            tipoOperacion: delegacion.tipoOperacion,
            numeroOperacion: delegacion.numeroOperacion,
            fechaPago: delegacion.fechaPago ? fechaSoloDia(delegacion.fechaPago) : null,
            montoTotalPagado: monto(delegacion.montoTotalPagado),
            tieneVoucher: Boolean(delegacion.voucherArchivo),
        },
        inscripciones: delegacion.inscripciones.map((inscripcion) => ({
            id: inscripcion.id,
            participante: {
                id: inscripcion.participante.id,
                tipoDocumento: inscripcion.participante.tipoDocumentoId,
                numeroDocumento: inscripcion.participante.numeroDocumento,
                nombres: inscripcion.participante.nombres,
                apellidos: inscripcion.participante.apellidos,
                correo: inscripcion.participante.correo,
                celular: inscripcion.participante.celular,
            },
            estado: { codigo: inscripcion.estado.codigo, nombre: inscripcion.estado.nombre },
            monto: monto(inscripcion.monto),
            creadoEn: inscripcion.creadoEn,
        })),
    }
}

/**
 * Datos que ve el formulario público del link. No expone el correo ni el teléfono del representante:
 * el link se comparte y solo hace falta el nombre de la delegación y su institución.
 *
 * `eventoId` acota la búsqueda: el link solo sirve dentro del evento del token de acceso.
 */
export async function delegacionPorCodigo(codigoLink: string, eventoId: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { codigoLink },
        include: {
            tipoInscripcion: { select: { id: true, codigo: true, nombre: true, etiqueta: true } },
            evento: {
                select: {
                    id: true, codigo: true, nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true,
                    inscripcionesAbiertas: true, estado: true,
                },
            },
            _count: { select: { inscripciones: true } },
        },
    })
    if (!delegacion || !delegacion.activo) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    if (delegacion.eventoId !== eventoId) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    const estandar = monto(delegacion.precioEstandar)
    const promocional = monto(delegacion.precioPromocional)
    const total = delegacion._count.inscripciones
    return {
        id: delegacion.id,
        nombre: delegacion.nombre,
        codigoLink: delegacion.codigoLink,
        institucion: delegacion.institucion,
        representanteNombre: delegacion.representanteNombre,
        evento: delegacion.evento,
        minIntegrantes: delegacion.minIntegrantes,
        precioEstandar: estandar,
        precioPromocional: promocional,
        precioUnitario: precioUnitario(estandar, promocional, delegacion.minIntegrantes, total),
        totalIntegrantes: total,
        /** Tipo elegido por esa delegación (spec 022): la landing precarga su tarjeta. */
        tipoInscripcion: delegacion.tipoInscripcion ?? null,
    }
}

interface InscripcionExistente {
    id: number
    participanteId: number
    delegacionId: number | null
    estado: CodigoEstadoInscripcion
}

interface FilaPreparada {
    input: ParticipanteDelegacionInput
    participante: Participante | null
    inscripcion: InscripcionExistente | null
    accion: 'crear' | 'reutilizar' | 'omitir'
}

const documento = (participante: Pick<ParticipanteDelegacionInput, 'tipoDocumento' | 'numeroDocumento'>) => `${participante.tipoDocumento}:${participante.numeroDocumento}`

/**
 * Valida la carga completa antes de escribir: documentos y correos repetidos en el mismo envío,
 * correo de otra persona, y participantes que ya tienen una inscripción en el evento. Un participante
 * que ya está en esta delegación se omite (reenviar la lista no duplica), y uno con la inscripción
 * rechazada o cancelada se reutiliza (spec 017).
 *
 * El correo de un participante que ya existe no se cambia: se conserva el registrado, igual que en
 * la inscripción pública. El staff lo cambia desde Participantes (`PUT /v1/participants/:id`).
 */
async function prepararFilas(delegacion: Delegacion, participantes: ParticipanteDelegacionInput[]): Promise<FilaPreparada[]> {
    const vistosDocumento = new Set<string>()
    const vistosCorreo = new Set<string>()
    participantes.forEach((participante, indice) => {
        const claveDocumento = documento(participante)
        if (vistosDocumento.has(claveDocumento)) {
            throw new HttpError(409, 'DUPLICATE_PARTICIPANT', `El documento ${participante.numeroDocumento} está repetido en la carga.`, {
                [`participantes[${indice}].numeroDocumento`]: 'Documento repetido en la carga',
            })
        }
        if (vistosCorreo.has(participante.correo)) {
            throw new HttpError(409, 'DUPLICATE_PARTICIPANT', `El correo ${participante.correo} está repetido en la carga.`, {
                [`participantes[${indice}].correo`]: 'Correo repetido en la carga',
            })
        }
        vistosDocumento.add(claveDocumento)
        vistosCorreo.add(participante.correo)
    })

    const [porDocumento, porCorreo] = await Promise.all([
        prisma.participante.findMany({ where: { OR: participantes.map((p) => ({ tipoDocumentoId: p.tipoDocumento, numeroDocumento: p.numeroDocumento })) } }),
        prisma.participante.findMany({ where: { correo: { in: participantes.map((p) => p.correo) } } }),
    ])
    const participantesPorDocumento = new Map(porDocumento.map((p) => [`${p.tipoDocumentoId}:${p.numeroDocumento}`, p]))
    const participantesPorCorreo = new Map(porCorreo.map((p) => [p.correo, p]))

    const inscripciones = porDocumento.length
        ? await prisma.inscripcion.findMany({
            where: { eventoId: delegacion.eventoId, participanteId: { in: porDocumento.map((p) => p.id) } },
            select: { id: true, participanteId: true, delegacionId: true, estado: { select: { codigo: true } } },
        })
        : []
    const inscripcionesPorParticipante = new Map<number, InscripcionExistente>(inscripciones.map((inscripcion) => [inscripcion.participanteId, {
        id: inscripcion.id,
        participanteId: inscripcion.participanteId,
        delegacionId: inscripcion.delegacionId,
        estado: inscripcion.estado.codigo as CodigoEstadoInscripcion,
    }]))

    return participantes.map((participante, indice) => {
        const existente = participantesPorDocumento.get(documento(participante)) ?? null
        const duenoDelCorreo = participantesPorCorreo.get(participante.correo) ?? null
        if (duenoDelCorreo && duenoDelCorreo.id !== existente?.id) {
            throw new HttpError(409, 'EMAIL_IN_USE', `El correo ${participante.correo} ya está registrado por otra persona.`, {
                [`participantes[${indice}].correo`]: 'Correo de otra persona',
            })
        }

        const inscripcion = existente ? inscripcionesPorParticipante.get(existente.id) ?? null : null
        if (inscripcion && !ESTADOS_REINSCRIBIBLES.includes(inscripcion.estado)) {
            if (inscripcion.delegacionId === delegacion.id) return { input: participante, participante: existente, inscripcion, accion: 'omitir' }
            throw new HttpError(409, 'PARTICIPANT_ALREADY_REGISTERED', `El participante con documento ${participante.numeroDocumento} ya tiene una inscripción en este evento.`, {
                [`participantes[${indice}].numeroDocumento`]: 'Ya inscrito en este evento',
            })
        }
        return { input: participante, participante: existente, inscripcion, accion: inscripcion ? 'reutilizar' : 'crear' }
    })
}

/**
 * `POST /v1/delegations/:id/inscriptions`: alta manual o masiva de integrantes. Calcula la tarifa con
 * el total final de la delegación y la aplica a todas sus inscripciones (también a las anteriores:
 * al cruzar el mínimo, todos pagan la promocional). Todo ocurre en una transacción con la delegación
 * bloqueada, para que dos cargas simultáneas no calculen totales distintos.
 */
export async function inscribirParticipantes(delegacionId: number, input: InscribirEnDelegacionInput) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id: delegacionId }, include: { evento: true } })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    if (!delegacion.activo) throw conflict('DELEGATION_INACTIVE', 'La delegación está inactiva.')

    const filas = await prepararFilas(delegacion, input.participantes)
    const nuevas = filas.filter((fila) => fila.accion === 'crear').length
    const recuperadas = filas.filter((fila) => fila.accion === 'reutilizar' && fila.inscripcion?.delegacionId !== delegacionId).length

    const resultado = await conReintentoDeCodigo(() => prisma.$transaction(async (tx) => {
        // Serializa las cargas de la misma delegación: el total y la tarifa se calculan dentro
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${delegacionId} FOR UPDATE`
        const actual = await tx.delegacion.findUnique({
            where: { id: delegacionId },
            select: { precioEstandar: true, precioPromocional: true, minIntegrantes: true },
        })
        if (!actual) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
        const pendiente = await tx.estadoInscripcion.findUnique({ where: { codigo: 'PENDIENTE' }, select: { id: true } })
        if (!pendiente) throw new Error('Falta el estado PENDIENTE en el catálogo de estados de inscripción')

        const existentes = await tx.inscripcion.count({ where: { delegacionId, eventoId: delegacion.eventoId } })
        const total = existentes + nuevas + recuperadas
        const estandar = monto(actual.precioEstandar)
        const unitario = precioUnitario(estandar, monto(actual.precioPromocional), actual.minIntegrantes, total)
        const descuento = unitario < estandar ? redondear(estandar - unitario) : 0
        const ids: number[] = []

        for (const fila of filas) {
            if (fila.accion === 'omitir') continue
            let participante = fila.participante
            if (participante) {
                participante = await tx.participante.update({
                    where: { id: participante.id },
                    data: {
                        nombres: fila.input.nombres,
                        apellidos: fila.input.apellidos,
                        ...(fila.input.celular ? { celular: fila.input.celular } : {}),
                    },
                })
            } else {
                participante = await tx.participante.create({
                    data: {
                        tipoDocumentoId: fila.input.tipoDocumento,
                        numeroDocumento: fila.input.numeroDocumento,
                        nombres: fila.input.nombres,
                        apellidos: fila.input.apellidos,
                        correo: fila.input.correo,
                        celular: fila.input.celular ?? '',
                    },
                })
            }

            const datos = {
                delegacionId,
                // Las inscripciones del grupo heredan el tipo de la delegación (spec 022)
                tipoInscripcionId: delegacion.tipoInscripcionId,
                monto: unitario,
                descuento,
                tieneDescuento: descuento > 0,
                esCorreoInstitucional: esCorreoInstitucional(participante.correo, delegacion.evento.dominioInstitucional),
                codigoCredencial: nuevoCodigoCredencial(),
                fechaPago: aColumnaFecha(fechaLima()),
                numeroOperacion: `DELEGACION-${crypto.randomUUID()}`,
                modalidadPago: 'delegacion',
                banco: null,
                billeteraDigital: null,
                tipoOperacion: null,
                voucherArchivo: null,
                esEstudianteUndc: false,
                codigoEstudiante: null,
                verificacionEstudiante: Prisma.JsonNull,
                esCorreoVerificado: false,
                verificacionCorreo: Prisma.JsonNull,
            }

            if (fila.inscripcion) {
                const inscripcion = await tx.inscripcion.update({
                    where: { id: fila.inscripcion.id },
                    data: {
                        ...datos,
                        estadoId: pendiente.id,
                        clasificacionId: null,
                        // Es una inscripción nueva: sin la revisión, el voucher ni la credencial anteriores
                        creadoEn: new Date(),
                        motivoRechazo: null,
                        revisadoPorId: null,
                        revisadoEn: null,
                        credencialEnviadaEn: null,
                        esQrLegado: false,
                    },
                    select: { id: true },
                })
                ids.push(inscripcion.id)
            } else {
                const inscripcion = await tx.inscripcion.create({
                    data: {
                        eventoId: delegacion.eventoId,
                        participanteId: participante.id,
                        estadoId: pendiente.id,
                        ...datos,
                    },
                    select: { id: true },
                })
                ids.push(inscripcion.id)
            }
        }

        // Toda la delegación comparte la tarifa vigente, incluidas las inscripciones anteriores
        await tx.inscripcion.updateMany({
            where: { delegacionId, eventoId: delegacion.eventoId },
            data: {
                monto: unitario,
                descuento,
                tieneDescuento: descuento > 0,
                ...(delegacion.tipoInscripcionId ? { tipoInscripcionId: delegacion.tipoInscripcionId } : {}),
            },
        })
        return { ids, total }
    }))

    const detalle = await obtenerDelegacion(delegacionId)
    return {
        ...detalle,
        registrados: resultado.ids.length,
        omitidos: filas.filter((fila) => fila.accion === 'omitir').length,
    }
}

// ─── Registro público (spec 021) ───────────────────────────────────────────

/**
 * Tarifa de las delegaciones de un evento (la copia cada delegación al crearse). Los precios
 * salen de los tipos de la categoría `DELEGACIONES` (spec 022: `delegacion_general` y
 * `delegacion_grupal`); si faltan, de la tarifa por defecto del evento.
 */
export async function tarifaDelegaciones(evento: Evento) {
    const { general, promocional } = await tiposDeDelegacion(evento.id)
    return {
        minIntegrantes: evento.delegacionesMinIntegrantes,
        precioEstandar: monto(general?.precio ?? evento.delegacionesPrecioEstandar),
        precioPromocional: monto(promocional?.precio ?? evento.delegacionesPrecioPromocional),
    }
}

/** El representante como participante, con los mismos datos que la lista de integrantes. */
function representanteComoParticipante(representante: RegistroDelegacionInput['representante']): ParticipanteDelegacionInput {
    return {
        tipoDocumento: representante.tipoDocumento,
        numeroDocumento: representante.numeroDocumento,
        nombres: representante.nombres,
        apellidos: representante.apellidos,
        correo: representante.correo,
        celular: representante.celular,
    }
}

/** Violación del índice único del número de operación de una delegación del mismo evento. */
function errorDeOperacionDuplicada(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '')
        if (target.includes('numero_operacion')) throw conflict('OPERATION_ALREADY_REGISTERED', 'El número de operación ya está registrado.')
    }
    throw error
}

/**
 * `POST /v1/site/delegations`: el representante registra a su grupo completo y paga el total con
 * un solo voucher (spec 021). Crea la delegación con la tarifa del evento, agrega a sus
 * integrantes (el representante va primero si se declaró integrante) y guarda el pago conjunto.
 *
 * El monto lo calcula el servidor con el total final de la delegación: por eso la tarifa
 * promocional (al cruzar el mínimo) se aplica a todos. El pago es de la delegación, no de cada
 * inscripción: el número de operación y el voucher quedan en la delegación.
 *
 * El tipo elegido en la tarjeta (spec 022) se guarda en la delegación y en cada inscripción del
 * grupo; los precios de la tarifa salen de los tipos `delegacion_general` / `delegacion_grupal`.
 */
export async function registrarDelegacion(evento: Evento, input: RegistroDelegacionInput, voucherArchivo: string | null) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    if (!voucherArchivo) throw unprocessable('VOUCHER_REQUIRED', 'Adjunta el voucher de pago.')

    // El tipo de la tarjeta: se valida antes de escribir nada (spec 022)
    const tipoElegido = await tipoDelegacionValido(evento.id, input.tipoInscripcionId)

    // El representante entra primero en la lista si se declaró integrante: el backend no depende
    // de que el cliente lo coloque en ese orden.
    const participantes = input.representante.esIntegrante
        ? [representanteComoParticipante(input.representante), ...input.participantes]
        : input.participantes

    // Con link se registra en la delegación que el staff ya creó (su tarifa y su mínimo); sin
    // link se crea una nueva con la tarifa por defecto del evento.
    const existente = input.codigoLink ? await prisma.delegacion.findUnique({ where: { codigoLink: input.codigoLink.trim() } }) : null
    if (input.codigoLink && (!existente || !existente.activo)) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    if (existente && existente.eventoId !== evento.id) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')

    const tarifa = existente
        ? {
            minIntegrantes: existente.minIntegrantes,
            precioEstandar: monto(existente.precioEstandar),
            precioPromocional: monto(existente.precioPromocional),
        }
        : await tarifaDelegaciones(evento)

    let delegacion: Delegacion
    try {
        delegacion = existente ?? await prisma.delegacion.create({
            data: {
                eventoId: evento.id,
                nombre: input.delegacion.nombre,
                codigoLink: await codigoLinkUnico(),
                institucion: input.delegacion.institucion ?? null,
                representanteNombre: `${input.representante.nombres} ${input.representante.apellidos}`.trim(),
                representanteEmail: input.representante.correo,
                representanteTelefono: input.representante.celular,
                minIntegrantes: tarifa.minIntegrantes,
                precioEstandar: tarifa.precioEstandar,
                precioPromocional: tarifa.precioPromocional,
                tipoInscripcionId: tipoElegido?.id ?? null,
            },
        })
    } catch (error) {
        // Dos delegaciones del mismo evento no pueden compartir el código del voucher
        throw errorDeOperacionDuplicada(error)
    }

    // El tipo de cada inscripción del grupo: el elegido en esta carga, o el que ya traía la
    // delegación (registro por link sin elegir de nuevo).
    const tipoGrupo = tipoElegido?.id ?? delegacion.tipoInscripcionId ?? null

    try {
        // Mismas reglas que el alta desde el panel: quien ya está en esta delegación se omite
        // (reenviar la lista no duplica), quien la tiene rechazada o cancelada la reutiliza, y
        // quien ya está inscrito en el evento por fuera se rechaza.
        const filas = await prepararFilas(delegacion, participantes)
        const nuevas = filas.filter((fila) => fila.accion === 'crear').length
        const recuperadas = filas.filter((fila) => fila.accion === 'reutilizar' && fila.inscripcion?.delegacionId !== delegacion.id).length

        // La tarifa se calcula sobre el total de la delegación: los que ya estaban más los de
        // este envío. Por eso la promocional (al cruzar el mínimo) se aplica a todos.
        const yaRegistrados = await prisma.inscripcion.count({ where: { delegacionId: delegacion.id, eventoId: evento.id } })
        const totalIntegrantes = yaRegistrados + nuevas + recuperadas
        const unitario = precioUnitario(tarifa.precioEstandar, tarifa.precioPromocional, tarifa.minIntegrantes, totalIntegrantes)
        const descuento = unitario < tarifa.precioEstandar ? redondear(tarifa.precioEstandar - unitario) : 0
        const total = redondear(unitario * totalIntegrantes)

        const ids = await conReintentoDeCodigo(() => prisma.$transaction(async (tx) => {
            const pendiente = await tx.estadoInscripcion.findUnique({ where: { codigo: 'PENDIENTE' }, select: { id: true } })
            if (!pendiente) throw new Error('Falta el estado PENDIENTE en el catálogo de estados de inscripción')

            const creados: number[] = []
            for (const fila of filas) {
                if (fila.accion === 'omitir') continue
                let persona = fila.participante
                if (persona) {
                    persona = await tx.participante.update({
                        where: { id: persona.id },
                        data: {
                            nombres: fila.input.nombres,
                            apellidos: fila.input.apellidos,
                            ...(fila.input.celular ? { celular: fila.input.celular } : {}),
                        },
                    })
                } else {
                    persona = await tx.participante.create({
                        data: {
                            tipoDocumentoId: fila.input.tipoDocumento,
                            numeroDocumento: fila.input.numeroDocumento,
                            nombres: fila.input.nombres,
                            apellidos: fila.input.apellidos,
                            correo: fila.input.correo,
                            celular: fila.input.celular ?? '',
                        },
                    })
                }

                const datos = {
                    delegacionId: delegacion.id,
                    // El tipo elegido en la tarjeta queda en cada inscripción del grupo (spec 022)
                    tipoInscripcionId: tipoGrupo,
                    monto: unitario,
                    descuento,
                    tieneDescuento: descuento > 0,
                    esCorreoInstitucional: esCorreoInstitucional(persona.correo, evento.dominioInstitucional),
                    codigoCredencial: nuevoCodigoCredencial(),
                    fechaPago: aColumnaFecha(input.fechaPago),
                    // El pago es de la delegación: aquí va un código interno, no el del voucher.
                    numeroOperacion: `DELEGACION-${crypto.randomUUID()}`,
                    modalidadPago: 'delegacion',
                    banco: null,
                    billeteraDigital: null,
                    tipoOperacion: null,
                    voucherArchivo: null,
                    esEstudianteUndc: false,
                    codigoEstudiante: null,
                    verificacionEstudiante: Prisma.JsonNull,
                    esCorreoVerificado: false,
                    verificacionCorreo: Prisma.JsonNull,
                }

                if (fila.inscripcion) {
                    // Es una inscripción nueva: sin la revisión, el voucher ni la credencial anteriores
                    await tx.inscripcion.update({
                        where: { id: fila.inscripcion.id },
                        data: {
                            ...datos,
                            eventoId: evento.id,
                            estadoId: pendiente.id,
                            clasificacionId: null,
                            creadoEn: new Date(),
                            motivoRechazo: null,
                            revisadoPorId: null,
                            revisadoEn: null,
                            credencialEnviadaEn: null,
                            esQrLegado: false,
                        },
                        select: { id: true },
                    })
                    creados.push(fila.inscripcion.id)
                } else {
                    const inscripcion = await tx.inscripcion.create({
                        data: { eventoId: evento.id, participanteId: persona.id, estadoId: pendiente.id, ...datos },
                        select: { id: true },
                    })
                    creados.push(inscripcion.id)
                }
            }
            // Toda la delegación comparte la tarifa vigente y el tipo elegido, incluidas las
            // inscripciones anteriores (así el grupo entero queda con el mismo tipo)
            await tx.inscripcion.updateMany({
                where: { delegacionId: delegacion.id, eventoId: evento.id },
                data: {
                    monto: unitario,
                    descuento,
                    tieneDescuento: descuento > 0,
                    ...(tipoGrupo !== null ? { tipoInscripcionId: tipoGrupo } : {}),
                },
            })
            await tx.delegacion.update({ where: { id: delegacion.id }, data: { montoTotalPagado: total } })
            return creados
        }))

        // El pago conjunto y el contacto quedan en la delegación (la que el staff creó si vino
        // por su link): un solo número de operación y un solo voucher para todo el grupo.
        await prisma.delegacion.update({
            where: { id: delegacion.id },
            data: {
                representanteNombre: `${input.representante.nombres} ${input.representante.apellidos}`.trim(),
                representanteEmail: input.representante.correo,
                representanteTelefono: input.representante.celular,
                // La tarjeta elegida también se guarda en la delegación del link (spec 022)
                ...(tipoElegido ? { tipoInscripcionId: tipoElegido.id } : {}),
                modalidadPago: input.modalidadPago,
                banco: input.modalidadPago === 'banco' ? input.banco ?? null : null,
                tipoOperacion: input.modalidadPago === 'banco' ? input.tipoOperacion ?? null : null,
                billeteraDigital: input.modalidadPago === 'billetera' ? input.billeteraDigital ?? null : null,
                numeroOperacion: input.numeroOperacion.trim(),
                fechaPago: aColumnaFecha(input.fechaPago),
                voucherArchivo,
            },
        })

        const detalle = await obtenerDelegacion(delegacion.id)
        return {
            ...detalle,
            registrados: ids.length,
            omitidos: filas.filter((fila) => fila.accion === 'omitir').length,
            montoTotal: total,
            tarifaUnitaria: unitario,
        }
    } catch (error) {
        // La delegación quedó creada sin inscripciones: se borra para no dejar un grupo a medias.
        if (!existente) await prisma.delegacion.delete({ where: { id: delegacion.id } }).catch(() => undefined)
        throw errorDeOperacionDuplicada(error)
    }
}

/** Voucher del pago conjunto de una delegación. */
export async function archivoVoucherDelegacion(id: number): Promise<string> {
    const delegacion = await prisma.delegacion.findUnique({ where: { id }, select: { voucherArchivo: true } })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    if (!delegacion.voucherArchivo) throw notFound('VOUCHER_NOT_FOUND', 'La delegación no tiene voucher.')
    const ruta = uploadedFilePath(delegacion.voucherArchivo)
    if (!fs.existsSync(ruta)) throw notFound('VOUCHER_NOT_FOUND', 'El archivo del voucher no existe en el servidor.')
    return ruta
}

/** Valida el cuerpo del registro público (multipart): los campos JSON se parsean en el controlador. */
export async function validarRegistroDelegacion(body: unknown): Promise<RegistroDelegacionInput> {
    return registroDelegacionSchema.validate(body, { abortEarly: false, stripUnknown: true })
}

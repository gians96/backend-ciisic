import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import type { Delegacion, Evento, Participante } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { monto, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { conReintentoDeCodigo, nuevoCodigoCredencial } from '../../../core/codigos'
import { esCorreoInstitucional } from '../../inscription/services/pricing'
import { aprobarVarias } from '../../inscription/services/inscription'
import { obtenerEventoPorId, inscripcionesAbiertas } from '../../event/services/public-event'
import type {
    CrearDelegacionInput, EditarDelegacionInput, InscribirEnDelegacionInput, ParticipanteDelegacionInput, RegistroDelegacionInput,
} from '../validation'
import { registroDelegacionSchema } from '../validation'
import {
    aPago, aPagoPublico, errorDeOperacionDuplicada, exigirOperacionesLibres, insertarPagos, numeroOperacionInterno, resumenPagos,
} from './pagos'
import {
    faltanParaPromocional, precioUnitario, redondear, tarifaParaModalidad, tipoParaGrupo, tiposDeDelegacion,
    type TarifaCopiada, type TiposDeDelegacion,
} from './tarifa'

export { precioUnitario, tiposDeDelegacion } from './tarifa'
export { CATEGORIA_DELEGACIONES, CODIGO_TIPO_GENERAL, CODIGO_TIPO_PROMOCIONAL, CODIGO_TIPO_VIRTUAL } from './tarifa'

const ESTADOS_REINSCRIBIBLES: readonly CodigoEstadoInscripcion[] = ['RECHAZADO', 'CANCELADO']
/** Estados que no cuentan como integrante: el cupo y la tarifa se calculan con el resto. */
const ESTADOS_SIN_CUPO: CodigoEstadoInscripcion[] = ['RECHAZADO', 'CANCELADO']
/** Estados de un integrante que el staff puede quitar del grupo (ya aprobado tiene credencial y asistencia). */
const ESTADOS_QUITABLES: readonly CodigoEstadoInscripcion[] = ['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'CANCELADO']
const CUENTAN_COMO_INTEGRANTE = { estado: { codigo: { notIn: ESTADOS_SIN_CUPO } } } as const

/** El tipo que lleva una delegación (lo recalcula el servidor con la modalidad y el tamaño del grupo). */
export interface TipoDelegacionResumido {
    id: number
    codigo: string
    nombre: string
    etiqueta: string | null
    modalidad?: string
}

const TIPO_RESUMIDO = { select: { id: true, codigo: true, nombre: true, etiqueta: true, modalidad: true } } as const

/** Delegación con su tipo ya cargado (las consultas lo incluyen con `select`). */
export type DelegacionConTipo = Delegacion & { tipoInscripcion?: TipoDelegacionResumido | null }

// ─── Forma pública y del panel ──────────────────────────────────────────────

/** Forma de una delegación (el detalle agrega integrantes y pagos). `total` cuenta solo integrantes activos. */
export function aDelegacion(delegacion: DelegacionConTipo, totalIntegrantes: number, pagos: ReadonlyArray<{ monto: Prisma.Decimal | number, estado: string }> = []) {
    const estandar = monto(delegacion.precioEstandar)
    const promocional = monto(delegacion.precioPromocional)
    const unitario = precioUnitario(estandar, promocional, delegacion.minIntegrantes, totalIntegrantes)
    const montoTotal = redondear(unitario * totalIntegrantes)
    return {
        id: delegacion.id,
        eventoId: delegacion.eventoId,
        nombre: delegacion.nombre,
        codigoLink: delegacion.codigoLink,
        institucion: delegacion.institucion,
        modalidad: delegacion.modalidad,
        representante: {
            nombre: delegacion.representanteNombre,
            email: delegacion.representanteEmail,
            telefono: delegacion.representanteTelefono,
            tipoDocumento: delegacion.representanteTipoDocumento,
            documento: delegacion.representanteDocumento,
        },
        minIntegrantes: delegacion.minIntegrantes,
        precioEstandar: estandar,
        precioPromocional: promocional,
        precioUnitario: unitario,
        totalIntegrantes,
        montoTotal,
        /** Cuántos faltan para la tarifa promocional (`null` si ya aplica o es virtual, que no tiene escala). */
        faltanParaPromocional: faltanParaPromocional(estandar, promocional, delegacion.minIntegrantes, totalIntegrantes),
        /** Tipo vigente del grupo: Delegación General, Promocional o Virtual. */
        tipoInscripcion: delegacion.tipoInscripcion ?? null,
        pago: resumenPagos(montoTotal, pagos),
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

type RepresentanteInput = CrearDelegacionInput['representante']

/** Datos de contacto del delegado tal como se guardan en la delegación. */
function datosDelRepresentante(representante: Pick<RepresentanteInput, 'nombres' | 'apellidos' | 'tipoDocumento' | 'numeroDocumento' | 'correo' | 'celular'>) {
    return {
        representanteNombre: `${representante.nombres} ${representante.apellidos}`.trim(),
        representanteEmail: representante.correo,
        representanteTelefono: representante.celular,
        representanteTipoDocumento: representante.tipoDocumento,
        representanteDocumento: representante.numeroDocumento,
    }
}

/** El delegado como integrante: mismos datos que la lista de participantes. */
function representanteComoParticipante(representante: RepresentanteInput): ParticipanteDelegacionInput {
    return {
        tipoDocumento: representante.tipoDocumento,
        numeroDocumento: representante.numeroDocumento,
        nombres: representante.nombres,
        apellidos: representante.apellidos,
        correo: representante.correo,
        celular: representante.celular,
    }
}

/** La tarifa de la modalidad o `422` si el evento no la ofrece (p. ej. virtual sin su tipo). */
async function tarifaDe(evento: Evento, modalidad: 'PRESENCIAL' | 'VIRTUAL'): Promise<TarifaCopiada> {
    const tarifa = tarifaParaModalidad(evento, await tiposDeDelegacion(evento.id), modalidad)
    if (!tarifa) throw unprocessable('DELEGATION_MODALITY_NOT_AVAILABLE', 'La modalidad virtual no está disponible para este evento.')
    return tarifa
}

/** Identificador y evento de una delegación (para sumarle vouchers desde el panel). */
export async function delegacionBasica(id: number) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id }, select: { id: true, eventoId: true } })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    return delegacion
}

// ─── Staff: alta, listado, detalle y edición ────────────────────────────────

/**
 * Alta de una delegación por el staff (spec 023): el delegado, la modalidad y, si ya los tiene, sus
 * integrantes. Sin cifras en el cuerpo, la tarifa sale de los tipos del evento.
 */
export async function crearDelegacion(eventoId: number, input: CrearDelegacionInput) {
    const evento = await obtenerEventoPorId(eventoId)
    const tarifa = await tarifaDe(evento, input.modalidad as 'PRESENCIAL' | 'VIRTUAL')
    const nueva = await prisma.delegacion.create({
        data: {
            eventoId,
            nombre: input.nombre,
            codigoLink: await codigoLinkUnico(),
            institucion: input.institucion ?? null,
            modalidad: input.modalidad as 'PRESENCIAL' | 'VIRTUAL',
            ...datosDelRepresentante(input.representante),
            minIntegrantes: input.minIntegrantes ?? tarifa.minIntegrantes,
            precioEstandar: input.precioEstandar ?? tarifa.precioEstandar,
            precioPromocional: input.precioPromocional ?? tarifa.precioPromocional,
        },
    })
    const integrantes = [
        ...(input.representante.esIntegrante ? [representanteComoParticipante(input.representante)] : []),
        ...(input.participantes ?? []),
    ]
    if (!integrantes.length) return obtenerDelegacion(nueva.id)
    try {
        return await inscribirParticipantes(nueva.id, { participantes: integrantes })
    } catch (error) {
        // Sin integrantes la delegación quedaría vacía por un dato mal escrito: se borra para repetir el alta
        await prisma.delegacion.delete({ where: { id: nueva.id } }).catch(() => undefined)
        throw error
    }
}

export async function listarDelegaciones(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const filas = await prisma.delegacion.findMany({
        where: { eventoId },
        include: {
            tipoInscripcion: TIPO_RESUMIDO,
            pagos: { select: { monto: true, estado: true } },
            _count: { select: { inscripciones: { where: CUENTAN_COMO_INTEGRANTE } } },
        },
        orderBy: { creadoEn: 'desc' },
    })
    return filas.map((delegacion) => aDelegacion(delegacion, delegacion._count.inscripciones, delegacion.pagos))
}

export async function obtenerDelegacion(id: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { id },
        include: {
            tipoInscripcion: TIPO_RESUMIDO,
            pagos: { orderBy: { id: 'asc' } },
            inscripciones: {
                include: { participante: true, estado: true },
                orderBy: { creadoEn: 'asc' },
            },
        },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    const total = delegacion.inscripciones.filter((inscripcion) => !ESTADOS_SIN_CUPO.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion)).length
    return {
        ...aDelegacion(delegacion, total, delegacion.pagos),
        pagos: delegacion.pagos.map(aPago),
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

/** Edita los datos de la delegación. La modalidad solo cambia mientras el grupo no tenga integrantes. */
export async function actualizarDelegacion(id: number, input: EditarDelegacionInput) {
    const actual = await prisma.delegacion.findUnique({ where: { id }, include: { evento: true } })
    if (!actual) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)

    const cambiaModalidad = input.modalidad !== undefined && input.modalidad !== actual.modalidad
    let tarifa: TarifaCopiada | null = null
    if (cambiaModalidad) {
        const integrantes = await prisma.inscripcion.count({ where: { delegacionId: id, ...CUENTAN_COMO_INTEGRANTE } })
        if (integrantes > 0) throw conflict('DELEGATION_MODALITY_LOCKED', 'La modalidad no se puede cambiar cuando el grupo ya tiene integrantes.')
        tarifa = await tarifaDe(actual.evento, input.modalidad as 'PRESENCIAL' | 'VIRTUAL')
    }

    await prisma.delegacion.update({
        where: { id },
        data: {
            ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
            ...(input.institucion !== undefined ? { institucion: input.institucion ?? null } : {}),
            ...(input.activo !== undefined ? { activo: input.activo } : {}),
            ...(input.representante ? datosDelRepresentante(input.representante) : {}),
            ...(tarifa ? { modalidad: input.modalidad as 'PRESENCIAL' | 'VIRTUAL', ...tarifa } : {}),
            ...(input.minIntegrantes !== undefined ? { minIntegrantes: input.minIntegrantes } : {}),
            ...(input.precioEstandar !== undefined ? { precioEstandar: input.precioEstandar } : {}),
            ...(input.precioPromocional !== undefined ? { precioPromocional: input.precioPromocional } : {}),
        },
    })
    // Un cambio de tarifa o de mínimo reprecia a todo el grupo
    if (input.minIntegrantes !== undefined || input.precioEstandar !== undefined || input.precioPromocional !== undefined) {
        await prisma.$transaction((tx) => recalcularGrupo(tx, id))
    }
    return obtenerDelegacion(id)
}

// ─── Integrantes ────────────────────────────────────────────────────────────

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
async function prepararFilas(delegacion: Pick<Delegacion, 'id' | 'eventoId'>, participantes: ParticipanteDelegacionInput[]): Promise<FilaPreparada[]> {
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
 * Recalcula el grupo: con los integrantes activos, la tarifa por persona y el tipo vigente se
 * aplican a **todos** (al cruzar el mínimo, todos pasan a la promocional). Debe correr dentro de una
 * transacción con la delegación bloqueada.
 */
async function recalcularGrupo(tx: Prisma.TransactionClient, delegacionId: number, tipos?: TiposDeDelegacion) {
    const delegacion = await tx.delegacion.findUnique({
        where: { id: delegacionId },
        select: { id: true, eventoId: true, modalidad: true, minIntegrantes: true, precioEstandar: true, precioPromocional: true },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    const total = await tx.inscripcion.count({ where: { delegacionId, eventoId: delegacion.eventoId, ...CUENTAN_COMO_INTEGRANTE } })
    const estandar = monto(delegacion.precioEstandar)
    const unitario = precioUnitario(estandar, monto(delegacion.precioPromocional), delegacion.minIntegrantes, total)
    const descuento = unitario < estandar ? redondear(estandar - unitario) : 0
    const tipo = tipoParaGrupo(tipos ?? await tiposDeDelegacion(delegacion.eventoId, tx), delegacion, total)
    await tx.inscripcion.updateMany({
        where: { delegacionId, eventoId: delegacion.eventoId, ...CUENTAN_COMO_INTEGRANTE },
        data: { monto: unitario, descuento, tieneDescuento: descuento > 0, ...(tipo ? { tipoInscripcionId: tipo.id } : {}) },
    })
    await tx.delegacion.update({ where: { id: delegacionId }, data: { tipoInscripcionId: tipo?.id ?? null } })
    return { total, unitario, descuento, tipo }
}

/**
 * Suma integrantes a una delegación (staff, link o registro público). Calcula la tarifa y el tipo con
 * el total final y los aplica a todo el grupo. Todo ocurre en una transacción con la delegación
 * bloqueada, para que dos cargas simultáneas no calculen totales distintos. `adicional` corre en la
 * misma transacción (el registro público guarda aquí sus vouchers).
 */
async function agregarIntegrantes(
    delegacionId: number,
    participantes: ParticipanteDelegacionInput[],
    adicional?: (tx: Prisma.TransactionClient, delegacion: Delegacion & { evento: Evento }) => Promise<void>,
) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id: delegacionId }, include: { evento: true } })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    if (!delegacion.activo) throw conflict('DELEGATION_INACTIVE', 'La delegación está inactiva.')

    const filas = await prepararFilas(delegacion, participantes)

    const resultado = await conReintentoDeCodigo(() => prisma.$transaction(async (tx) => {
        // Serializa las cargas de la misma delegación: el total y la tarifa se calculan dentro
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${delegacionId} FOR UPDATE`
        const pendiente = await tx.estadoInscripcion.findUnique({ where: { codigo: 'PENDIENTE' }, select: { id: true } })
        if (!pendiente) throw new Error('Falta el estado PENDIENTE en el catálogo de estados de inscripción')

        const ids: number[] = []
        const hoy = aColumnaFecha(fechaLima())
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

            // Monto, descuento y tipo definitivos los fija `recalcularGrupo` con el total final
            const datos = {
                delegacionId,
                monto: 0,
                descuento: 0,
                tieneDescuento: false,
                esCorreoInstitucional: esCorreoInstitucional(persona.correo, delegacion.evento.dominioInstitucional),
                codigoCredencial: nuevoCodigoCredencial(),
                fechaPago: hoy,
                // El pago es de la delegación: aquí va un código interno, no el de un voucher.
                numeroOperacion: numeroOperacionInterno(),
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
                const inscripcion = await tx.inscripcion.update({
                    where: { id: fila.inscripcion.id },
                    data: {
                        ...datos,
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
                ids.push(inscripcion.id)
            } else {
                const inscripcion = await tx.inscripcion.create({
                    data: { eventoId: delegacion.eventoId, participanteId: persona.id, estadoId: pendiente.id, ...datos },
                    select: { id: true },
                })
                ids.push(inscripcion.id)
            }
        }

        const grupo = await recalcularGrupo(tx, delegacionId)
        if (adicional) await adicional(tx, delegacion)
        return { ids, ...grupo }
    }))

    return { ...resultado, omitidos: filas.filter((fila) => fila.accion === 'omitir').length }
}

/** `POST /v1/delegations/:id/inscriptions`: alta manual o masiva de integrantes desde el panel. */
export async function inscribirParticipantes(delegacionId: number, input: InscribirEnDelegacionInput) {
    const resultado = await agregarIntegrantes(delegacionId, input.participantes)
    return {
        ...(await obtenerDelegacion(delegacionId)),
        registrados: resultado.ids.length,
        omitidos: resultado.omitidos,
    }
}

/**
 * Quita un integrante del grupo (staff). Solo si aún no fue aprobado: uno aprobado ya tiene
 * credencial y asistencia, y se cancela desde Inscripciones. Al quitarlo, el grupo se recalcula.
 */
export async function quitarIntegrante(delegacionId: number, inscripcionId: number) {
    const inscripcion = await prisma.inscripcion.findFirst({
        where: { id: inscripcionId, delegacionId },
        select: { id: true, estado: { select: { codigo: true } } },
    })
    if (!inscripcion) throw notFound('INSCRIPTION_NOT_FOUND', `La inscripción ${inscripcionId} no pertenece a la delegación ${delegacionId}`)
    if (!ESTADOS_QUITABLES.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion)) {
        throw conflict('INSCRIPTION_NOT_REMOVABLE', 'El integrante ya está aprobado: cancélalo desde Inscripciones.')
    }
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${delegacionId} FOR UPDATE`
        await tx.inscripcion.delete({ where: { id: inscripcionId } })
        await recalcularGrupo(tx, delegacionId)
    })
    return obtenerDelegacion(delegacionId)
}

/**
 * Aprueba a todo el grupo (staff): los integrantes por revisar pasan a APROBADO en el acto y las
 * credenciales se generan y envían después, una por una (los PDF son pesados). Devuelve cuántos
 * aprobó y el saldo que aún se debe, para que el panel lo avise.
 */
export async function aprobarDelegacion(delegacionId: number, adminId?: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { id: delegacionId },
        select: { id: true, inscripciones: { select: { id: true, estado: { select: { codigo: true } } } } },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    const porRevisar = delegacion.inscripciones.filter((inscripcion) => ['PENDIENTE', 'EN_REVISION'].includes(inscripcion.estado.codigo)).map((inscripcion) => inscripcion.id)
    if (!porRevisar.length) throw conflict('NOTHING_TO_APPROVE', 'No hay integrantes por aprobar.')
    const aprobadas = await aprobarVarias(porRevisar, adminId)
    const detalle = await obtenerDelegacion(delegacionId)
    return { ...detalle, aprobadas: aprobadas.length, credencialesEnSegundoPlano: aprobadas.length }
}

// ─── API del sitio ──────────────────────────────────────────────────────────

/**
 * Tarifa de las delegaciones de un evento por modalidad: los precios salen de los tipos
 * (`delegacion_general`, `delegacion_grupal`, `delegacion_virtual`). La virtual es `null` mientras
 * el evento no tenga su tipo: la landing no la ofrece.
 */
export async function tarifaDelegaciones(evento: Evento) {
    const tipos = await tiposDeDelegacion(evento.id)
    const presencial = tarifaParaModalidad(evento, tipos, 'PRESENCIAL')
    const virtual = tarifaParaModalidad(evento, tipos, 'VIRTUAL')
    return {
        minIntegrantes: evento.delegacionesMinIntegrantes,
        precioEstandar: presencial?.precioEstandar ?? 0,
        precioPromocional: presencial?.precioPromocional ?? 0,
        virtual: virtual ? { precio: virtual.precioEstandar } : null,
    }
}

/** DNI visible solo en sus últimos dígitos: el link se comparte entre los integrantes del grupo. */
function enmascararDocumento(numero: string): string {
    return numero.length <= 4 ? '****' : `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`
}

/**
 * Lo que ve el delegado con el link: el grupo, su tarifa, los integrantes (documento enmascarado) y
 * sus vouchers (número enmascarado, sin el motivo interno). No expone el correo ni el teléfono del
 * delegado. `eventoId` acota la búsqueda: el link solo sirve dentro del evento del token de acceso.
 */
export async function delegacionPorCodigo(codigoLink: string, eventoId: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { codigoLink },
        include: {
            tipoInscripcion: TIPO_RESUMIDO,
            evento: {
                select: {
                    id: true, codigo: true, nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true,
                    inscripcionesAbiertas: true, estado: true,
                },
            },
            pagos: { orderBy: { id: 'asc' } },
            inscripciones: { include: { participante: true, estado: true }, orderBy: { creadoEn: 'asc' } },
        },
    })
    if (!delegacion || !delegacion.activo || delegacion.eventoId !== eventoId) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    const activos = delegacion.inscripciones.filter((inscripcion) => !ESTADOS_SIN_CUPO.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion))
    const estandar = monto(delegacion.precioEstandar)
    const promocional = monto(delegacion.precioPromocional)
    const unitario = precioUnitario(estandar, promocional, delegacion.minIntegrantes, activos.length)
    const montoTotal = redondear(unitario * activos.length)
    return {
        id: delegacion.id,
        nombre: delegacion.nombre,
        codigoLink: delegacion.codigoLink,
        institucion: delegacion.institucion,
        modalidad: delegacion.modalidad,
        representanteNombre: delegacion.representanteNombre,
        evento: delegacion.evento,
        minIntegrantes: delegacion.minIntegrantes,
        precioEstandar: estandar,
        precioPromocional: promocional,
        precioUnitario: unitario,
        totalIntegrantes: activos.length,
        montoTotal,
        faltanParaPromocional: faltanParaPromocional(estandar, promocional, delegacion.minIntegrantes, activos.length),
        tipoInscripcion: delegacion.tipoInscripcion ?? null,
        pago: resumenPagos(montoTotal, delegacion.pagos),
        integrantes: activos.map((inscripcion) => ({
            nombres: inscripcion.participante.nombres,
            apellidos: inscripcion.participante.apellidos,
            documento: enmascararDocumento(inscripcion.participante.numeroDocumento),
            estado: inscripcion.estado.codigo,
        })),
        pagos: delegacion.pagos.map(aPagoPublico),
    }
}

/** La delegación de un link dentro del evento del token, activa; `404` si no. */
async function delegacionDelLink(evento: Evento, codigoLink: string) {
    const delegacion = await prisma.delegacion.findUnique({ where: { codigoLink: codigoLink.trim() } })
    if (!delegacion || !delegacion.activo || delegacion.eventoId !== evento.id) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    return delegacion
}

/**
 * `POST /v1/site/delegations`: el delegado registra a su grupo y paga con uno o varios vouchers.
 * Crea la delegación con la tarifa de su modalidad (o, con `codigoLink`, se suma a la que el staff ya
 * creó), agrega a los integrantes (el delegado va primero si se declaró integrante) y guarda los
 * vouchers, **todo en una sola transacción**: si algo falla no queda nada a medias.
 *
 * El monto lo calcula el servidor con el total final: por eso la promocional (al cruzar el mínimo) se
 * aplica a todos. Cada voucher lleva su archivo, su número de operación y el monto que dice.
 */
export async function registrarDelegacion(evento: Evento, input: RegistroDelegacionInput, archivos: string[]) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    if (archivos.length !== input.pagos.length) throw unprocessable('VOUCHER_REQUIRED', 'Adjunta el voucher de cada pago.')

    const existente = input.codigoLink ? await delegacionDelLink(evento, input.codigoLink) : null

    // El delegado va primero si es integrante: el servidor no depende del orden del cliente
    const integrantes = [...(input.representante.esIntegrante ? [representanteComoParticipante(input.representante)] : []), ...(input.participantes ?? [])]
    if (!integrantes.length) throw unprocessable('NO_PARTICIPANTS', 'Registra al menos un integrante.')

    const modalidad = existente?.modalidad ?? (input.modalidad as 'PRESENCIAL' | 'VIRTUAL')
    const tarifa = existente
        ? { minIntegrantes: existente.minIntegrantes, precioEstandar: monto(existente.precioEstandar), precioPromocional: monto(existente.precioPromocional) }
        : await tarifaDe(evento, modalidad)

    // Antes de escribir: un número de operación repetido se informa sin dejar rastro
    await exigirOperacionesLibres(evento.id, input.pagos)

    const delegacion = existente ?? await prisma.delegacion.create({
        data: {
            eventoId: evento.id,
            nombre: input.delegacion.nombre,
            codigoLink: await codigoLinkUnico(),
            institucion: input.delegacion.institucion ?? null,
            modalidad,
            ...datosDelRepresentante(input.representante),
            ...tarifa,
        },
    })

    try {
        const resultado = await agregarIntegrantes(delegacion.id, integrantes, async (tx, actual) => {
            await insertarPagos(tx, actual, input.pagos, archivos)
        })
        return {
            ...(await delegacionPorCodigo(delegacion.codigoLink, evento.id)),
            registrados: resultado.ids.length,
            omitidos: resultado.omitidos,
        }
    } catch (error) {
        // La delegación quedó creada sin integrantes ni pagos (la transacción se revirtió): se borra
        if (!existente) await prisma.delegacion.delete({ where: { id: delegacion.id } }).catch(() => undefined)
        throw errorDeOperacionDuplicada(error)
    }
}

/** `POST /v1/site/delegations/link/:codigoLink/participants`: el delegado suma integrantes. */
export async function inscribirPorLink(evento: Evento, codigoLink: string, input: InscribirEnDelegacionInput) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    const delegacion = await delegacionDelLink(evento, codigoLink)
    const resultado = await agregarIntegrantes(delegacion.id, input.participantes)
    return {
        ...(await delegacionPorCodigo(delegacion.codigoLink, evento.id)),
        registrados: resultado.ids.length,
        omitidos: resultado.omitidos,
    }
}

/** La delegación de un link, para que las rutas del sitio le sumen vouchers. */
export async function delegacionParaPagos(evento: Evento, codigoLink: string) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    return delegacionDelLink(evento, codigoLink)
}

/** Valida el cuerpo del registro público (multipart): los campos JSON se parsean en el controlador. */
export async function validarRegistroDelegacion(body: unknown): Promise<RegistroDelegacionInput> {
    return registroDelegacionSchema.validate(body, { abortEarly: false, stripUnknown: true })
}

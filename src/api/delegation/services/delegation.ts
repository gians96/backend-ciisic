import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import type { Delegacion, Evento, Participante, TipoInscripcion } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { monto, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { conReintentoDeCodigo, nuevoCodigoCredencial } from '../../../core/codigos'
import { esCorreoInstitucional } from '../../inscription/services/pricing'
import { aprobarVarias } from '../../inscription/services/inscription'
import { obtenerEventoPorId, inscripcionesAbiertas } from '../../event/services/public-event'
import type {
    ConfigDelegacionInput, CrearDelegacionInput, EditarDelegacionInput, InscribirEnDelegacionInput, InscribirseInput, ParticipanteDelegacionInput,
    RegenerarLinkInput,
} from '../validation'
import { aPago, aPagoPublico, numeroOperacionInterno, resumenPagos } from './pagos'
import {
    aPlan, codigoCategoria, datosDePlan, faltanParaPromocional, nombreDeTipo, ordenCategoria, planesOrdenados, PLANES,
    precioUnitario, redondear, resultadoDePlan, type CodigoPlan,
} from './planes'

export { precioUnitario } from './planes'

const ESTADOS_REINSCRIBIBLES: readonly CodigoEstadoInscripcion[] = ['RECHAZADO', 'CANCELADO']
/** Estados que no cuentan como integrante: el cupo y la tarifa se calculan con el resto. */
const ESTADOS_SIN_CUPO: CodigoEstadoInscripcion[] = ['RECHAZADO', 'CANCELADO']
/** Estados de un integrante que el staff puede quitar del grupo (ya aprobado tiene credencial y asistencia). */
const ESTADOS_QUITABLES: readonly CodigoEstadoInscripcion[] = ['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'CANCELADO']
export const CUENTAN_COMO_INTEGRANTE = { estado: { codigo: { notIn: ESTADOS_SIN_CUPO } } } as const

/** Los planes de una delegación son los tipos de su categoría oculta. */
const INCLUIR_PLANES = { planes: { include: { tipos: true } } } as const
export type DelegacionConPlanes = Prisma.DelegacionGetPayload<{ include: typeof INCLUIR_PLANES }>
/** Para sumar integrantes también se lee el evento (el dominio institucional decide `esCorreoInstitucional`). */
const INCLUIR_PLANES_Y_EVENTO = { ...INCLUIR_PLANES, evento: true } as const

/**
 * Qué datos puede ver quien consulta (spec 013 y 029): sin `pagos.ver` los importes, los vouchers y el
 * resumen de pagos van en `null`; los links de la delegación solo los ve quien inscribe o gestiona.
 */
export interface VistaDelegacion {
    conPago: boolean
    conLinks: boolean
}
export const VISTA_COMPLETA: VistaDelegacion = { conPago: true, conLinks: true }

// ─── Forma pública y del panel ──────────────────────────────────────────────

/** Lo que cuentan los integrantes activos de una delegación: cuántos, cuánto suman y cuántos hay en cada plan. */
interface Totales {
    total: number
    monto: number
    porTipo: Map<number, number>
}

const totalesVacios = (): Totales => ({ total: 0, monto: 0, porTipo: new Map() })

function sumar(totales: Totales, tipoId: number | null, cantidad: number, importe: Prisma.Decimal | number | null) {
    totales.total += cantidad
    totales.monto += monto(importe)
    if (tipoId !== null) totales.porTipo.set(tipoId, (totales.porTipo.get(tipoId) ?? 0) + cantidad)
}

type Pagos = ReadonlyArray<{ monto: Prisma.Decimal | number, estado: string }>

function resumenDe(delegacion: DelegacionConPlanes, totales: Totales, vista: VistaDelegacion) {
    const tipos = delegacion.planes?.tipos ?? []
    const planes = planesOrdenados(tipos).map(({ plan, tipo }) => aPlan(plan, tipo, {
        minIntegrantes: delegacion.minIntegrantes,
        totalIntegrantes: totales.total,
        integrantes: totales.porTipo.get(tipo.id) ?? 0,
        conPago: vista.conPago,
    }))
    return {
        planes,
        montoTotal: vista.conPago ? redondear(totales.monto) : null,
        /** Cuántos faltan para el precio promocional (`null` si ningún plan lo tiene o ya aplica). */
        faltanParaPromocional: faltanParaPromocional(tipos, delegacion.minIntegrantes, totales.total),
    }
}

/** Forma de una delegación (el detalle agrega integrantes y pagos). `totalIntegrantes` cuenta solo integrantes activos. */
export function aDelegacion(delegacion: DelegacionConPlanes, totales: Totales, pagos: Pagos = [], vista: VistaDelegacion = VISTA_COMPLETA) {
    const resumen = resumenDe(delegacion, totales, vista)
    return {
        id: delegacion.id,
        eventoId: delegacion.eventoId,
        nombre: delegacion.nombre,
        institucion: delegacion.institucion,
        codigoLink: vista.conLinks ? delegacion.codigoLink : null,
        /** Link individual (cada integrante se inscribe solo): `null` si está apagado o no se puede ver. */
        codigoInscripcion: vista.conLinks ? delegacion.codigoInscripcion : null,
        inscripcionIndividual: delegacion.codigoInscripcion !== null,
        dominioCorreo: delegacion.dominioCorreo,
        representante: {
            nombre: delegacion.representanteNombre,
            email: delegacion.representanteEmail,
            telefono: delegacion.representanteTelefono,
            tipoDocumento: delegacion.representanteTipoDocumento,
            documento: delegacion.representanteDocumento,
        },
        minIntegrantes: delegacion.minIntegrantes,
        planes: resumen.planes,
        totalIntegrantes: totales.total,
        montoTotal: resumen.montoTotal,
        faltanParaPromocional: resumen.faltanParaPromocional,
        pago: vista.conPago ? resumenPagos(totales.monto, pagos) : null,
        activo: delegacion.activo,
        creadoEn: delegacion.creadoEn,
        actualizadoEn: delegacion.actualizadoEn,
    }
}

/** Código aleatorio de 16 hexadecimales, sin significado ni datos del grupo. Único entre los dos links. */
async function codigoLinkUnico(): Promise<string> {
    for (let intento = 0; intento < 5; intento++) {
        const codigo = crypto.randomBytes(8).toString('hex')
        const existente = await prisma.delegacion.findFirst({ where: { OR: [{ codigoLink: codigo }, { codigoInscripcion: codigo }] }, select: { id: true } })
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
        plan: representante.plan,
    }
}

/** Identificador y evento de una delegación (para sumarle vouchers desde el panel). */
export async function delegacionBasica(id: number) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id }, select: { id: true, eventoId: true } })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    return delegacion
}

// ─── Staff: alta, listado, detalle y edición ────────────────────────────────

/** Crea la categoría oculta de la delegación con sus tres planes (apagados y sin precio salvo lo que se indique). */
async function crearPlanes(tx: Prisma.TransactionClient, delegacion: Pick<Delegacion, 'id' | 'eventoId' | 'nombre'>, cambios?: ConfigDelegacionInput['planes']) {
    const categoria = await tx.categoriaInscripcion.create({
        data: {
            eventoId: delegacion.eventoId,
            codigo: codigoCategoria(delegacion.id),
            nombre: delegacion.nombre,
            esEstudiantil: false,
            orden: ordenCategoria(delegacion.id),
            delegacionId: delegacion.id,
        },
    })
    for (const definicion of PLANES) {
        const plan = cambios?.[definicion.codigo]
        if (plan) resultadoDePlan(null, plan)
        await tx.tipoInscripcion.create({ data: datosDePlan(categoria.id, delegacion.nombre, definicion.codigo, plan) })
    }
    return categoria
}

/**
 * Alta de una delegación por el staff (spec 029): el delegado, sus datos y, si ya los tiene, sus integrantes. Los
 * planes, el mínimo, el dominio y el link individual los fija quien tiene `delegaciones.gestionar`: sin ellos los
 * tres planes nacen apagados y sin precio, y la delegación no admite integrantes hasta que se configuren.
 */
export async function crearDelegacion(eventoId: number, input: CrearDelegacionInput, opciones: { puedeConfigurar: boolean }, vista: VistaDelegacion = VISTA_COMPLETA) {
    await obtenerEventoPorId(eventoId)
    const trae = Boolean(input.planes) || input.minIntegrantes !== undefined || Boolean(input.dominioCorreo) || input.inscripcionIndividual === true
    if (trae && !opciones.puedeConfigurar) {
        throw new HttpError(403, 'FORBIDDEN', 'Los planes, precios, dominio y link individual los configura un Owner o Administrador.')
    }
    const nueva = await prisma.$transaction(async (tx) => {
        const creada = await tx.delegacion.create({
            data: {
                eventoId,
                nombre: input.nombre,
                codigoLink: await codigoLinkUnico(),
                codigoInscripcion: input.inscripcionIndividual ? await codigoLinkUnico() : null,
                institucion: input.institucion ?? null,
                ...datosDelRepresentante(input.representante),
                ...(input.minIntegrantes !== undefined ? { minIntegrantes: input.minIntegrantes } : {}),
                dominioCorreo: input.dominioCorreo ?? null,
            },
        })
        await crearPlanes(tx, creada, input.planes)
        return creada
    })
    const integrantes = [
        ...(input.representante.esIntegrante ? [representanteComoParticipante(input.representante)] : []),
        ...(input.participantes ?? []),
    ]
    if (!integrantes.length) return obtenerDelegacion(nueva.id, vista)
    try {
        return await inscribirParticipantes(nueva.id, { participantes: integrantes }, vista)
    } catch (error) {
        // Sin integrantes la delegación quedaría vacía por un dato mal escrito: se borra para repetir el alta
        await prisma.tipoInscripcion.deleteMany({ where: { categoria: { delegacionId: nueva.id } } }).catch(() => undefined)
        await prisma.categoriaInscripcion.deleteMany({ where: { delegacionId: nueva.id } }).catch(() => undefined)
        await prisma.delegacion.delete({ where: { id: nueva.id } }).catch(() => undefined)
        throw error
    }
}

export async function listarDelegaciones(eventoId: number, vista: VistaDelegacion = VISTA_COMPLETA) {
    await obtenerEventoPorId(eventoId)
    const filas = await prisma.delegacion.findMany({
        where: { eventoId },
        include: { ...INCLUIR_PLANES, pagos: { select: { monto: true, estado: true } } },
        orderBy: { creadoEn: 'desc' },
    })
    // Un solo `groupBy` para todas: cuántos hay en cada plan y cuánto suman
    const grupos = filas.length
        ? await prisma.inscripcion.groupBy({
            by: ['delegacionId', 'tipoInscripcionId'],
            where: { delegacionId: { in: filas.map((fila) => fila.id) }, ...CUENTAN_COMO_INTEGRANTE },
            _count: { _all: true },
            _sum: { monto: true },
        })
        : []
    const totalesPorDelegacion = new Map<number, Totales>()
    for (const grupo of grupos) {
        if (grupo.delegacionId === null) continue
        const totales = totalesPorDelegacion.get(grupo.delegacionId) ?? totalesVacios()
        sumar(totales, grupo.tipoInscripcionId, grupo._count._all, grupo._sum.monto)
        totalesPorDelegacion.set(grupo.delegacionId, totales)
    }
    return filas.map((delegacion) => aDelegacion(delegacion, totalesPorDelegacion.get(delegacion.id) ?? totalesVacios(), delegacion.pagos, vista))
}

export async function obtenerDelegacion(id: number, vista: VistaDelegacion = VISTA_COMPLETA) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { id },
        include: {
            ...INCLUIR_PLANES,
            pagos: { orderBy: { id: 'asc' } },
            inscripciones: {
                include: { participante: true, estado: true },
                orderBy: { creadoEn: 'asc' },
            },
        },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    const totales = totalesVacios()
    for (const inscripcion of delegacion.inscripciones) {
        if (!ESTADOS_SIN_CUPO.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion)) sumar(totales, inscripcion.tipoInscripcionId, 1, inscripcion.monto)
    }
    const planDelTipo = new Map(planesOrdenados(delegacion.planes?.tipos ?? []).map(({ plan, tipo }) => [tipo.id, plan]))
    return {
        ...aDelegacion(delegacion, totales, delegacion.pagos, vista),
        pagos: vista.conPago ? delegacion.pagos.map(aPago) : [],
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
            plan: inscripcion.tipoInscripcionId === null ? null : planDelTipo.get(inscripcion.tipoInscripcionId) ?? null,
            monto: vista.conPago ? monto(inscripcion.monto) : null,
            creadoEn: inscripcion.creadoEn,
        })),
    }
}

/** Edita los datos del grupo (nombre, institución, delegado, activo). Los planes y los links van aparte. */
export async function actualizarDelegacion(id: number, input: EditarDelegacionInput, vista: VistaDelegacion = VISTA_COMPLETA) {
    const actual = await prisma.delegacion.findUnique({ where: { id }, select: { id: true, nombre: true } })
    if (!actual) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
    await prisma.$transaction(async (tx) => {
        await tx.delegacion.update({
            where: { id },
            data: {
                ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
                ...(input.institucion !== undefined ? { institucion: input.institucion ?? null } : {}),
                ...(input.activo !== undefined ? { activo: input.activo } : {}),
                ...(input.representante ? datosDelRepresentante(input.representante) : {}),
            },
        })
        // Los tipos llevan el nombre de la delegación (es lo que se imprime en la credencial)
        if (input.nombre !== undefined && input.nombre !== actual.nombre) {
            await tx.categoriaInscripcion.updateMany({ where: { delegacionId: id }, data: { nombre: input.nombre } })
            await tx.tipoInscripcion.updateMany({ where: { categoria: { delegacionId: id } }, data: { nombre: nombreDeTipo(input.nombre) } })
        }
    })
    return obtenerDelegacion(id, vista)
}

/**
 * Configura la delegación (spec 029, `delegaciones.gestionar`): planes y precios, mínimo de integrantes para el
 * promocional, dominio del correo y link individual. Lo que no llega se conserva. Un cambio de precio o de mínimo
 * reprecia a todo el grupo (`recalcularGrupo`).
 */
export async function configurarDelegacion(id: number, input: ConfigDelegacionInput, vista: VistaDelegacion = VISTA_COMPLETA) {
    const nuevoCodigo = input.inscripcionIndividual === true ? await codigoLinkUnico() : null
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${id} FOR UPDATE`
        const actual = await tx.delegacion.findUnique({ where: { id }, include: INCLUIR_PLANES })
        if (!actual) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${id} no encontrada`)
        const categoria = actual.planes ?? await crearPlanes(tx, actual)
        const tipos = actual.planes?.tipos ?? []

        for (const definicion of PLANES) {
            const cambios = input.planes?.[definicion.codigo]
            if (!cambios) continue
            const tipo = tipos.find((candidato) => candidato.codigo === definicion.codigoTipo) ?? null
            const resultado = resultadoDePlan(tipo, cambios)
            if (tipo) {
                await tx.tipoInscripcion.update({
                    where: { id: tipo.id },
                    data: { precio: resultado.precio, precioInstitucional: resultado.precio, precioPromocional: resultado.promocional, activo: resultado.activo },
                })
            } else {
                await tx.tipoInscripcion.create({ data: datosDePlan(categoria.id, actual.nombre, definicion.codigo, cambios) })
            }
        }

        await tx.delegacion.update({
            where: { id },
            data: {
                ...(input.minIntegrantes !== undefined ? { minIntegrantes: input.minIntegrantes } : {}),
                ...(input.dominioCorreo !== undefined ? { dominioCorreo: input.dominioCorreo ?? null } : {}),
                ...(input.inscripcionIndividual === true && actual.codigoInscripcion === null ? { codigoInscripcion: nuevoCodigo } : {}),
                ...(input.inscripcionIndividual === false ? { codigoInscripcion: null } : {}),
            },
        })
        await recalcularGrupo(tx, id)
    })
    return obtenerDelegacion(id, vista)
}

/** Cambia el código de un link (el anterior deja de funcionar). Regenerar el individual lo enciende. */
export async function regenerarLink(id: number, input: RegenerarLinkInput, vista: VistaDelegacion = VISTA_COMPLETA) {
    await delegacionBasica(id)
    const codigo = await codigoLinkUnico()
    await prisma.delegacion.update({ where: { id }, data: input.enlace === 'delegado' ? { codigoLink: codigo } : { codigoInscripcion: codigo } })
    return obtenerDelegacion(id, vista)
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
 * El plan (tipo) de una fila: el que elige el integrante, que debe estar activo. Sin plan se usa el único activo
 * de la delegación; con varios hay que elegir (`PLAN_REQUIRED`).
 */
function tipoParaFila(delegacion: DelegacionConPlanes, plan: CodigoPlan | undefined | null, indice: number) {
    const activos = planesOrdenados(delegacion.planes?.tipos ?? []).filter(({ tipo }) => tipo.activo)
    if (plan) {
        const elegido = activos.find((candidato) => candidato.plan === plan)
        if (!elegido) {
            throw unprocessable('DELEGATION_PLAN_NOT_AVAILABLE', 'El plan elegido no está disponible en esta delegación.', {
                [`participantes[${indice}].plan`]: 'Plan no disponible',
            })
        }
        return elegido
    }
    if (!activos.length) throw unprocessable('DELEGATION_WITHOUT_PLANS', 'La delegación aún no tiene planes disponibles: la organización debe configurarlos.')
    if (activos.length > 1) {
        throw unprocessable('PLAN_REQUIRED', 'Elige el plan de cada integrante.', { [`participantes[${indice}].plan`]: 'Elige un plan' })
    }
    return activos[0]
}

/** Los correos de una delegación con dominio deben terminar en él (el efectivo: el ya registrado, si la persona existe). */
function exigirDominio(dominio: string | null, filas: FilaPreparada[]) {
    if (!dominio) return
    filas.forEach((fila, indice) => {
        if (fila.accion === 'omitir') return
        const correo = fila.participante?.correo ?? fila.input.correo
        if (!correo.endsWith(`@${dominio}`)) {
            throw unprocessable('EMAIL_DOMAIN_NOT_ALLOWED', `Los correos de esta delegación deben terminar en @${dominio}.`, {
                [`participantes[${indice}].correo`]: `Debe terminar en @${dominio}`,
            })
        }
    })
}

/**
 * Recalcula el grupo: con los integrantes activos, el precio por persona de cada plan se aplica a **todos** sus
 * integrantes (al cruzar el mínimo, los planes con precio promocional pasan a él). El tipo del integrante no cambia.
 * Debe correr dentro de una transacción con la delegación bloqueada.
 */
async function recalcularGrupo(tx: Prisma.TransactionClient, delegacionId: number) {
    const delegacion = await tx.delegacion.findUnique({ where: { id: delegacionId }, include: INCLUIR_PLANES })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    const total = await tx.inscripcion.count({ where: { delegacionId, eventoId: delegacion.eventoId, ...CUENTAN_COMO_INTEGRANTE } })
    for (const { tipo } of planesOrdenados(delegacion.planes?.tipos ?? [])) {
        const precio = monto(tipo.precio)
        const promocional = tipo.precioPromocional === null || tipo.precioPromocional === undefined ? null : monto(tipo.precioPromocional)
        const unitario = precioUnitario(precio, promocional, delegacion.minIntegrantes, total)
        const descuento = unitario < precio ? redondear(precio - unitario) : 0
        await tx.inscripcion.updateMany({
            where: { delegacionId, eventoId: delegacion.eventoId, tipoInscripcionId: tipo.id, ...CUENTAN_COMO_INTEGRANTE },
            data: { monto: unitario, descuento, tieneDescuento: descuento > 0 },
        })
    }
    return { total }
}

interface OpcionesIntegrantes {
    /** Los flujos públicos (link del delegado y link individual) exigen el dominio de la delegación; el staff no. */
    exigirDominio?: boolean
}

/**
 * Suma integrantes a una delegación (staff, link del delegado o link individual). Cada uno lleva el tipo de su
 * plan; el precio de cada plan se calcula con el total final y se aplica a todo el grupo. Todo ocurre en una
 * transacción con la delegación bloqueada, para que dos cargas simultáneas no calculen totales distintos.
 */
async function agregarIntegrantes(delegacionId: number, participantes: ParticipanteDelegacionInput[], opciones: OpcionesIntegrantes = {}) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id: delegacionId }, include: INCLUIR_PLANES_Y_EVENTO })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    if (!delegacion.activo) throw conflict('DELEGATION_INACTIVE', 'La delegación está inactiva.')

    const filas = await prepararFilas(delegacion, participantes)
    if (opciones.exigirDominio) exigirDominio(delegacion.dominioCorreo, filas)
    // El plan de cada fila nueva se resuelve antes de escribir: un plan apagado o faltante no deja nada a medias
    const tipos = filas.map((fila, indice) => (fila.accion === 'omitir' ? null : tipoParaFila(delegacion, fila.input.plan as CodigoPlan | undefined, indice)))

    const resultado = await conReintentoDeCodigo(() => prisma.$transaction(async (tx) => {
        // Serializa las cargas de la misma delegación: el total y la tarifa se calculan dentro
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${delegacionId} FOR UPDATE`
        const pendiente = await tx.estadoInscripcion.findUnique({ where: { codigo: 'PENDIENTE' }, select: { id: true } })
        if (!pendiente) throw new Error('Falta el estado PENDIENTE en el catálogo de estados de inscripción')

        const ids: number[] = []
        const hoy = aColumnaFecha(fechaLima())
        for (const [indice, fila] of filas.entries()) {
            const elegido = tipos[indice]
            if (fila.accion === 'omitir' || !elegido) continue
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

            // El monto y el descuento definitivos los fija `recalcularGrupo` con el total final
            const datos = {
                delegacionId,
                tipoInscripcionId: elegido.tipo.id,
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
        return { ids, ...grupo }
    }))

    return { ...resultado, omitidos: filas.filter((fila) => fila.accion === 'omitir').length }
}

/** `POST /v1/delegations/:id/inscriptions`: alta manual o masiva de integrantes desde el panel. */
export async function inscribirParticipantes(delegacionId: number, input: InscribirEnDelegacionInput, vista: VistaDelegacion = VISTA_COMPLETA) {
    const resultado = await agregarIntegrantes(delegacionId, input.participantes)
    return {
        ...(await obtenerDelegacion(delegacionId, vista)),
        registrados: resultado.ids.length,
        omitidos: resultado.omitidos,
    }
}

/**
 * Quita un integrante del grupo (staff). Solo si aún no fue aprobado: uno aprobado ya tiene
 * credencial y asistencia, y se cancela desde Inscripciones. Al quitarlo, el grupo se recalcula.
 */
export async function quitarIntegrante(delegacionId: number, inscripcionId: number, vista: VistaDelegacion = VISTA_COMPLETA) {
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
    return obtenerDelegacion(delegacionId, vista)
}

/**
 * Cambia el plan de un integrante (staff): pasa al tipo del plan elegido, que debe estar activo, y el grupo se
 * recalcula. Un integrante rechazado o cancelado no cuenta en el grupo y no se mueve.
 */
export async function cambiarPlanIntegrante(delegacionId: number, inscripcionId: number, plan: CodigoPlan, vista: VistaDelegacion = VISTA_COMPLETA) {
    const delegacion = await prisma.delegacion.findUnique({ where: { id: delegacionId }, include: INCLUIR_PLANES })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    const inscripcion = await prisma.inscripcion.findFirst({
        where: { id: inscripcionId, delegacionId },
        select: { id: true, tipoInscripcionId: true, estado: { select: { codigo: true } } },
    })
    if (!inscripcion) throw notFound('INSCRIPTION_NOT_FOUND', `La inscripción ${inscripcionId} no pertenece a la delegación ${delegacionId}`)
    if (ESTADOS_SIN_CUPO.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion)) {
        throw conflict('INSCRIPTION_NOT_EDITABLE', 'El integrante está rechazado o cancelado: no cuenta en el grupo.')
    }
    const elegido = planesOrdenados(delegacion.planes?.tipos ?? []).find((candidato) => candidato.plan === plan)
    if (!elegido) throw unprocessable('DELEGATION_PLAN_NOT_AVAILABLE', 'El plan elegido no existe en esta delegación.', { plan: 'Plan no disponible' })
    // Quedarse en el mismo plan es válido aunque esté apagado; pasar a uno apagado no
    if (elegido.tipo.id !== inscripcion.tipoInscripcionId && !elegido.tipo.activo) {
        throw unprocessable('DELEGATION_PLAN_NOT_AVAILABLE', 'El plan elegido no está disponible en esta delegación.', { plan: 'Plan no disponible' })
    }
    await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM delegaciones WHERE id = ${delegacionId} FOR UPDATE`
        await tx.inscripcion.update({ where: { id: inscripcionId }, data: { tipoInscripcionId: elegido.tipo.id } })
        await recalcularGrupo(tx, delegacionId)
    })
    return obtenerDelegacion(delegacionId, vista)
}

/**
 * Aprueba a todo el grupo (staff): los integrantes por revisar pasan a APROBADO en el acto y las
 * credenciales se generan y envían después, una por una (los PDF son pesados). Devuelve cuántos
 * aprobó y el saldo que aún se debe, para que el panel lo avise.
 */
export async function aprobarDelegacion(delegacionId: number, adminId?: number, vista: VistaDelegacion = VISTA_COMPLETA) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { id: delegacionId },
        select: { id: true, inscripciones: { select: { id: true, estado: { select: { codigo: true } } } } },
    })
    if (!delegacion) throw notFound('DELEGATION_NOT_FOUND', `Delegación con id ${delegacionId} no encontrada`)
    const porRevisar = delegacion.inscripciones.filter((inscripcion) => ['PENDIENTE', 'EN_REVISION'].includes(inscripcion.estado.codigo)).map((inscripcion) => inscripcion.id)
    if (!porRevisar.length) throw conflict('NOTHING_TO_APPROVE', 'No hay integrantes por aprobar.')
    const aprobadas = await aprobarVarias(porRevisar, adminId)
    const detalle = await obtenerDelegacion(delegacionId, vista)
    return { ...detalle, aprobadas: aprobadas.length, credencialesEnSegundoPlano: aprobadas.length }
}

// ─── API del sitio ──────────────────────────────────────────────────────────

/** DNI visible solo en sus últimos dígitos: el link se comparte entre los integrantes del grupo. */
function enmascararDocumento(numero: string): string {
    return numero.length <= 4 ? '****' : `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`
}

const EVENTO_PUBLICO = {
    select: {
        id: true, codigo: true, nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true,
        inscripcionesAbiertas: true, estado: true,
    },
} as const

/** Un plan activo visto desde la landing: lo que paga cada integrante, sin cantidades del grupo. */
function planPublico(plan: CodigoPlan, tipo: TipoInscripcion) {
    return {
        codigo: plan,
        etiqueta: tipo.etiqueta,
        modalidad: tipo.modalidad,
        precio: monto(tipo.precio),
        precioPromocional: tipo.precioPromocional === null || tipo.precioPromocional === undefined ? null : monto(tipo.precioPromocional),
    }
}

/**
 * Lo que ve el delegado con su link: el grupo, sus planes y precios, los integrantes (documento enmascarado y
 * plan) y sus vouchers (número enmascarado, sin el motivo interno). No expone el correo ni el teléfono del
 * delegado. `eventoId` acota la búsqueda: el link solo sirve dentro del evento del token de acceso. Incluye el
 * link individual (si está encendido) para que el delegado lo comparta con su grupo.
 */
export async function delegacionPorCodigo(codigoLink: string, eventoId: number) {
    const delegacion = await prisma.delegacion.findUnique({
        where: { codigoLink },
        include: {
            ...INCLUIR_PLANES,
            evento: EVENTO_PUBLICO,
            pagos: { orderBy: { id: 'asc' } },
            inscripciones: { include: { participante: true, estado: true }, orderBy: { creadoEn: 'asc' } },
        },
    })
    if (!delegacion || !delegacion.activo || delegacion.eventoId !== eventoId) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    const activos = delegacion.inscripciones.filter((inscripcion) => !ESTADOS_SIN_CUPO.includes(inscripcion.estado.codigo as CodigoEstadoInscripcion))
    const totales = totalesVacios()
    for (const inscripcion of activos) sumar(totales, inscripcion.tipoInscripcionId, 1, inscripcion.monto)
    const resumen = resumenDe(delegacion, totales, VISTA_COMPLETA)
    const planDelTipo = new Map(planesOrdenados(delegacion.planes?.tipos ?? []).map(({ plan, tipo }) => [tipo.id, plan]))
    return {
        id: delegacion.id,
        nombre: delegacion.nombre,
        codigoLink: delegacion.codigoLink,
        codigoInscripcion: delegacion.codigoInscripcion,
        institucion: delegacion.institucion,
        representanteNombre: delegacion.representanteNombre,
        evento: delegacion.evento,
        dominioCorreo: delegacion.dominioCorreo,
        minIntegrantes: delegacion.minIntegrantes,
        planes: resumen.planes,
        totalIntegrantes: totales.total,
        montoTotal: resumen.montoTotal,
        faltanParaPromocional: resumen.faltanParaPromocional,
        pago: resumenPagos(totales.monto, delegacion.pagos),
        integrantes: activos.map((inscripcion) => ({
            nombres: inscripcion.participante.nombres,
            apellidos: inscripcion.participante.apellidos,
            documento: enmascararDocumento(inscripcion.participante.numeroDocumento),
            estado: inscripcion.estado.codigo,
            plan: inscripcion.tipoInscripcionId === null ? null : planDelTipo.get(inscripcion.tipoInscripcionId) ?? null,
        })),
        pagos: delegacion.pagos.map(aPagoPublico),
    }
}

/** La delegación de un link dentro del evento del token, activa; `404` si no. */
async function delegacionDelLink(eventoId: number, codigoLink: string) {
    const delegacion = await prisma.delegacion.findUnique({ where: { codigoLink: codigoLink.trim() } })
    if (!delegacion || !delegacion.activo || delegacion.eventoId !== eventoId) throw notFound('DELEGATION_NOT_FOUND', 'La delegación no existe o no está activa.')
    return delegacion
}

/** `POST /v1/site/delegations/link/:codigoLink/participants`: el delegado suma integrantes (con el dominio de la delegación). */
export async function inscribirPorLink(evento: Evento, codigoLink: string, input: InscribirEnDelegacionInput) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    const delegacion = await delegacionDelLink(evento.id, codigoLink)
    const resultado = await agregarIntegrantes(delegacion.id, input.participantes, { exigirDominio: true })
    return {
        ...(await delegacionPorCodigo(delegacion.codigoLink, evento.id)),
        registrados: resultado.ids.length,
        omitidos: resultado.omitidos,
    }
}

/** La delegación de un link, para que las rutas del sitio le sumen vouchers. */
export async function delegacionParaPagos(evento: Evento, codigoLink: string) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    return delegacionDelLink(evento.id, codigoLink)
}

/** La delegación de un link individual dentro del evento del token, activa y con el link encendido; `404` si no. */
async function delegacionDelLinkIndividual(eventoId: number, codigoInscripcion: string) {
    const codigo = codigoInscripcion.trim()
    const delegacion = codigo
        ? await prisma.delegacion.findUnique({ where: { codigoInscripcion: codigo }, include: { ...INCLUIR_PLANES, evento: EVENTO_PUBLICO } })
        : null
    if (!delegacion || !delegacion.activo || delegacion.eventoId !== eventoId) throw notFound('DELEGATION_NOT_FOUND', 'El link no existe o ya no está activo.')
    return delegacion
}

/**
 * `GET /v1/site/delegations/join/:codigoInscripcion`: lo que ve quien abre el link individual: el grupo, el
 * dominio del correo y los planes activos con su precio. Nada de los demás integrantes.
 */
export async function delegacionPublicaPorInscripcion(codigoInscripcion: string, eventoId: number) {
    const delegacion = await delegacionDelLinkIndividual(eventoId, codigoInscripcion)
    return {
        nombre: delegacion.nombre,
        institucion: delegacion.institucion,
        evento: delegacion.evento,
        dominioCorreo: delegacion.dominioCorreo,
        minIntegrantes: delegacion.minIntegrantes,
        planes: planesOrdenados(delegacion.planes?.tipos ?? []).filter(({ tipo }) => tipo.activo).map(({ plan, tipo }) => planPublico(plan, tipo)),
    }
}

/** El correo de quien se inscribe solo: con dominio basta el prefijo; sin dominio, el correo completo. */
function correoDeInscripcion(dominio: string | null, input: InscribirseInput): string {
    if (dominio && input.correoPrefijo) return `${input.correoPrefijo}@${dominio}`
    if (input.correo) return input.correo
    throw unprocessable('VALIDATION_ERROR', 'Escribe tu correo completo.', { correo: 'Escribe tu correo completo' })
}

/**
 * `POST /v1/site/delegations/join/:codigoInscripcion/participants`: un integrante se inscribe solo en su
 * delegación, sin Google. Con dominio en la delegación el correo se arma con el prefijo y siempre debe terminar
 * en ese dominio. El pago sigue siendo del grupo (los vouchers los sube el delegado o el staff).
 */
export async function inscribirseConLink(evento: Evento, codigoInscripcion: string, input: InscribirseInput) {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    const delegacion = await delegacionDelLinkIndividual(evento.id, codigoInscripcion)
    const participante: ParticipanteDelegacionInput = {
        tipoDocumento: input.tipoDocumento,
        numeroDocumento: input.numeroDocumento,
        nombres: input.nombres,
        apellidos: input.apellidos,
        correo: correoDeInscripcion(delegacion.dominioCorreo, input),
        celular: input.celular ?? '',
        plan: input.plan,
    }
    const elegido = tipoParaFila(delegacion, input.plan as CodigoPlan | undefined, 0)
    const resultado = await agregarIntegrantes(delegacion.id, [participante], { exigirDominio: true })
    return {
        delegacion: { nombre: delegacion.nombre },
        plan: { codigo: elegido.plan, etiqueta: elegido.tipo.etiqueta, modalidad: elegido.tipo.modalidad },
        registrados: resultado.ids.length,
        omitidos: resultado.omitidos,
    }
}


import { Prisma } from '@prisma/client'
import type { EstadoCertificado } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaSoloDia } from '../../../core/fechas'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { enmascararDocumento } from '../../activity/services/activity'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { EditarCertificadoInput } from '../validation/certificados'

/**
 * Certificados (spec 015): listado, detalle, edición y borrado. Las respuestas nunca llevan nombres
 * de archivo, rutas ni hashes; el documento va enmascarado (`****5678`) sin `certificados.gestionar`.
 */
export const ESTADOS_CERTIFICADO: readonly EstadoCertificado[] = ['PENDIENTE', 'PREPARADO', 'EN_FIRMA', 'FIRMADO', 'ANULADO']

/** Estados en los que el contenido ya no se edita ni se regenera. */
export const ESTADOS_BLOQUEADOS: readonly EstadoCertificado[] = ['EN_FIRMA', 'FIRMADO', 'ANULADO']

export const certificadoNoEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')

export const INCLUDE_CERTIFICADO = {
    tipo: { select: { id: true, codigo: true, nombre: true, textoImpreso: true } },
    plantilla: { select: { id: true, nombre: true, version: true, firmasRequeridas: true } },
} satisfies Prisma.CertificadoInclude

const ADMIN = { select: { id: true, nombres: true, apellidos: true } } as const

const INCLUDE_DETALLE = {
    ...INCLUDE_CERTIFICADO,
    evento: { select: { id: true, codigo: true, nombreCorto: true } },
    emitidoPor: ADMIN,
    editadoPor: ADMIN,
    firmadoCargadoPor: ADMIN,
    anuladoPor: ADMIN,
} satisfies Prisma.CertificadoInclude

export type CertificadoConRelaciones = Prisma.CertificadoGetPayload<{ include: typeof INCLUDE_CERTIFICADO }>
type CertificadoDetalle = Prisma.CertificadoGetPayload<{ include: typeof INCLUDE_DETALLE }>

/** `DNI 12345678` para el estampado; en las respuestas, el tipo y el número por separado. */
export function documentoImpreso(tipoDocumento: string, numeroDocumento: string): string {
    return `${tipoDocumento.toUpperCase()} ${numeroDocumento}`
}

export function aCertificado(c: CertificadoConRelaciones, conDocumento: boolean) {
    return {
        id: c.id,
        eventoId: c.eventoId,
        numero: c.numero,
        codigo: c.codigo,
        codigoImpreso: c.codigoImpreso,
        estado: c.estado,
        tipo: c.tipo,
        plantilla: c.plantilla,
        /** Versión de la plantilla con la que se generó (`null` si nunca se generó). */
        plantillaVersion: c.plantillaVersion,
        /** El generado es de una versión anterior de la plantilla (se regenera editándolo). */
        plantillaDesactualizada: Boolean(c.plantilla && c.plantillaVersion !== null && c.plantillaVersion !== c.plantilla.version),
        participanteId: c.participanteId,
        inscripcionId: c.inscripcionId,
        ponenciaId: c.ponenciaId,
        nombreImpreso: c.nombreImpreso,
        tipoDocumento: c.tipoDocumento,
        numeroDocumento: conDocumento ? c.numeroDocumento : enmascararDocumento(c.numeroDocumento),
        detalle: c.detalle,
        horas: c.horas,
        fechaEmision: fechaSoloDia(c.fechaEmision),
        tieneGenerado: Boolean(c.archivoGenerado) && c.estado !== 'PENDIENTE' && c.estado !== 'ANULADO',
        tieneFirmado: Boolean(c.archivoFirmado) && (c.estado === 'EN_FIRMA' || c.estado === 'FIRMADO'),
        generadoEn: c.generadoEn,
        descargadoParaFirmarEn: c.descargadoParaFirmarEn,
        firmasDetectadas: c.firmasDetectadas,
        firmadoEn: c.firmadoEn,
        anuladoEn: c.anuladoEn,
        creadoEn: c.creadoEn,
        actualizadoEn: c.actualizadoEn,
    }
}

function aDetalle(c: CertificadoDetalle, conDocumento: boolean) {
    return {
        ...aCertificado(c, conDocumento),
        evento: c.evento,
        urlVerificacion: c.urlVerificacion,
        coincidencia: c.coincidencia,
        motivoForzado: c.motivoForzado,
        /** Firmantes de las firmas que verificaron (sin raíz de confianza: revisar que sean los esperados). */
        firmantes: Array.isArray(c.firmantes) ? c.firmantes : [],
        motivoAnulacion: c.motivoAnulacion,
        codigoExterno: c.codigoExterno,
        registroExterno: c.registroExterno,
        registroExternoError: c.registroExternoError,
        registradoExternoEn: c.registradoExternoEn,
        emitidoPor: c.emitidoPor,
        editadoPor: c.editadoPor,
        firmadoCargadoPor: c.firmadoCargadoPor,
        anuladoPor: c.anuladoPor,
    }
}

// ─── Listado ────────────────────────────────────────────────────────────────

export interface FiltrosCertificados {
    estado?: EstadoCertificado[]
    tipo?: string
    plantillaId?: number
    q?: string
}

function texto(valor: unknown, maximo: number): string | undefined {
    if (typeof valor !== 'string') return undefined
    const limpio = valor.trim().slice(0, maximo)
    return limpio || undefined
}

/** Filtros de la query (`estado` admite una lista separada por comas). 422 si un valor no es válido. */
export function leerFiltros(query: Record<string, unknown>): FiltrosCertificados {
    const filtros: FiltrosCertificados = {}
    const estados = texto(query.estado, 100)
    if (estados) {
        const lista = [...new Set(estados.split(',').map((e) => e.trim().toUpperCase()).filter(Boolean))]
        if (!lista.every((e) => (ESTADOS_CERTIFICADO as readonly string[]).includes(e))) {
            throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { estado: `Usa ${ESTADOS_CERTIFICADO.join(', ')}` })
        }
        filtros.estado = lista as EstadoCertificado[]
    }
    const tipo = texto(query.tipo, 40)
    if (tipo) filtros.tipo = tipo.toUpperCase()
    if (query.plantillaId !== undefined && query.plantillaId !== '') {
        const plantillaId = Number(query.plantillaId)
        if (!Number.isSafeInteger(plantillaId) || plantillaId < 1) {
            throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { plantillaId: 'Debe ser un número válido' })
        }
        filtros.plantillaId = plantillaId
    }
    const q = texto(query.q, 100)
    if (q) filtros.q = q
    return filtros
}

/**
 * Condición del listado sin el estado (el resumen por estado usa los demás filtros: las tarjetas
 * del panel funcionan como filtro de estado). Buscar por documento exige `certificados.gestionar`:
 * sin él el documento va enmascarado y la búsqueda no puede servir para averiguarlo.
 */
function condicionBase(eventoId: number, filtros: FiltrosCertificados, conDocumento: boolean): Prisma.CertificadoWhereInput {
    const where: Prisma.CertificadoWhereInput = { eventoId }
    if (filtros.tipo) where.tipo = { codigo: filtros.tipo }
    if (filtros.plantillaId) where.plantillaId = filtros.plantillaId
    if (filtros.q) {
        const busqueda: Prisma.CertificadoWhereInput[] = [
            { nombreImpreso: { contains: filtros.q } },
            { codigo: { contains: filtros.q.toUpperCase() } },
            { codigoImpreso: { contains: filtros.q.toUpperCase() } },
        ]
        if (conDocumento) busqueda.push({ numeroDocumento: { contains: filtros.q } })
        where.OR = busqueda
    }
    return where
}

export async function listarCertificados(eventoId: number, filtros: FiltrosCertificados, paginacion: Pagination, conDocumento: boolean) {
    await obtenerEventoPorId(eventoId)
    const base = condicionBase(eventoId, filtros, conDocumento)
    const where: Prisma.CertificadoWhereInput = filtros.estado ? { ...base, estado: { in: filtros.estado } } : base
    const [total, filas, grupos] = await Promise.all([
        prisma.certificado.count({ where }),
        prisma.certificado.findMany({ where, include: INCLUDE_CERTIFICADO, orderBy: { numero: 'asc' }, skip: paginacion.skip, take: paginacion.take }),
        prisma.certificado.groupBy({ by: ['estado'], where: base, _count: { _all: true } }),
    ])
    const resumen = Object.fromEntries(ESTADOS_CERTIFICADO.map((estado) => [estado, 0])) as Record<EstadoCertificado, number>
    for (const grupo of grupos) resumen[grupo.estado] = grupo._count._all
    return { data: filas.map((c) => aCertificado(c, conDocumento)), meta: { ...pageMeta(paginacion, total), resumen } }
}

export async function obtenerCertificado(id: number, conDocumento: boolean) {
    const c = await prisma.certificado.findUnique({ where: { id }, include: INCLUDE_DETALLE })
    if (!c) throw certificadoNoEncontrado()
    return aDetalle(c, conDocumento)
}

// ─── Edición y borrado ──────────────────────────────────────────────────────

export const certificadoBloqueado = (estado: EstadoCertificado) => conflict(
    'CERTIFICATE_LOCKED',
    estado === 'ANULADO'
        ? 'El certificado está anulado: no se puede modificar.'
        : 'El certificado ya tiene firmas: no se puede modificar ni regenerar. Anúlalo y emite otro si hace falta.',
)

/** Plantilla del evento y activa: 404 si no existe, 422 si es de otro evento o está inactiva. */
export async function plantillaDelEvento(eventoId: number, plantillaId: number) {
    const plantilla = await prisma.plantillaCertificado.findUnique({
        where: { id: plantillaId },
        select: { id: true, eventoId: true, activa: true, horasPorDefecto: true },
    })
    if (!plantilla) throw notFound('TEMPLATE_NOT_FOUND', 'La plantilla no existe.')
    if (plantilla.eventoId !== eventoId) throw unprocessable('TEMPLATE_OTHER_EVENT', 'La plantilla es de otro evento.', { plantillaId: 'Elige una plantilla de este evento' })
    if (!plantilla.activa) throw unprocessable('TEMPLATE_INACTIVE', 'La plantilla está desactivada.', { plantillaId: 'Elige una plantilla activa' })
    return plantilla
}

/**
 * `PUT /v1/certificates/:id`: cambia el contenido y el certificado vuelve a PENDIENTE (se genera de
 * nuevo con la siguiente tanda; el archivo anterior se borra al regenerar). Sin cuerpo sirve para
 * pedir que se regenere (p. ej. tras cambiar la plantilla).
 * - EN_FIRMA, FIRMADO o ANULADO → 409 `CERTIFICATE_LOCKED`.
 * - Ya descargado para firmar → 409 `CERTIFICATE_SENT_TO_SIGN` salvo `confirmar` (lo que se esté
 *   firmando dejará de coincidir y se rechazará al subirlo).
 */
export async function editarCertificado(id: number, input: EditarCertificadoInput, actorId: number, conDocumento: boolean) {
    const actual = await prisma.certificado.findUnique({
        where: { id },
        select: { id: true, eventoId: true, estado: true, descargadoParaFirmarEn: true, participante: { select: { nombres: true, apellidos: true } } },
    })
    if (!actual) throw certificadoNoEncontrado()
    if (ESTADOS_BLOQUEADOS.includes(actual.estado)) throw certificadoBloqueado(actual.estado)
    if (actual.descargadoParaFirmarEn && !input.confirmar) {
        throw new HttpError(409, 'CERTIFICATE_SENT_TO_SIGN', 'El certificado ya se descargó para firmar: si lo cambias, la copia que se está firmando dejará de valer. Confirma para continuar.')
    }
    if (input.plantillaId) await plantillaDelEvento(actual.eventoId, input.plantillaId)

    // La generación vigente se descarta: una copia anterior (firmada o no) ya no coincide al subirla,
    // ni por prefijo ni por `Subject`. El archivo anterior se borra al regenerar; la URL y el código
    // impreso siguen congelados.
    const data: Prisma.CertificadoUncheckedUpdateManyInput = {
        estado: 'PENDIENTE',
        editadoPorId: actorId,
        generacion: null,
        hashGenerado: null,
        bytesGenerado: null,
        descargadoParaFirmarEn: null,
    }
    if (input.sincronizarNombre) data.nombreImpreso = `${actual.participante.nombres} ${actual.participante.apellidos}`.trim().slice(0, 200)
    else if (input.nombreImpreso !== undefined) data.nombreImpreso = input.nombreImpreso
    if (input.detalle !== undefined) data.detalle = input.detalle
    if (input.horas !== undefined) data.horas = input.horas
    if (input.plantillaId) data.plantillaId = input.plantillaId
    if (input.fechaEmision) data.fechaEmision = aColumnaFecha(input.fechaEmision)

    // Solo si sigue sin firmas: una carga de firmados simultánea gana y la edición responde 409
    const { count } = await prisma.certificado.updateMany({ where: { id, estado: { in: ['PENDIENTE', 'PREPARADO'] } }, data })
    if (!count) {
        const ahora = await prisma.certificado.findUnique({ where: { id }, select: { estado: true } })
        if (!ahora) throw certificadoNoEncontrado()
        throw certificadoBloqueado(ahora.estado)
    }
    return obtenerCertificado(id, conDocumento)
}

/**
 * `DELETE /v1/certificates/:id`: solo un PENDIENTE que nunca se generó (su código no se imprimió
 * en ningún archivo). Lo demás se anula. 409 `CERTIFICATE_LOCKED` si no.
 */
export async function borrarCertificado(id: number) {
    const actual = await prisma.certificado.findUnique({ where: { id }, select: { estado: true, generadoEn: true } })
    if (!actual) throw certificadoNoEncontrado()
    const bloqueado = () => conflict('CERTIFICATE_LOCKED', 'Solo se borra un certificado pendiente que nunca se generó; anúlalo en su lugar.')
    if (actual.estado !== 'PENDIENTE' || actual.generadoEn !== null) throw bloqueado()
    // Condicionado: si entre tanto se generó, no se borra
    const { count } = await prisma.certificado.deleteMany({ where: { id, estado: 'PENDIENTE', generadoEn: null } })
    if (!count) throw bloqueado()
}

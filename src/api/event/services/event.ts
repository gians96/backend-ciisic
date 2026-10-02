import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaLima, fechaSoloDia } from '../../../core/fechas'
import { monto } from '../../../core/catalogos'
import type { Actor } from '../../../core/actor'
import { obtenerEventoPorId } from './public-event'
import { limpiarQrs, qrsDe, verificarQrs } from '../../payment-qr/services/payment-qr'
import type { ActualizarEventoInput, CrearEventoInput } from '../validation'

type CredencialResumen = { id: number, nombre: string, remitenteCorreo: string }
const conCredencial = { credencialCorreo: { select: { id: true, nombre: true, remitenteCorreo: true } } } satisfies Prisma.EventoInclude

export function aEventoAdmin(evento: Evento & { credencialCorreo?: CredencialResumen | null }, totalInscripciones?: number) {
    return {
        id: evento.id,
        codigo: evento.codigo,
        nombre: evento.nombre,
        nombreCorto: evento.nombreCorto,
        descripcion: evento.descripcion,
        sede: evento.sede,
        fechaInicio: fechaSoloDia(evento.fechaInicio),
        fechaFin: fechaSoloDia(evento.fechaFin),
        inscripcionesInicio: evento.inscripcionesInicio,
        inscripcionesFin: evento.inscripcionesFin,
        inscripcionesAbiertas: evento.inscripcionesAbiertas,
        estado: evento.estado,
        esPrincipal: evento.esPrincipal,
        dominioInstitucional: evento.dominioInstitucional,
        correoContacto: evento.correoContacto,
        telefonoContacto: evento.telefonoContacto,
        remitenteNombre: evento.remitenteNombre,
        asuntoAprobacion: evento.asuntoAprobacion,
        datosPago: evento.datosPago ?? null,
        credencialCorreoId: evento.credencialCorreoId,
        credencialCorreo: evento.credencialCorreo ?? null,
        creadoEn: evento.creadoEn,
        actualizadoEn: evento.actualizadoEn,
        ...(totalInscripciones !== undefined ? { totalInscripciones } : {}),
    }
}

/**
 * Vista del evento para el staff que no lo configura (Tesorero, Comisión, spec 013): lo que usan
 * el selector y las pantallas operativas del panel. Nunca lleva la credencial de correo ni la
 * configuración del evento; los datos de pago solo con `pagos.ver`.
 */
export function aEventoOperativo(evento: Evento, conPago: boolean) {
    return {
        id: evento.id,
        codigo: evento.codigo,
        nombre: evento.nombre,
        nombreCorto: evento.nombreCorto,
        sede: evento.sede,
        fechaInicio: fechaSoloDia(evento.fechaInicio),
        fechaFin: fechaSoloDia(evento.fechaFin),
        estado: evento.estado,
        esPrincipal: evento.esPrincipal,
        inscripcionesAbiertas: evento.inscripcionesAbiertas,
        inscripcionesInicio: evento.inscripcionesInicio,
        inscripcionesFin: evento.inscripcionesFin,
        logoArchivo: evento.logoArchivo,
        ...(conPago ? { datosPago: evento.datosPago ?? null } : {}),
    }
}

function datosEvento(input: ActualizarEventoInput): Prisma.EventoUncheckedUpdateInput {
    const data: Prisma.EventoUncheckedUpdateInput = {}
    if (input.codigo !== undefined) data.codigo = input.codigo
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.nombreCorto !== undefined) data.nombreCorto = input.nombreCorto
    if (input.descripcion !== undefined) data.descripcion = input.descripcion
    if (input.sede !== undefined) data.sede = input.sede
    if (input.fechaInicio !== undefined) data.fechaInicio = aColumnaFecha(input.fechaInicio)
    if (input.fechaFin !== undefined) data.fechaFin = aColumnaFecha(input.fechaFin)
    if (input.inscripcionesInicio !== undefined) data.inscripcionesInicio = input.inscripcionesInicio
    if (input.inscripcionesFin !== undefined) data.inscripcionesFin = input.inscripcionesFin
    if (input.inscripcionesAbiertas !== undefined) data.inscripcionesAbiertas = input.inscripcionesAbiertas
    if (input.estado !== undefined) data.estado = input.estado as Evento['estado']
    if (input.esPrincipal !== undefined) data.esPrincipal = input.esPrincipal
    if (input.dominioInstitucional !== undefined) data.dominioInstitucional = input.dominioInstitucional
    if (input.correoContacto !== undefined) data.correoContacto = input.correoContacto
    if (input.telefonoContacto !== undefined) data.telefonoContacto = input.telefonoContacto
    if (input.remitenteNombre !== undefined) data.remitenteNombre = input.remitenteNombre
    if (input.asuntoAprobacion !== undefined) data.asuntoAprobacion = input.asuntoAprobacion
    if (input.datosPago !== undefined) data.datosPago = input.datosPago === null ? Prisma.JsonNull : input.datosPago as Prisma.InputJsonValue
    if (input.credencialCorreoId !== undefined) data.credencialCorreoId = input.credencialCorreoId
    return data
}

async function verificarCredencialCorreo(id: number | null | undefined) {
    if (!id) return
    if (!await prisma.credencialCorreo.findUnique({ where: { id } })) {
        throw unprocessable('EMAIL_CREDENTIAL_NOT_FOUND', 'La credencial de correo no existe.', { credencialCorreoId: 'Seleccione una credencial existente' })
    }
}

async function verificarCodigoLibre(codigo: string, exceptoId?: number) {
    const existente = await prisma.evento.findUnique({ where: { codigo } })
    if (existente && existente.id !== exceptoId) throw conflict('EVENT_CODE_TAKEN', `Ya existe un evento con el código "${codigo}".`)
}

export async function listarEventos() {
    const eventos = await prisma.evento.findMany({
        orderBy: [{ fechaInicio: 'desc' }, { id: 'desc' }],
        include: { _count: { select: { inscripciones: true } }, ...conCredencial },
    })
    return eventos.map((evento) => aEventoAdmin(evento, evento._count.inscripciones))
}

/** Eventos del actor (los asignados; todos si es una cuenta global), en el mismo orden que `listarEventos`. */
export async function listarEventosOperativos(actor: Actor) {
    const eventos = await prisma.evento.findMany({
        where: actor.alcance === 'GLOBAL' ? {} : { id: { in: [...actor.eventoIds] } },
        orderBy: [{ fechaInicio: 'desc' }, { id: 'desc' }],
    })
    const conPago = actor.permisos.has('pagos.ver')
    return eventos.map((evento) => aEventoOperativo(evento, conPago))
}

export async function obtenerEvento(id: number) {
    await obtenerEventoPorId(id)
    const [evento, total] = await Promise.all([
        prisma.evento.findUniqueOrThrow({ where: { id }, include: conCredencial }),
        prisma.inscripcion.count({ where: { eventoId: id } }),
    ])
    return aEventoAdmin(evento, total)
}

export async function crearEvento(input: CrearEventoInput) {
    await verificarCodigoLibre(input.codigo)
    await verificarCredencialCorreo(input.credencialCorreoId)
    if (input.datosPago) await verificarQrs(input.datosPago)
    const origen = input.copiarDeEventoId
        ? await prisma.evento.findUnique({
            where: { id: input.copiarDeEventoId },
            include: { categorias: { include: { tipos: true }, orderBy: { orden: 'asc' } } },
        })
        : null
    if (input.copiarDeEventoId && !origen) throw conflict('SOURCE_EVENT_NOT_FOUND', 'El evento a copiar no existe.')

    const evento = await prisma.$transaction(async (tx) => {
        if (input.esPrincipal) await tx.evento.updateMany({ data: { esPrincipal: false } })
        const creado = await tx.evento.create({
            data: {
                ...(datosEvento(input) as Prisma.EventoUncheckedCreateInput),
                codigo: input.codigo,
                nombre: input.nombre,
                nombreCorto: input.nombreCorto,
                fechaInicio: aColumnaFecha(input.fechaInicio),
                fechaFin: aColumnaFecha(input.fechaFin),
                ...(input.datosPago === undefined && origen?.datosPago ? { datosPago: origen.datosPago as Prisma.InputJsonValue } : {}),
                ...(input.credencialCorreoId === undefined && origen?.credencialCorreoId ? { credencialCorreoId: origen.credencialCorreoId } : {}),
            },
        })
        for (const categoria of origen?.categorias ?? []) {
            const nueva = await tx.categoriaInscripcion.create({
                data: {
                    eventoId: creado.id,
                    codigo: categoria.codigo,
                    nombre: categoria.nombre,
                    descripcion: categoria.descripcion,
                    caracteristicas: categoria.caracteristicas ?? Prisma.JsonNull,
                    precioDesde: categoria.precioDesde,
                    esEstudiantil: categoria.esEstudiantil,
                    orden: categoria.orden,
                },
            })
            if (categoria.tipos.length) {
                await tx.tipoInscripcion.createMany({
                    data: categoria.tipos.map((tipo) => ({
                        categoriaId: nueva.id,
                        codigo: tipo.codigo,
                        nombre: tipo.nombre,
                        etiqueta: tipo.etiqueta,
                        descripcion: tipo.descripcion,
                        caracteristicas: tipo.caracteristicas ?? Prisma.JsonNull,
                        precio: tipo.precio,
                        precioInstitucional: tipo.precioInstitucional,
                        disponiblePara: tipo.disponiblePara,
                        activo: tipo.activo,
                        orden: tipo.orden,
                    })),
                })
            }
        }
        return creado
    })
    return obtenerEvento(evento.id)
}

export async function actualizarEvento(id: number, input: ActualizarEventoInput) {
    const actual = await obtenerEventoPorId(id)
    if (input.codigo && input.codigo !== actual.codigo) await verificarCodigoLibre(input.codigo, id)
    await verificarCredencialCorreo(input.credencialCorreoId)
    const inicio = input.fechaInicio ?? fechaSoloDia(actual.fechaInicio)
    const fin = input.fechaFin ?? fechaSoloDia(actual.fechaFin)
    if (inicio && fin && fin < inicio) throw conflict('INVALID_DATES', 'La fecha de fin debe ser posterior a la de inicio.')
    if (input.datosPago) await verificarQrs(input.datosPago)
    const evento = await prisma.$transaction(async (tx) => {
        if (input.esPrincipal) await tx.evento.updateMany({ where: { id: { not: id } }, data: { esPrincipal: false } })
        return tx.evento.update({ where: { id }, data: datosEvento(input) })
    })
    // Los QR reemplazados o quitados ya no se usan (salvo en otro evento)
    if (input.datosPago !== undefined) await limpiarQrs(qrsDe(actual.datosPago), qrsDe(input.datosPago))
    return obtenerEvento(evento.id)
}

export async function eliminarEvento(id: number) {
    const evento = await obtenerEventoPorId(id)
    const [inscripciones, ponencias, asistencias] = await Promise.all([
        prisma.inscripcion.count({ where: { eventoId: id } }),
        prisma.ponencia.count({ where: { eventoId: id } }),
        prisma.asistencia.count({ where: { actividad: { eventoId: id } } }),
    ])
    if (inscripciones || ponencias || asistencias) {
        throw conflict('EVENT_HAS_INSCRIPTIONS', 'El evento tiene inscripciones, ponencias o asistencias; archívelo en lugar de eliminarlo.')
    }
    await prisma.$transaction([
        prisma.tipoInscripcion.deleteMany({ where: { categoria: { eventoId: id } } }),
        prisma.categoriaInscripcion.deleteMany({ where: { eventoId: id } }),
        prisma.actividad.deleteMany({ where: { eventoId: id } }),
        prisma.evento.delete({ where: { id } }),
    ])
    await limpiarQrs(qrsDe(evento.datosPago), new Set())
}

/** KPIs del evento para el panel. Sin `conPago` (Comisión) los montos van en null con las mismas claves. */
export async function resumenEvento(id: number, conPago = true) {
    await obtenerEventoPorId(id)
    const [estados, porEstado, porTipo, tipos, fechas, estudiantesUndc] = await Promise.all([
        prisma.estadoInscripcion.findMany({ orderBy: { id: 'asc' } }),
        prisma.inscripcion.groupBy({ by: ['estadoId'], where: { eventoId: id }, _count: { _all: true }, _sum: { monto: true } }),
        prisma.inscripcion.groupBy({ by: ['tipoInscripcionId', 'estadoId'], where: { eventoId: id }, _count: { _all: true }, _sum: { monto: true } }),
        prisma.tipoInscripcion.findMany({ where: { categoria: { eventoId: id } }, include: { categoria: true }, orderBy: [{ categoria: { orden: 'asc' } }, { orden: 'asc' }] }),
        prisma.inscripcion.findMany({ where: { eventoId: id }, select: { creadoEn: true } }),
        prisma.inscripcion.count({ where: { eventoId: id, esEstudianteUndc: true } }),
    ])

    const importe = (valor: number) => (conPago ? valor : null)
    const codigoDeEstado = new Map(estados.map((estado) => [estado.id, estado.codigo]))
    const resumenEstados = estados.map((estado) => {
        const fila = porEstado.find((item) => item.estadoId === estado.id)
        return { codigo: estado.codigo, nombre: estado.nombre, total: fila?._count._all ?? 0, monto: monto(fila?._sum.monto) }
    })
    const total = (codigo: string) => resumenEstados.find((item) => item.codigo === codigo)?.total ?? 0
    const montoDe = (codigo: string) => resumenEstados.find((item) => item.codigo === codigo)?.monto ?? 0

    const resumenTipos = tipos.map((tipo) => {
        const filas = porTipo.filter((item) => item.tipoInscripcionId === tipo.id)
        const aprobadas = filas.filter((item) => codigoDeEstado.get(item.estadoId) === 'APROBADO')
        return {
            tipoInscripcionId: tipo.id,
            nombre: tipo.nombre,
            etiqueta: tipo.etiqueta,
            categoria: tipo.categoria.codigo,
            total: filas.reduce((suma, item) => suma + item._count._all, 0),
            aprobadas: aprobadas.reduce((suma, item) => suma + item._count._all, 0),
            montoAprobado: importe(aprobadas.reduce((suma, item) => suma + monto(item._sum.monto), 0)),
        }
    })

    const dias = new Map<string, number>()
    for (const { creadoEn } of fechas) {
        const dia = fechaLima(creadoEn)
        dias.set(dia, (dias.get(dia) ?? 0) + 1)
    }

    return {
        totales: {
            inscripciones: fechas.length,
            pendientes: total('PENDIENTE'),
            enRevision: total('EN_REVISION'),
            aprobadas: total('APROBADO'),
            rechazadas: total('RECHAZADO'),
            canceladas: total('CANCELADO'),
            montoAprobado: importe(montoDe('APROBADO')),
            montoPendiente: importe(montoDe('PENDIENTE') + montoDe('EN_REVISION')),
            estudiantesUndc,
        },
        porEstado: resumenEstados.map((estado) => ({ ...estado, monto: importe(estado.monto) })),
        porTipo: resumenTipos,
        porDia: [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, cantidad]) => ({ fecha, total: cantidad })),
    }
}

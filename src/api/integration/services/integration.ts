import type { IntegracionEvento, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { cifrar, descifrar, sufijo } from '../../../core/crypto'
import { monto } from '../../../core/catalogos'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { eventoDeportes, IntegracionFallida, resumenDeportes, validarUrlBase, type ResumenDeportes } from './sports-client'
import type { ActualizarIntegracionInput, CrearIntegracionInput } from '../validation'

export function aIntegracion(i: IntegracionEvento) {
    return {
        id: i.id,
        eventoId: i.eventoId,
        tipo: i.tipo,
        nombre: i.nombre,
        urlBase: i.urlBase,
        tokenEnmascarado: `••••${i.tokenSufijo}`,
        activo: i.activo,
        ultimoEstado: i.ultimoEstado,
        ultimoError: i.ultimoError,
        ultimaSincronizacionEn: i.ultimaSincronizacionEn,
        creadoEn: i.creadoEn,
        actualizadoEn: i.actualizadoEn,
    }
}

async function obtener(id: number) {
    const integracion = await prisma.integracionEvento.findUnique({ where: { id } })
    if (!integracion) throw notFound('INTEGRATION_NOT_FOUND', 'La integración no existe.')
    return integracion
}

export async function listarIntegraciones(eventoId: number) {
    await obtenerEventoPorId(eventoId)
    const integraciones = await prisma.integracionEvento.findMany({ where: { eventoId }, orderBy: { id: 'asc' } })
    return integraciones.map(aIntegracion)
}

export async function crearIntegracion(eventoId: number, input: CrearIntegracionInput) {
    await obtenerEventoPorId(eventoId)
    const integracion = await prisma.integracionEvento.create({
        data: {
            eventoId,
            tipo: (input.tipo ?? 'DEPORTES_FI') as IntegracionEvento['tipo'],
            nombre: input.nombre,
            urlBase: validarUrlBase(input.urlBase),
            tokenCifrado: cifrar(input.token),
            tokenSufijo: sufijo(input.token),
            activo: input.activo ?? true,
        },
    })
    return aIntegracion(integracion)
}

export async function actualizarIntegracion(id: number, input: ActualizarIntegracionInput) {
    await obtener(id)
    const data: Prisma.IntegracionEventoUpdateInput = {}
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.urlBase !== undefined) data.urlBase = validarUrlBase(input.urlBase)
    if (input.token !== undefined) {
        data.tokenCifrado = cifrar(input.token)
        data.tokenSufijo = sufijo(input.token)
        data.ultimoEstado = null
        data.ultimoError = null
    }
    if (input.activo !== undefined) data.activo = input.activo
    return aIntegracion(await prisma.integracionEvento.update({ where: { id }, data }))
}

export async function eliminarIntegracion(id: number) {
    await obtener(id)
    await prisma.integracionEvento.delete({ where: { id } })
    cache.delete(id)
}

async function registrarEstado(id: number, error: string | null) {
    await prisma.integracionEvento.update({
        where: { id },
        data: error
            ? { ultimoEstado: 'ERROR', ultimoError: error.slice(0, 500) }
            : { ultimoEstado: 'OK', ultimoError: null, ultimaSincronizacionEn: new Date() },
    })
}

/** Prueba la conexión y devuelve el evento remoto al que pertenece el token. */
export async function probarIntegracion(id: number) {
    const integracion = await obtener(id)
    try {
        const evento = await eventoDeportes(integracion.urlBase, descifrar(integracion.tokenCifrado))
        await registrarEstado(id, null)
        return { ok: true, eventoRemoto: evento, integracion: aIntegracion(await obtener(id)) }
    } catch (error) {
        const mensaje = error instanceof IntegracionFallida ? error.message : 'Error inesperado'
        await registrarEstado(id, mensaje)
        return { ok: false, error: mensaje, integracion: aIntegracion(await obtener(id)) }
    }
}

// Caché en memoria de 60 s por integración para no saturar a deportes-fi
const TTL_CACHE_MS = 60 * 1000
const cache = new Map<number, { expira: number, resumen: ResumenDeportes }>()

async function resumenConCache(integracion: IntegracionEvento): Promise<ResumenDeportes> {
    const guardado = cache.get(integracion.id)
    if (guardado && guardado.expira > Date.now()) return guardado.resumen
    const resumen = await resumenDeportes(integracion.urlBase, descifrar(integracion.tokenCifrado))
    cache.set(integracion.id, { expira: Date.now() + TTL_CACHE_MS, resumen })
    return resumen
}

/** Resumen "Semana Sistémica": congreso (aprobado) + deportes (vouchers validados). */
export async function resumenSemanaSistemica(eventoId: number) {
    const evento = await obtenerEventoPorId(eventoId)
    const [aprobado, pendiente, totalInscripciones, integraciones] = await Promise.all([
        prisma.inscripcion.aggregate({ where: { eventoId, estado: { codigo: 'APROBADO' } }, _sum: { monto: true }, _count: { _all: true } }),
        prisma.inscripcion.aggregate({ where: { eventoId, estado: { codigo: { in: ['PENDIENTE', 'EN_REVISION'] } } }, _sum: { monto: true } }),
        prisma.inscripcion.count({ where: { eventoId } }),
        prisma.integracionEvento.findMany({ where: { eventoId, activo: true, tipo: 'DEPORTES_FI' }, orderBy: { id: 'asc' } }),
    ])

    const deportes = await Promise.all(integraciones.map(async (integracion) => {
        try {
            const resumen = await resumenConCache(integracion)
            await registrarEstado(integracion.id, null)
            return { integracionId: integracion.id, nombre: integracion.nombre, ok: true, resumen, error: null }
        } catch (error) {
            const mensaje = error instanceof IntegracionFallida ? error.message : 'Error inesperado'
            await registrarEstado(integracion.id, mensaje)
            return { integracionId: integracion.id, nombre: integracion.nombre, ok: false, resumen: null, error: mensaje }
        }
    }))

    const recaudadoCongreso = monto(aprobado._sum.monto)
    const recaudadoDeportes = deportes.reduce((suma, d) => suma + (d.resumen?.payments.validated.amount ?? 0), 0)
    const pendienteDeportes = deportes.reduce((suma, d) => suma + (d.resumen?.payments.pending.amount ?? 0), 0)
    const redondear = (valor: number) => Math.round(valor * 100) / 100

    return {
        evento: { id: evento.id, codigo: evento.codigo, nombreCorto: evento.nombreCorto },
        congreso: {
            inscripcionesTotales: totalInscripciones,
            inscripcionesAprobadas: aprobado._count._all,
            montoAprobado: recaudadoCongreso,
            montoPendiente: monto(pendiente._sum.monto),
        },
        deportes,
        totales: {
            recaudadoCongreso: redondear(recaudadoCongreso),
            recaudadoDeportes: redondear(recaudadoDeportes),
            recaudadoTotal: redondear(recaudadoCongreso + recaudadoDeportes),
            pendienteDeportes: redondear(pendienteDeportes),
        },
    }
}

import { prisma } from '../../../database/prisma'
import { leerArchivoServido, rutaCertificado } from '../../../core/almacenamiento'
import { notFound } from '../../../core/http-error'
import { esCodigoCertificado, normalizarDocumento, variantesDeDocumento } from './codigos'

/**
 * Consultas **sin sesión** de los certificados (spec 015) y el portal del inscrito. Solo salen los certificados con
 * su PDF (`LISTO`); los que faltan, los anulados y los que no existen responden el mismo 404. Nunca devuelven el
 * documento, el correo ni el celular: quien consulta con un DNI ya lo conoce, y el enlace directo lo puede reenviar
 * cualquiera.
 */

export const noEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'No encontramos certificados con esos datos.')

const seleccionPublica = {
    id: true,
    eventoId: true,
    codigo: true,
    tipo: true,
    nombreImpreso: true,
    archivo: true,
    subidoEn: true,
    evento: { select: { nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true } },
} as const

type FilaPublica = {
    codigo: string
    tipo: string
    nombreImpreso: string
    subidoEn: Date | null
    evento: { nombre: string, nombreCorto: string, fechaInicio: Date, fechaFin: Date }
}

const fecha = (valor: Date) => valor.toISOString().slice(0, 10)

export function aPublico(fila: FilaPublica) {
    return {
        codigo: fila.codigo,
        tipo: fila.tipo,
        titular: fila.nombreImpreso,
        evento: { nombre: fila.evento.nombre, nombreCorto: fila.evento.nombreCorto, fechaInicio: fecha(fila.evento.fechaInicio), fechaFin: fecha(fila.evento.fechaFin) },
        emitidoEn: fila.subidoEn,
    }
}

/** Todos los certificados listos de una persona, de cualquier evento, del más reciente al más antiguo. */
export async function certificadosDelDocumento(valor: unknown) {
    const documento = normalizarDocumento(valor)
    if (!documento) throw noEncontrado()
    const filas = await prisma.certificado.findMany({
        where: { estado: 'LISTO', numeroDocumento: { in: variantesDeDocumento(documento) } },
        select: seleccionPublica,
        orderBy: [{ evento: { fechaInicio: 'desc' } }, { tipo: 'asc' }],
        take: 100,
    })
    if (!filas.length) throw noEncontrado()
    return { titular: filas[0].nombreImpreso, certificados: filas.map(aPublico) }
}

async function listoPorCodigo(codigo: string) {
    // Un formato inválido no consulta la BD
    if (!esCodigoCertificado(codigo)) throw noEncontrado()
    const fila = await prisma.certificado.findUnique({ where: { codigo }, select: { ...seleccionPublica, estado: true } })
    // La collation binaria ya distingue mayúsculas; se compara igual por si la columna se creó sin ella
    if (!fila || fila.codigo !== codigo || fila.estado !== 'LISTO') throw noEncontrado()
    return fila
}

export async function certificadoPorCodigo(codigo: string) {
    return aPublico(await listoPorCodigo(codigo))
}

export async function archivoPorCodigo(codigo: string): Promise<{ contenido: Buffer, nombre: string }> {
    const fila = await listoPorCodigo(codigo)
    const ruta = rutaCertificado(fila.eventoId, fila.archivo)
    if (!ruta) throw noEncontrado()
    return { contenido: leerArchivoServido(ruta, noEncontrado), nombre: `certificado-${fila.codigo}.pdf` }
}

// ─── Portal del inscrito (`/v1/me/certificates`) ───────────────────────────

export async function certificadosDelParticipante(participanteId: number) {
    const filas = await prisma.certificado.findMany({
        where: { participanteId, estado: 'LISTO' },
        select: seleccionPublica,
        orderBy: [{ evento: { fechaInicio: 'desc' } }, { tipo: 'asc' }],
    })
    return filas.map((fila) => ({
        id: fila.id,
        codigoImpreso: fila.codigo,
        evento: { nombre: fila.evento.nombre, nombreCorto: fila.evento.nombreCorto },
        tipo: fila.tipo.charAt(0) + fila.tipo.slice(1).toLowerCase(),
        estado: 'FIRMADO',
        fechaEmision: fila.subidoEn ? fila.subidoEn.toISOString() : null,
        horas: null,
        descargable: true,
    }))
}

export async function archivoDelParticipante(participanteId: number, id: number) {
    const fila = await prisma.certificado.findFirst({ where: { id, participanteId, estado: 'LISTO' }, select: { eventoId: true, archivo: true, codigo: true } })
    const ruta = fila ? rutaCertificado(fila.eventoId, fila.archivo) : null
    if (!fila || !ruta) throw notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')
    return { contenido: leerArchivoServido(ruta, () => notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')), nombre: `certificado-${fila.codigo}.pdf` }
}

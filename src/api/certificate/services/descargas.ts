import type { PassThrough } from 'stream'
import { ZipFile } from 'yazl'
import type { EstadoCertificado, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { HttpError, notFound, unprocessable } from '../../../core/http-error'
import { fechaSoloDia } from '../../../core/fechas'
import { celdaCsv } from '../../inscription/services/inscription'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { exigirProveedorConfirmado } from '../codigos/proveedor'
import { existeArchivo, leerPdfCertificado, rutaFirmadoCompleto, rutaParaFirmar } from './archivos'
import { certificadoNoEncontrado, ESTADOS_CERTIFICADO } from './certificados'

/**
 * Descargas de certificados (spec 015).
 * - Para firmar (generado, o el firmado parcial si está EN_FIRMA): `certificados.operar` y el
 *   proveedor del código confirmado (409 `PROVIDER_NOT_CONFIRMED`): no se firma un código que luego
 *   haya que cambiar por el de la UNDC. Marca `descargadoParaFirmarEn`.
 * - Firmado (FIRMADO): `certificados.ver`.
 * - ZIP en flujo (yazl, sin comprimir los PDF): `<código>.pdf` + `manifiesto.csv` (el documento solo
 *   con `certificados.gestionar`), por partes de hasta 500 en orden de número. Cada parte se pide con
 *   el último número de la anterior (`despuesDe`, cursor): si mientras tanto otros certificados se
 *   firman o cambian, no se salta ninguno (con `skip` se corría la ventana).
 */
export type VersionArchivo = 'generado' | 'firmado'
export type VersionZip = 'para-firmar' | 'firmados'

const ESTADOS_PARA_FIRMAR: readonly EstadoCertificado[] = ['PREPARADO', 'EN_FIRMA']
const ESTADOS_FIRMADOS: readonly EstadoCertificado[] = ['FIRMADO']

export const POR_PARTE_DEFECTO = 200
export const POR_PARTE_MAXIMO = 500
const MAX_IDS_ZIP = 500

const SELECT_ARCHIVO = { id: true, eventoId: true, estado: true, codigo: true, archivoGenerado: true, archivoFirmado: true } as const

function sinArchivo(estado: EstadoCertificado, version: VersionArchivo): HttpError {
    if (version === 'generado') {
        if (estado === 'PENDIENTE') return notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado aún no se ha generado.')
        if (estado === 'FIRMADO') return notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado ya está firmado: descarga la versión firmada.')
        if (estado === 'ANULADO') return notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado está anulado.')
    } else if (estado !== 'FIRMADO') {
        return notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado aún no está firmado.')
    }
    return notFound('CERTIFICATE_FILE_NOT_FOUND', 'El archivo del certificado no está disponible.')
}

/**
 * `GET /v1/certificates/:id/file?version=generado|firmado`. `puedeOperar` decide si se puede
 * descargar para firmar (la ruta solo exige `certificados.ver`).
 */
export async function archivoCertificado(id: number, version: VersionArchivo, puedeOperar: boolean): Promise<{ pdf: Buffer, nombre: string }> {
    if (version === 'generado' && !puedeOperar) {
        throw new HttpError(403, 'FORBIDDEN', 'Descargar para firmar requiere el permiso «Generar, descargar para firmar y subir certificados firmados».')
    }
    const c = await prisma.certificado.findUnique({ where: { id }, select: SELECT_ARCHIVO })
    if (!c) throw certificadoNoEncontrado()
    if (version === 'firmado') {
        const ruta = rutaFirmadoCompleto(c)
        if (!ruta) throw sinArchivo(c.estado, version)
        return { pdf: leerPdfCertificado(ruta), nombre: `${c.codigo}.pdf` }
    }
    await exigirProveedorConfirmado()
    const ruta = rutaParaFirmar(c)
    if (!ruta) throw sinArchivo(c.estado, version)
    const pdf = leerPdfCertificado(ruta)
    // Se conserva la primera descarga: editar después pide confirmación
    await prisma.certificado.updateMany({ where: { id, descargadoParaFirmarEn: null }, data: { descargadoParaFirmarEn: new Date() } })
    return { pdf, nombre: `${c.codigo}.pdf` }
}

// ─── ZIP ────────────────────────────────────────────────────────────────────

export interface OpcionesZip {
    version: VersionZip
    estado?: EstadoCertificado[]
    tipo?: string
    ids?: number[]
    /** Cursor: solo certificados con número mayor (0 = desde el primero). */
    despuesDe: number
    porParte: number
}

const invalido = (campo: string, mensaje: string) => unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { [campo]: mensaje })

function entero(valor: unknown, campo: string, minimo: number, maximo: number, porDefecto: number): number {
    if (valor === undefined || valor === '') return porDefecto
    const n = Number(valor)
    if (!Number.isSafeInteger(n) || n < minimo || n > maximo) throw invalido(campo, `Debe ser un entero de ${minimo} a ${maximo}`)
    return n
}

/** Lee y valida la query del ZIP (422 `VALIDATION_ERROR` con el campo). */
export function leerOpcionesZip(query: Record<string, unknown>): OpcionesZip {
    const version = query.version
    if (version !== 'para-firmar' && version !== 'firmados') throw invalido('version', 'Usa para-firmar o firmados')
    const opciones: OpcionesZip = {
        version,
        despuesDe: entero(query.despuesDe, 'despuesDe', 0, 999_999, 0),
        porParte: entero(query.porParte, 'porParte', 1, POR_PARTE_MAXIMO, POR_PARTE_DEFECTO),
    }
    const permitidos = version === 'para-firmar' ? ESTADOS_PARA_FIRMAR : ESTADOS_FIRMADOS
    if (typeof query.estado === 'string' && query.estado.trim()) {
        const estados = [...new Set(query.estado.split(',').map((e) => e.trim().toUpperCase()).filter(Boolean))]
        if (!estados.every((e) => (permitidos as readonly string[]).includes(e))) throw invalido('estado', `Con ${version} usa ${permitidos.join(', ')}`)
        opciones.estado = estados as EstadoCertificado[]
    }
    if (typeof query.tipo === 'string' && query.tipo.trim()) opciones.tipo = query.tipo.trim().toUpperCase().slice(0, 40)
    if (typeof query.ids === 'string' && query.ids.trim()) {
        const ids = query.ids.split(',').map((v) => Number(v.trim()))
        if (ids.length > MAX_IDS_ZIP || !ids.every((n) => Number.isSafeInteger(n) && n > 0)) throw invalido('ids', `Hasta ${MAX_IDS_ZIP} ids separados por comas`)
        opciones.ids = [...new Set(ids)]
    }
    return opciones
}

const SELECT_ZIP = {
    ...SELECT_ARCHIVO,
    numero: true,
    codigoImpreso: true,
    nombreImpreso: true,
    tipoDocumento: true,
    numeroDocumento: true,
    detalle: true,
    horas: true,
    fechaEmision: true,
    firmasDetectadas: true,
    tipo: { select: { codigo: true } },
    plantilla: { select: { nombre: true, firmasRequeridas: true } },
} satisfies Prisma.CertificadoSelect

type FilaZip = Prisma.CertificadoGetPayload<{ select: typeof SELECT_ZIP }>

function manifiesto(filas: { fila: FilaZip, archivo: string | null }[], conDocumento: boolean): Buffer {
    const columnas: Array<{ titulo: string, documento?: true, valor: (f: FilaZip, archivo: string | null) => unknown }> = [
        { titulo: 'Archivo', valor: (_f, archivo) => archivo },
        { titulo: 'Código', valor: (f) => f.codigo },
        { titulo: 'Código impreso', valor: (f) => f.codigoImpreso },
        { titulo: 'Estado', valor: (f) => f.estado },
        { titulo: 'Tipo', valor: (f) => f.tipo.codigo },
        { titulo: 'Nombre', valor: (f) => f.nombreImpreso },
        { titulo: 'Tipo doc.', documento: true, valor: (f) => f.tipoDocumento.toUpperCase() },
        { titulo: 'N° documento', documento: true, valor: (f) => f.numeroDocumento },
        { titulo: 'Detalle', valor: (f) => f.detalle },
        { titulo: 'Horas', valor: (f) => f.horas },
        { titulo: 'Fecha de emisión', valor: (f) => fechaSoloDia(f.fechaEmision) },
        { titulo: 'Plantilla', valor: (f) => f.plantilla?.nombre },
        { titulo: 'Firmas detectadas', valor: (f) => f.firmasDetectadas },
        { titulo: 'Firmas requeridas', valor: (f) => f.plantilla?.firmasRequeridas },
        { titulo: 'Observación', valor: (_f, archivo) => (archivo ? '' : 'El archivo no está en el servidor: regenera o vuelve a subir este certificado') },
    ]
    const visibles = columnas.filter((c) => conDocumento || !c.documento)
    const lineas = filas.map(({ fila, archivo }) => visibles.map((c) => celdaCsv(c.valor(fila, archivo))).join(';'))
    return Buffer.from('﻿' + [visibles.map((c) => c.titulo).join(';'), ...lineas].join('\r\n') + '\r\n', 'utf8')
}

export interface ZipPreparado {
    salida: NodeJS.ReadableStream
    nombre: string
    /** Certificados que cumplen el filtro (todas las partes, en este momento). */
    total: number
    /** Certificados de esta parte (con o sin archivo) y PDF incluidos. */
    certificados: number
    archivos: number
    /** Primer y último número de esta parte; el último es el `despuesDe` de la siguiente. */
    desdeNumero: number
    hastaNumero: number
    /** Certificados que cumplen el filtro después de esta parte. */
    restantes: number
}

const nombreSeguro = (texto: string) => texto.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'evento'

/**
 * `GET /v1/events/:eventId/certificates/zip`: prepara la parte pedida (los `porParte` siguientes a
 * `despuesDe`, por número) y devuelve el flujo del ZIP. Los archivos que no estén en disco se omiten y
 * se señalan en el manifiesto; sin ningún PDF → 422 `NOTHING_TO_DOWNLOAD`.
 */
export async function prepararZip(eventoId: number, opciones: OpcionesZip, conDocumento: boolean): Promise<ZipPreparado> {
    const evento = await obtenerEventoPorId(eventoId)
    if (opciones.version === 'para-firmar') await exigirProveedorConfirmado()
    const estados = opciones.estado ?? [...(opciones.version === 'para-firmar' ? ESTADOS_PARA_FIRMAR : ESTADOS_FIRMADOS)]
    const where: Prisma.CertificadoWhereInput = {
        eventoId,
        estado: { in: estados.filter((e) => ESTADOS_CERTIFICADO.includes(e)) },
        ...(opciones.tipo ? { tipo: { codigo: opciones.tipo } } : {}),
        ...(opciones.ids ? { id: { in: opciones.ids } } : {}),
    }
    const total = await prisma.certificado.count({ where })
    const nada = (mensaje: string) => unprocessable('NOTHING_TO_DOWNLOAD', mensaje)
    if (!total) throw nada(opciones.version === 'para-firmar' ? 'No hay certificados generados para firmar con ese filtro.' : 'No hay certificados firmados con ese filtro.')

    const filas = await prisma.certificado.findMany({
        where: { ...where, numero: { gt: opciones.despuesDe } },
        select: SELECT_ZIP,
        orderBy: { numero: 'asc' },
        take: opciones.porParte,
    })
    if (!filas.length) throw nada(`No quedan certificados después del número ${opciones.despuesDe}.`)
    const desdeNumero = filas[0].numero
    const hastaNumero = filas[filas.length - 1].numero
    const restantes = await prisma.certificado.count({ where: { ...where, numero: { gt: hastaNumero } } })

    const entradas = filas.map((fila) => {
        const ruta = opciones.version === 'para-firmar' ? rutaParaFirmar(fila) : rutaFirmadoCompleto(fila)
        return { fila, ruta: existeArchivo(ruta) ? ruta : null }
    })
    const incluidas = entradas.filter((e) => e.ruta)
    if (!incluidas.length) throw nada('Los archivos de estos certificados no están en el servidor: regenéralos o vuelve a subirlos.')

    if (opciones.version === 'para-firmar') {
        await prisma.certificado.updateMany({
            where: { id: { in: incluidas.map((e) => e.fila.id) }, descargadoParaFirmarEn: null },
            data: { descargadoParaFirmarEn: new Date() },
        })
    }

    const zip = new ZipFile()
    // Un archivo que otra petición borra entre tanto: yazl emite 'error' (sin oyente tumbaría el
    // proceso); se corta el flujo y la respuesta queda incompleta
    zip.on('error', (error: Error) => (zip.outputStream as PassThrough).destroy(error))
    zip.addBuffer(manifiesto(entradas.map((e) => ({ fila: e.fila, archivo: e.ruta ? `${e.fila.codigo}.pdf` : null })), conDocumento), 'manifiesto.csv')
    // Los PDF ya están comprimidos por dentro: se guardan tal cual (más rápido y sin cambiar sus bytes)
    for (const e of incluidas) zip.addFile(e.ruta as string, `${e.fila.codigo}.pdf`, { compress: false })
    zip.end()

    const sufijo = opciones.despuesDe > 0 || restantes > 0 ? `-${desdeNumero}-a-${hastaNumero}` : ''
    return {
        salida: zip.outputStream,
        nombre: `certificados-${nombreSeguro(evento.codigo)}-${opciones.version}${sufijo}.zip`,
        total,
        certificados: filas.length,
        archivos: incluidas.length,
        desdeNumero,
        hastaNumero,
        restantes,
    }
}

import crypto from 'crypto'
import fs from 'fs'
import { Prisma, type EstadoCertificado } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { guardarAtomico, leerArchivoServido, nuevoNombreCertificado, rutaCertificado } from '../../../core/almacenamiento'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { codigoDeNombreArchivo, contarFirmas, esPdf } from './codigos'

/**
 * Certificados del evento para el staff (spec 015): listado con su situación, carga de los PDF firmados
 * (emparejados por el código del nombre del archivo) y anulación.
 */

/** Lo que ve el staff: «Falta PDF», «Listo para entregar», «Entregado» (correo enviado) y «Anulado». */
export const SITUACIONES = ['FALTA_PDF', 'POR_ENTREGAR', 'ENTREGADO', 'ANULADO'] as const
export type Situacion = typeof SITUACIONES[number]

export function situacionDe(certificado: { estado: EstadoCertificado, enviadoEn: Date | null }): Situacion {
    if (certificado.estado === 'ANULADO') return 'ANULADO'
    if (certificado.estado === 'SIN_ARCHIVO') return 'FALTA_PDF'
    return certificado.enviadoEn ? 'ENTREGADO' : 'POR_ENTREGAR'
}

function condicionSituacion(situacion: Situacion): Prisma.CertificadoWhereInput {
    switch (situacion) {
        case 'FALTA_PDF': return { estado: 'SIN_ARCHIVO' }
        case 'POR_ENTREGAR': return { estado: 'LISTO', enviadoEn: null }
        case 'ENTREGADO': return { estado: 'LISTO', enviadoEn: { not: null } }
        case 'ANULADO': return { estado: 'ANULADO' }
    }
}

export interface FiltrosCertificados {
    situacion?: Situacion
    q?: string
    /** `true`: solo los que no tienen inscripción pagada en el evento. */
    sinInscripcion?: boolean
}

function condicion(eventoId: number, filtros: FiltrosCertificados): Prisma.CertificadoWhereInput {
    const and: Prisma.CertificadoWhereInput[] = [{ eventoId }]
    // Sin filtro de situación no salen los anulados (se ven con su filtro)
    and.push(filtros.situacion ? condicionSituacion(filtros.situacion) : { NOT: { estado: 'ANULADO' } })
    if (filtros.sinInscripcion) and.push({ inscripcionId: null })
    if (filtros.q) {
        const q = filtros.q
        and.push({
            OR: [
                { nombreImpreso: { contains: q } },
                { numeroDocumento: { contains: q } },
                { codigo: { contains: q } },
                { participante: { correo: { contains: q } } },
            ],
        })
    }
    return { AND: and }
}

const seleccion = {
    id: true,
    codigo: true,
    tipo: true,
    estado: true,
    nombreImpreso: true,
    numeroDocumento: true,
    observacion: true,
    inscripcionId: true,
    firmasDetectadas: true,
    bytesArchivo: true,
    subidoEn: true,
    enviadoEn: true,
    envioError: true,
    anuladoEn: true,
    motivoAnulacion: true,
    creadoEn: true,
    participante: { select: { id: true, correo: true, celular: true } },
} satisfies Prisma.CertificadoSelect

type FilaCertificado = Prisma.CertificadoGetPayload<{ select: typeof seleccion }>

export function aFila(certificado: FilaCertificado) {
    return {
        id: certificado.id,
        codigo: certificado.codigo,
        tipo: certificado.tipo,
        estado: certificado.estado,
        situacion: situacionDe(certificado),
        nombre: certificado.nombreImpreso,
        documento: certificado.numeroDocumento,
        correo: certificado.participante.correo,
        celular: certificado.participante.celular || null,
        participanteId: certificado.participante.id,
        conInscripcion: certificado.inscripcionId !== null,
        observacion: certificado.observacion,
        tieneArchivo: certificado.estado === 'LISTO',
        firmasDetectadas: certificado.firmasDetectadas,
        bytesArchivo: certificado.bytesArchivo,
        subidoEn: certificado.subidoEn,
        enviadoEn: certificado.enviadoEn,
        envioError: certificado.envioError,
        anuladoEn: certificado.anuladoEn,
        motivoAnulacion: certificado.motivoAnulacion,
        creadoEn: certificado.creadoEn,
    }
}

export interface ResumenCertificados {
    total: number
    faltaPdf: number
    porEntregar: number
    entregados: number
    anulados: number
    sinInscripcion: number
    /** Inscripciones APROBADO del evento sin un certificado vigente. */
    pagadosSinCertificado: number
}

/** Totales del evento entero (no dependen de los filtros). */
export async function resumenCertificados(eventoId: number): Promise<ResumenCertificados> {
    const [porEstado, entregados, sinInscripcion, pagadosSinCertificado] = await Promise.all([
        prisma.certificado.groupBy({ by: ['estado'], where: { eventoId }, _count: { _all: true } }),
        prisma.certificado.count({ where: { eventoId, estado: 'LISTO', enviadoEn: { not: null } } }),
        prisma.certificado.count({ where: { eventoId, inscripcionId: null, NOT: { estado: 'ANULADO' } } }),
        prisma.inscripcion.count({ where: condicionPagadosSinCertificado(eventoId) }),
    ])
    const cuenta = (estado: EstadoCertificado) => porEstado.find((fila) => fila.estado === estado)?._count._all ?? 0
    const listos = cuenta('LISTO')
    return {
        total: cuenta('SIN_ARCHIVO') + listos,
        faltaPdf: cuenta('SIN_ARCHIVO'),
        porEntregar: listos - entregados,
        entregados,
        anulados: cuenta('ANULADO'),
        sinInscripcion,
        pagadosSinCertificado,
    }
}

export async function listarCertificados(eventoId: number, filtros: FiltrosCertificados, paginacion: Pagination) {
    const where = condicion(eventoId, filtros)
    const [filas, total, resumen] = await Promise.all([
        prisma.certificado.findMany({ where, select: seleccion, orderBy: [{ nombreImpreso: 'asc' }, { id: 'asc' }], skip: paginacion.skip, take: paginacion.take }),
        prisma.certificado.count({ where }),
        resumenCertificados(eventoId),
    ])
    return { data: filas.map(aFila), meta: { ...pageMeta(paginacion, total), resumen } }
}

/** Máximo de ids que se devuelven para elegir «todos» (el panel los envía en tandas). */
export const MAXIMO_IDS = 5000

export async function idsCertificados(eventoId: number, filtros: FiltrosCertificados) {
    const filas = await prisma.certificado.findMany({ where: condicion(eventoId, filtros), select: { id: true }, orderBy: [{ nombreImpreso: 'asc' }, { id: 'asc' }], take: MAXIMO_IDS })
    return filas.map((fila) => fila.id)
}

export async function detalleCertificado(eventoId: number, id: number) {
    const certificado = await prisma.certificado.findFirst({ where: { id, eventoId }, select: seleccion })
    if (!certificado) throw certificadoNoEncontrado()
    return aFila(certificado)
}

// ─── Inscritos que pagaron y no vinieron en el Excel ───────────────────────

function condicionPagadosSinCertificado(eventoId: number): Prisma.InscripcionWhereInput {
    return { eventoId, estado: { codigo: 'APROBADO' }, certificados: { none: { NOT: { estado: 'ANULADO' } } } }
}

export async function listarPagadosSinCertificado(eventoId: number, q: string | undefined, paginacion: Pagination) {
    const where: Prisma.InscripcionWhereInput = {
        AND: [
            condicionPagadosSinCertificado(eventoId),
            ...(q ? [{ participante: { OR: [{ nombres: { contains: q } }, { apellidos: { contains: q } }, { numeroDocumento: { contains: q } }, { correo: { contains: q } }] } }] : []),
        ],
    }
    const [filas, total] = await Promise.all([
        prisma.inscripcion.findMany({
            where,
            select: {
                id: true,
                participante: { select: { id: true, nombres: true, apellidos: true, numeroDocumento: true, correo: true } },
                tipoInscripcion: { select: { nombre: true } },
            },
            orderBy: [{ participante: { apellidos: 'asc' } }, { id: 'asc' }],
            skip: paginacion.skip,
            take: paginacion.take,
        }),
        prisma.inscripcion.count({ where }),
    ])
    return {
        data: filas.map((fila) => ({
            inscripcionId: fila.id,
            participanteId: fila.participante.id,
            nombre: `${fila.participante.nombres} ${fila.participante.apellidos}`.trim(),
            documento: fila.participante.numeroDocumento,
            correo: fila.participante.correo,
            tipoInscripcion: fila.tipoInscripcion?.nombre ?? null,
        })),
        meta: pageMeta(paginacion, total),
    }
}

// ─── PDF firmados ───────────────────────────────────────────────────────────

export const certificadoNoEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')

export type ResultadoArchivo =
    | 'ASOCIADO'
    | 'REEMPLAZADO'
    | 'YA_TENIA'
    | 'TIENE_OTRO'
    | 'NO_ENCONTRADO'
    | 'ANULADO'
    | 'NOMBRE_INVALIDO'
    | 'NO_ES_PDF'
    | 'DUPLICADO'

export interface ArchivoSubido {
    nombreOriginal: string
    contenido: Buffer
}

export interface DetalleArchivo {
    archivo: string
    codigo: string | null
    resultado: ResultadoArchivo
    certificadoId: number | null
    nombre: string | null
    firmas: number
}

const hashDe = (contenido: Buffer) => crypto.createHash('sha256').update(contenido).digest('hex')

/** Nombre que llega del navegador, recortado (solo se usa en la respuesta, nunca en una ruta de disco). */
const nombreVisible = (nombre: string) => String(nombre ?? '').slice(0, 200)

type CertificadoArchivo = { id: number, eventoId: number, estado: EstadoCertificado, archivo: string | null, hashArchivo: string | null, nombreImpreso: string }

/**
 * Guarda el PDF y lo asocia al certificado. La actualización está condicionada al archivo que se leyó: si otra
 * petición lo cambió en medio, esta no pisa a aquella (su archivo se borra y responde conflicto).
 */
async function asociar(certificado: CertificadoArchivo, contenido: Buffer, actorId: number): Promise<number> {
    const archivo = nuevoNombreCertificado()
    const ruta = rutaCertificado(certificado.eventoId, archivo)
    if (!ruta) throw new Error('Nombre de certificado inválido')
    await guardarAtomico(ruta, contenido)
    const firmas = contarFirmas(contenido)
    const { count } = await prisma.certificado.updateMany({
        where: { id: certificado.id, archivo: certificado.archivo, NOT: { estado: 'ANULADO' } },
        data: {
            archivo,
            hashArchivo: hashDe(contenido),
            bytesArchivo: contenido.length,
            firmasDetectadas: firmas,
            estado: 'LISTO',
            subidoEn: new Date(),
            subidoPorId: actorId,
        },
    })
    if (count !== 1) {
        await fs.promises.unlink(ruta).catch(() => undefined)
        throw conflict('CERTIFICATE_CHANGED', 'El certificado cambió mientras se subía su PDF. Vuelve a intentarlo.')
    }
    const anterior = rutaCertificado(certificado.eventoId, certificado.archivo)
    if (anterior) await fs.promises.unlink(anterior).catch(() => undefined)
    return firmas
}

/**
 * Sube varios PDF firmados y empareja cada uno por el código de su nombre (`<codigo>[R][R][R].pdf`). Sin
 * `reemplazar`, un certificado que ya tiene otro PDF no se toca (`TIENE_OTRO`); el mismo PDF otra vez es `YA_TENIA`.
 */
export async function subirArchivos(eventoId: number, archivos: readonly ArchivoSubido[], opciones: { reemplazar: boolean, actorId: number }) {
    const detalle: DetalleArchivo[] = []
    const codigos = archivos.map((archivo) => codigoDeNombreArchivo(archivo.nombreOriginal))
    const validos = [...new Set(codigos.filter((codigo): codigo is string => codigo !== null))]
    const encontrados = validos.length
        ? await prisma.certificado.findMany({
            where: { eventoId, codigo: { in: validos } },
            select: { id: true, eventoId: true, codigo: true, estado: true, archivo: true, hashArchivo: true, nombreImpreso: true },
        })
        : []
    // La columna distingue mayúsculas; se compara igual en memoria
    const porCodigo = new Map(encontrados.map((certificado) => [certificado.codigo, certificado]))
    const usados = new Set<string>()

    for (const [indice, archivo] of archivos.entries()) {
        const codigo = codigos[indice]
        const base = { archivo: nombreVisible(archivo.nombreOriginal), codigo, certificadoId: null, nombre: null, firmas: 0 }
        if (!codigo) {
            detalle.push({ ...base, resultado: 'NOMBRE_INVALIDO' })
            continue
        }
        if (usados.has(codigo)) {
            detalle.push({ ...base, resultado: 'DUPLICADO' })
            continue
        }
        usados.add(codigo)
        if (!esPdf(archivo.contenido)) {
            detalle.push({ ...base, resultado: 'NO_ES_PDF' })
            continue
        }
        const certificado = porCodigo.get(codigo)
        if (!certificado) {
            detalle.push({ ...base, resultado: 'NO_ENCONTRADO' })
            continue
        }
        const conCertificado = { ...base, certificadoId: certificado.id, nombre: certificado.nombreImpreso }
        if (certificado.estado === 'ANULADO') {
            detalle.push({ ...conCertificado, resultado: 'ANULADO' })
            continue
        }
        if (certificado.archivo && certificado.hashArchivo === hashDe(archivo.contenido)) {
            detalle.push({ ...conCertificado, resultado: 'YA_TENIA', firmas: contarFirmas(archivo.contenido) })
            continue
        }
        if (certificado.archivo && !opciones.reemplazar) {
            detalle.push({ ...conCertificado, resultado: 'TIENE_OTRO' })
            continue
        }
        const firmas = await asociar(certificado, archivo.contenido, opciones.actorId)
        detalle.push({ ...conCertificado, resultado: certificado.archivo ? 'REEMPLAZADO' : 'ASOCIADO', firmas })
    }

    const cuenta = (resultado: ResultadoArchivo) => detalle.filter((d) => d.resultado === resultado).length
    const resumen = {
        asociados: cuenta('ASOCIADO'),
        reemplazados: cuenta('REEMPLAZADO'),
        yaTenia: cuenta('YA_TENIA'),
        tieneOtro: cuenta('TIENE_OTRO'),
        noEncontrados: cuenta('NO_ENCONTRADO'),
        anulados: cuenta('ANULADO'),
        nombreInvalido: cuenta('NOMBRE_INVALIDO'),
        noEsPdf: cuenta('NO_ES_PDF'),
        duplicados: cuenta('DUPLICADO'),
    }
    console.info(`[certificados] La cuenta ${opciones.actorId} subió ${resumen.asociados + resumen.reemplazados} PDF de ${archivos.length} en el evento ${eventoId}`)
    return { resumen, detalle }
}

/** Sube el PDF de un certificado elegido a mano (el nombre del archivo no importa). Reemplaza el anterior. */
export async function subirArchivoDe(eventoId: number, id: number, archivo: ArchivoSubido, actorId: number) {
    if (!esPdf(archivo.contenido)) throw unprocessable('INVALID_FILE_CONTENT', 'El archivo no es un PDF.')
    const certificado = await prisma.certificado.findFirst({
        where: { id, eventoId },
        select: { id: true, eventoId: true, estado: true, archivo: true, hashArchivo: true, nombreImpreso: true },
    })
    if (!certificado) throw certificadoNoEncontrado()
    if (certificado.estado === 'ANULADO') throw conflict('CERTIFICATE_ANNULLED', 'El certificado está anulado.')
    await asociar(certificado, archivo.contenido, actorId)
    return detalleCertificado(eventoId, id)
}

/** El PDF guardado de un certificado (de cualquier estado, para el staff). */
export async function archivoDe(eventoId: number, id: number): Promise<{ contenido: Buffer, nombre: string }> {
    const certificado = await prisma.certificado.findFirst({ where: { id, eventoId }, select: { eventoId: true, archivo: true, codigo: true } })
    const ruta = certificado ? rutaCertificado(certificado.eventoId, certificado.archivo) : null
    if (!certificado || !ruta) throw notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado aún no tiene su PDF firmado.')
    return { contenido: leerArchivoServido(ruta, () => notFound('CERTIFICATE_FILE_NOT_FOUND', 'El certificado aún no tiene su PDF firmado.')), nombre: `certificado-${certificado.codigo}.pdf` }
}

/** Anula: deja de salir en la consulta pública y en el portal. Conserva el PDF por si hay que revisarlo. */
export async function anularCertificado(eventoId: number, id: number, motivo: string, actorId: number) {
    const { count } = await prisma.certificado.updateMany({
        where: { id, eventoId, NOT: { estado: 'ANULADO' } },
        data: { estado: 'ANULADO', claveVigente: null, anuladoEn: new Date(), anuladoPorId: actorId, motivoAnulacion: motivo },
    })
    if (count !== 1) {
        const existe = await prisma.certificado.findFirst({ where: { id, eventoId }, select: { id: true } })
        if (!existe) throw certificadoNoEncontrado()
        throw conflict('CERTIFICATE_ALREADY_ANNULLED', 'El certificado ya estaba anulado.')
    }
    console.info(`[certificados] La cuenta ${actorId} anuló el certificado ${id} del evento ${eventoId}`)
    return detalleCertificado(eventoId, id)
}

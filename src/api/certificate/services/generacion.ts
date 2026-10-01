import type { EstadoCertificado, Evento, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { HttpError, unprocessable } from '../../../core/http-error'
import { limitarConcurrencia } from '../../../core/concurrencia'
import { configuracionCertificados, urlVerificacionCertificado } from '../../../core/configuracion-sistema'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { nuevaGeneracion } from '../codigos/codigo'
import { proveedorPorCodigo, type ImpresionCertificado } from '../codigos/proveedor'
import { estampar } from '../pdf/estampar'
import { sha256 } from '../pdf/firmas'
import { TIPOS_CAMPO, type AvisoEstampado, type CampoPlantilla, type DatosCertificado } from '../pdf/tipos'
import { borrarGenerado, guardarGenerado, leerDisenoPlantilla } from './archivos'
import { documentoImpreso } from './certificados'
import { MAX_IDS_GENERACION, type GenerarCertificadosInput } from '../validation/certificados'

/**
 * Generación de los PDF (spec 015): síncrona, en tandas de hasta 10 que el panel va pidiendo. Es
 * idempotente (solo genera los PENDIENTE; lo demás se omite) y reanudable (`pendientes` con el
 * cursor `despuesDeId`, para no repetir en bucle los que fallan).
 *
 * Al generar se congelan el código impreso (proveedor; LOCAL: el mismo código) y la URL de
 * verificación (`<url_panel>/verificar/<código>`): regenerar tras una edición conserva ambos. Cada
 * archivo lleva una generación nueva (va en el `Subject` y en el nombre) y la fila se actualiza solo
 * si nadie la cambió entre tanto (optimista); si se pierde la carrera, el archivo nuevo se borra.
 * Un certificado con firmas nunca se regenera.
 */

/** Como mucho 2 tandas a la vez en el proceso (pdf-lib ocupa la CPU) y 4 esperando. */
const limitarGeneracion = limitarConcurrencia(2, 4, () => new HttpError(
    503, 'GENERATION_BUSY', 'Hay otras tandas de certificados generándose. Intenta nuevamente en unos segundos.', undefined, 5,
))

const SELECT_GENERACION = {
    id: true,
    eventoId: true,
    estado: true,
    codigo: true,
    codigoImpreso: true,
    codigoExterno: true,
    urlVerificacion: true,
    generacion: true,
    archivoGenerado: true,
    nombreImpreso: true,
    tipoDocumento: true,
    numeroDocumento: true,
    detalle: true,
    horas: true,
    fechaEmision: true,
    actualizadoEn: true,
    tipo: { select: { textoImpreso: true } },
    plantilla: { select: { id: true, archivoDiseno: true, campos: true, version: true } },
} satisfies Prisma.CertificadoSelect

type CertificadoParaGenerar = Prisma.CertificadoGetPayload<{ select: typeof SELECT_GENERACION }>

export type ResultadoGeneracion = 'GENERADO' | 'OMITIDO' | 'ERROR'

export interface Procesado {
    id: number
    codigo: string | null
    resultado: ResultadoGeneracion
    estado: EstadoCertificado | null
    avisos: AvisoEstampado[]
    /** Código del error u omisión (`TEMPLATE_REQUIRED`, `CERTIFICATE_NOT_FOUND`…). */
    codigoError: string | null
    mensaje: string | null
}

const MOTIVO_OMISION: Partial<Record<EstadoCertificado, string>> = {
    PREPARADO: 'Ya está generado (para regenerarlo, edítalo).',
    EN_FIRMA: 'Ya tiene firmas: no se regenera.',
    FIRMADO: 'Ya está firmado: no se regenera.',
    ANULADO: 'Está anulado.',
}

function procesado(c: Pick<CertificadoParaGenerar, 'id' | 'codigo' | 'estado'>, resultado: ResultadoGeneracion, extra: Partial<Procesado> = {}): Procesado {
    return { id: c.id, codigo: c.codigo, resultado, estado: c.estado, avisos: [], codigoError: null, mensaje: null, ...extra }
}

/** Campos guardados de la plantilla (validados al guardarla); descarta lo que no tenga la forma mínima. */
export function camposDe(valor: Prisma.JsonValue): CampoPlantilla[] {
    if (!Array.isArray(valor)) return []
    return valor.filter((campo): campo is Prisma.JsonObject => {
        if (!campo || typeof campo !== 'object' || Array.isArray(campo)) return false
        const c = campo as Record<string, unknown>
        return (TIPOS_CAMPO as readonly unknown[]).includes(c.tipo)
            && [c.pagina, c.x, c.y].every((n) => typeof n === 'number' && Number.isFinite(n))
    }) as unknown as CampoPlantilla[]
}

/** Cede el turno al event loop entre certificado y certificado (el estampado es CPU síncrona). */
const cederTurno = () => new Promise<void>((resolve) => setImmediate(resolve))

interface Preparado {
    certificado: CertificadoParaGenerar
    impresion: ImpresionCertificado
    url: string
}

const LARGO_MAXIMO_URL = 255

/**
 * Código impreso y URL de cada certificado ANTES de generar ninguno: un proveedor pendiente (501
 * `CERTIFICATE_PROVIDER_PENDING`) o la falta de URL del panel (422 `VERIFICATION_URL_NOT_CONFIGURED`)
 * responden a toda la solicitud. Lo ya congelado en una generación anterior se conserva.
 */
async function preparar(certificados: CertificadoParaGenerar[]): Promise<Preparado[]> {
    if (!certificados.length) return []
    const configuracion = await configuracionCertificados()
    const proveedor = proveedorPorCodigo(configuracion.proveedor)
    const preparados: Preparado[] = []
    for (const certificado of certificados) {
        const impresion = certificado.codigoImpreso
            ? { codigoImpreso: certificado.codigoImpreso, codigoExterno: certificado.codigoExterno }
            : await proveedor.resolverImpresion({ id: certificado.id, eventoId: certificado.eventoId, codigo: certificado.codigo, codigoExterno: certificado.codigoExterno })
        const url = certificado.urlVerificacion ?? urlVerificacionCertificado(configuracion.baseVerificacion, impresion.codigoImpreso)
        if (url.length > LARGO_MAXIMO_URL) {
            throw unprocessable('VERIFICATION_URL_TOO_LONG', `La URL de verificación supera ${LARGO_MAXIMO_URL} caracteres: acorta la URL del panel en Sistema.`)
        }
        preparados.push({ certificado, impresion, url })
    }
    return preparados
}

function datosDe(evento: Evento, p: Preparado): DatosCertificado {
    const c = p.certificado
    return {
        nombre: c.nombreImpreso,
        tipo: c.tipo.textoImpreso,
        codigo: p.impresion.codigoImpreso,
        fechaEmision: c.fechaEmision,
        horas: c.horas,
        evento: evento.nombre,
        eventoCorto: evento.nombreCorto,
        documento: documentoImpreso(c.tipoDocumento, c.numeroDocumento),
        detalle: c.detalle,
        urlVerificacion: p.url,
    }
}

function descripcion(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'error desconocido'
}

async function generarUno(evento: Evento, p: Preparado, disenos: Map<number, Uint8Array | null>): Promise<Procesado> {
    const c = p.certificado
    const plantilla = c.plantilla
    if (!plantilla) return procesado(c, 'ERROR', { codigoError: 'TEMPLATE_REQUIRED', mensaje: 'El certificado no tiene plantilla: asígnale una editándolo.' })
    if (!disenos.has(plantilla.id)) disenos.set(plantilla.id, await leerDisenoPlantilla(plantilla.archivoDiseno))
    const diseno = disenos.get(plantilla.id)
    if (!diseno) return procesado(c, 'ERROR', { codigoError: 'TEMPLATE_FILE_MISSING', mensaje: 'No se encontró el PDF de diseño de la plantilla: vuelve a subirlo.' })

    const generacion = nuevaGeneracion()
    let archivo: string | null = null
    try {
        const { bytes, avisos } = await estampar({ diseno, campos: camposDe(plantilla.campos), datos: datosDe(evento, p), codigo: c.codigo, generacion })
        archivo = await guardarGenerado(c.eventoId, c.codigo, generacion, bytes)
        // Optimista: solo si sigue PENDIENTE y nadie la editó desde que se leyó
        const { count } = await prisma.certificado.updateMany({
            where: { id: c.id, estado: 'PENDIENTE', generacion: c.generacion, actualizadoEn: c.actualizadoEn },
            data: {
                estado: 'PREPARADO',
                generacion,
                archivoGenerado: archivo,
                hashGenerado: sha256(bytes),
                bytesGenerado: bytes.byteLength,
                generadoEn: new Date(),
                descargadoParaFirmarEn: null,
                plantillaVersion: plantilla.version,
                codigoImpreso: p.impresion.codigoImpreso,
                urlVerificacion: p.url,
                ...(p.impresion.codigoExterno ? { codigoExterno: p.impresion.codigoExterno } : {}),
            },
        })
        if (!count) {
            await borrarGenerado(c.eventoId, archivo)
            return procesado(c, 'OMITIDO', { codigoError: 'CERTIFICATE_CHANGED', mensaje: 'Otra solicitud lo generó o lo editó a la vez: revisa su estado.' })
        }
        // El archivo de la generación anterior (tras una edición) ya no vale
        if (c.archivoGenerado && c.archivoGenerado !== archivo) await borrarGenerado(c.eventoId, c.archivoGenerado)
        return procesado(c, 'GENERADO', { estado: 'PREPARADO', avisos })
    } catch (error) {
        if (archivo) await borrarGenerado(c.eventoId, archivo)
        if (error instanceof HttpError && error.status < 500) return procesado(c, 'ERROR', { codigoError: error.code, mensaje: error.message })
        console.error(`No se pudo generar el certificado ${c.id} (evento ${c.eventoId}): ${descripcion(error)}`)
        return procesado(c, 'ERROR', { codigoError: 'GENERATION_FAILED', mensaje: 'No se pudo generar el PDF. Intenta nuevamente o revisa la plantilla.' })
    }
}

/**
 * `POST /v1/events/:eventId/certificates/generate` con `{ ids }` (hasta 10, de este evento) o
 * `{ pendientes: true, despuesDeId? }` (los siguientes 10 PENDIENTE por id). Responde por
 * certificado GENERADO, OMITIDO o ERROR, cuántos quedan pendientes en el evento y, con `pendientes`,
 * el cursor para la siguiente tanda (`ultimoId`, `hayMas`).
 */
export async function generarCertificados(eventoId: number, input: GenerarCertificadosInput) {
    const evento = await obtenerEventoPorId(eventoId)
    return limitarGeneracion(async () => {
        const procesados: Procesado[] = []
        let objetivos: CertificadoParaGenerar[] = []
        let ultimoId: number | null = null

        if (input.ids) {
            const ids = [...new Set(input.ids)].slice(0, MAX_IDS_GENERACION)
            const filas = await prisma.certificado.findMany({ where: { id: { in: ids }, eventoId }, select: SELECT_GENERACION })
            const porId = new Map(filas.map((fila) => [fila.id, fila]))
            for (const id of ids) {
                const fila = porId.get(id)
                // Uno de otro evento se informa igual que uno inexistente
                if (!fila) procesados.push({ id, codigo: null, resultado: 'ERROR', estado: null, avisos: [], codigoError: 'CERTIFICATE_NOT_FOUND', mensaje: 'El certificado no existe en este evento.' })
                else if (fila.estado !== 'PENDIENTE') procesados.push(procesado(fila, 'OMITIDO', { mensaje: MOTIVO_OMISION[fila.estado] ?? null }))
                else objetivos.push(fila)
            }
        } else {
            const desde = input.despuesDeId ?? 0
            objetivos = await prisma.certificado.findMany({
                where: { eventoId, estado: 'PENDIENTE', id: { gt: desde } },
                orderBy: { id: 'asc' },
                take: MAX_IDS_GENERACION,
                select: SELECT_GENERACION,
            })
            ultimoId = objetivos.length ? objetivos[objetivos.length - 1].id : desde
        }

        const preparados = await preparar(objetivos)
        const disenos = new Map<number, Uint8Array | null>()
        const generados = new Map<number, Procesado>()
        for (const [indice, p] of preparados.entries()) {
            if (indice > 0) await cederTurno()
            generados.set(p.certificado.id, await generarUno(evento, p, disenos))
        }
        // En el orden pedido
        const resultado = input.ids
            ? [...new Set(input.ids)].slice(0, MAX_IDS_GENERACION).map((id) => generados.get(id) ?? procesados.find((x) => x.id === id) as Procesado)
            : [...generados.values()]

        const [restantes, siguientes] = await Promise.all([
            prisma.certificado.count({ where: { eventoId, estado: 'PENDIENTE' } }),
            ultimoId === null ? Promise.resolve(0) : prisma.certificado.count({ where: { eventoId, estado: 'PENDIENTE', id: { gt: ultimoId } } }),
        ])
        return { procesados: resultado, restantes, ultimoId, hayMas: siguientes > 0 }
    })
}

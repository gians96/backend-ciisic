import path from 'path'
import { Prisma, type CoincidenciaFirmado, type EstadoCertificado } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { HttpError, conflict, notFound, unprocessable } from '../../../core/http-error'
import type { Actor } from '../../../core/actor'
import { hasPdfSignature } from '../../../core/pdf'
import { configuracionCertificados } from '../../../core/configuracion-sistema'
import { archivarFirmado, borrarArchivo, escribirArchivoAtomico, nuevoNombreFirmado, rutaCertificadoFirmado } from '../../../core/almacenamiento'
import {
    analizarFirmado,
    identidadDeSubject,
    leerFirmado,
    sha256,
    type AnalisisFirmado,
    type CoincidenciaVerificada,
    type Firmante,
    type FirmadoLeido,
    type Generado,
} from '../pdf/firmas'
import { extraerCodigo } from '../codigos/codigo'
import type { ReemplazarFirmadoInput } from '../validation/firmados'

/**
 * Certificados firmados afuera (FirmaPerú, ReFirma…) y anulación (spec 015).
 *
 * Un firmado se acepta solo si (pdf/firmas.ts): sus firmas verifican criptográficamente, no trae
 * contenido activo y es el PDF generado vigente con firmas agregadas al final (PREFIJO) sin cambios
 * en lo generado. Lo demás se rechaza; quien gestiona los certificados puede forzar uno individual,
 * con motivo, si no coincide (SIGNED_MISMATCH), si la herramienta lo reescribió (METADATOS,
 * SIGNED_REWRITTEN) o si cambió algo después de generado (SIGNED_MODIFIED); nunca uno sin firmas
 * válidas, con una firma que no verifica o con contenido activo. Con las firmas requeridas por la
 * plantilla queda FIRMADO; con menos, EN_FIRMA.
 *
 * - Reemplazar un FIRMADO exige `certificados.gestionar` (también en la carga por tandas).
 * - Un EN_FIRMA solo se reemplaza por un archivo que continúe sus firmas (empieza con sus bytes) o
 *   que tenga más; si no, se conserva (dos firmantes que firmaron en paralelo no se pisan).
 * - El firmado anterior nunca se borra: pasa a `firmados/reemplazados/`.
 *
 * Todo es idempotente y reanudable: volver a subir el mismo archivo no cambia nada (salvo pasar a
 * FIRMADO si bajaron las firmas requeridas). El archivo se guarda con nombre del servidor y escritura
 * atómica, y el certificado se actualiza con un `updateMany` condicionado a lo leído (si otra petición
 * lo cambió en medio, el archivo nuevo se borra y se informa).
 */

/** Archivo recibido por multer en memoria. */
export interface ArchivoSubido {
    originalname: string
    buffer: Buffer
}

export type ResultadoCarga =
    | 'FIRMADO' | 'PARCIAL' | 'SIN_FIRMA' | 'NO_COINCIDE' | 'NO_ENCONTRADO'
    | 'OTRO_EVENTO' | 'ANULADO' | 'YA_FIRMADO' | 'DUPLICADO' | 'INVALIDO'

export interface DetalleCarga {
    /** Nombre del archivo tal como llegó (solo el nombre base). */
    archivo: string
    resultado: ResultadoCarga
    /** `null` si no se encontró o es de otro evento. */
    certificadoId: number | null
    /** Código con el que se emparejó (o el que traía el nombre). */
    codigo: string | null
    /** Estado del certificado después de procesar el archivo. */
    estado: EstadoCertificado | null
    firmas: number | null
    firmasRequeridas: number | null
    coincidencia: CoincidenciaVerificada | null
    /** Código de error estable cuando el archivo no se aceptó (INVALID_PDF, SIGNED_MISMATCH…). */
    codigoError: string | null
    mensaje: string
}

export interface ResumenCarga {
    firmados: number
    parciales: number
    sinFirma: number
    noCoincide: number
    noEncontrados: number
    otroEvento: number
    anulados: number
    yaFirmados: number
    duplicados: number
    invalidos: number
}

export interface ReporteCarga {
    resumen: ResumenCarga
    detalle: DetalleCarga[]
}

const CLAVE_RESUMEN: Record<ResultadoCarga, keyof ResumenCarga> = {
    FIRMADO: 'firmados',
    PARCIAL: 'parciales',
    SIN_FIRMA: 'sinFirma',
    NO_COINCIDE: 'noCoincide',
    NO_ENCONTRADO: 'noEncontrados',
    OTRO_EVENTO: 'otroEvento',
    ANULADO: 'anulados',
    YA_FIRMADO: 'yaFirmados',
    DUPLICADO: 'duplicados',
    INVALIDO: 'invalidos',
}

const selectCertificado = {
    id: true,
    eventoId: true,
    codigo: true,
    estado: true,
    generacion: true,
    hashGenerado: true,
    bytesGenerado: true,
    archivoGenerado: true,
    archivoFirmado: true,
    hashFirmado: true,
    bytesFirmado: true,
    firmasDetectadas: true,
    coincidencia: true,
    firmadoEn: true,
    plantilla: { select: { firmasRequeridas: true } },
} satisfies Prisma.CertificadoSelect

type CertificadoFirma = Prisma.CertificadoGetPayload<{ select: typeof selectCertificado }>

export const certificadoNoEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe.')

function firmasRequeridas(c: CertificadoFirma): number {
    return Math.max(1, c.plantilla?.firmasRequeridas ?? 1)
}

/** Datos del generado vigente, o `null` si el certificado aún no se generó (PENDIENTE). */
function generadoDe(c: CertificadoFirma): Generado | null {
    if (!c.generacion || !c.hashGenerado || !c.bytesGenerado || !c.archivoGenerado) return null
    return { bytesGenerado: c.bytesGenerado, hashGenerado: c.hashGenerado, codigo: c.codigo, generacion: c.generacion }
}

/** El archivo nuevo empieza con los bytes del firmado vigente (otro firmante firmó encima). */
function continuaElFirmado(c: CertificadoFirma, bytes: Uint8Array): boolean {
    if (!c.bytesFirmado || !c.hashFirmado || bytes.byteLength <= c.bytesFirmado) return false
    return sha256(bytes.subarray(0, c.bytesFirmado)) === c.hashFirmado
}

/** Nombre base del archivo del cliente, acotado (solo para el reporte; nunca se usa como ruta). */
function nombreVisible(nombre: string): string {
    const base = String(nombre ?? '').split(/[\\/]/).pop() ?? ''
    return base.slice(0, 255)
}

/**
 * Candidato a `codigo_externo` (UNDC) a partir del nombre: sin extensión ni los sufijos que agregan
 * las herramientas de firma (`[R]`, `_firmado`, `-signed`, ` (1)`).
 */
function candidatoExterno(nombre: string): string | null {
    const sinExtension = path.parse(nombreVisible(nombre)).name
    const limpio = sinExtension
        .replace(/\s*\[[^\]]*\]\s*$/, '')
        .replace(/\s*\(\d+\)\s*$/, '')
        .replace(/[\s_-]*(firmado|firmada|signed)$/i, '')
        .trim()
    return limpio.length >= 3 && limpio.length <= 80 ? limpio : null
}

const ceder = () => new Promise<void>((resolve) => setImmediate(resolve))

const MENSAJES_RECHAZO: Record<string, string> = {
    SIGNED_MISMATCH: 'El archivo no es el PDF generado vigente de este certificado (otra persona o una versión anterior).',
    SIGNED_REWRITTEN: 'La herramienta de firma reescribió el PDF: no se puede comprobar que sea el generado. Quien gestiona los certificados puede aceptarlo uno por uno (forzar, con motivo).',
}

interface Guardado {
    estado: EstadoCertificado
    firmadoEn: Date | null
}

/**
 * Guarda el firmado (escritura atómica con nombre del servidor) y actualiza el certificado solo si
 * sigue como se leyó (estado, generación y firmado anterior). Si no, borra el archivo nuevo y
 * devuelve `null`. Tras actualizar, el firmado anterior pasa a `firmados/reemplazados/`.
 */
async function guardarFirmado(
    c: CertificadoFirma,
    bytes: Buffer,
    datos: { analisis: AnalisisFirmado, coincidencia: CoincidenciaFirmado, motivoForzado: string | null, actorId: number },
): Promise<Guardado | null> {
    const { analisis } = datos
    const completo = analisis.firmas >= firmasRequeridas(c)
    const archivo = nuevoNombreFirmado(c.codigo)
    const ruta = rutaCertificadoFirmado(c.eventoId, archivo)
    if (!ruta) throw new Error('Nombre de firmado con formato inválido')
    await escribirArchivoAtomico(ruta, bytes)
    const estado: EstadoCertificado = completo ? 'FIRMADO' : 'EN_FIRMA'
    const firmadoEn = completo ? new Date() : null
    let actualizado = 0
    try {
        const resultado = await prisma.certificado.updateMany({
            where: { id: c.id, estado: c.estado, generacion: c.generacion, archivoFirmado: c.archivoFirmado },
            data: {
                estado,
                archivoFirmado: archivo,
                hashFirmado: analisis.hash,
                bytesFirmado: bytes.byteLength,
                firmantes: analisis.firmantes as unknown as Prisma.InputJsonValue,
                firmasDetectadas: analisis.firmas,
                coincidencia: datos.coincidencia,
                motivoForzado: datos.motivoForzado,
                firmadoEn,
                firmadoCargadoPorId: datos.actorId,
            },
        })
        actualizado = resultado.count
    } catch (error) {
        await borrarArchivo(ruta).catch(() => undefined)
        throw error
    }
    if (!actualizado) {
        await borrarArchivo(ruta).catch(() => undefined)
        return null
    }
    if (c.archivoFirmado) await archivarAnterior(c)
    return { estado, firmadoEn }
}

async function archivarAnterior(c: Pick<CertificadoFirma, 'id' | 'eventoId' | 'archivoFirmado'>): Promise<void> {
    await archivarFirmado(c.eventoId, c.archivoFirmado).catch((error: unknown) => {
        console.warn(`No se pudo archivar el firmado anterior del certificado ${c.id}:`, error instanceof Error ? error.message : error)
    })
}

/**
 * Mismo archivo que el ya cargado en EN_FIRMA, pero con las firmas requeridas de ahora (la plantilla
 * pudo bajarlas): pasa a FIRMADO. `null` si otra petición lo cambió.
 */
async function completarSiAlcanza(c: CertificadoFirma): Promise<Guardado | null> {
    if (c.estado !== 'EN_FIRMA' || c.firmasDetectadas < firmasRequeridas(c)) return { estado: c.estado, firmadoEn: c.firmadoEn }
    const firmadoEn = new Date()
    const { count } = await prisma.certificado.updateMany({
        where: { id: c.id, estado: 'EN_FIRMA', archivoFirmado: c.archivoFirmado },
        data: { estado: 'FIRMADO', firmadoEn },
    })
    return count ? { estado: 'FIRMADO', firmadoEn } : null
}

// ─── Carga por tandas ───────────────────────────────────────────────────────

interface ContextoCarga {
    eventoId: number
    prefijo: string
    reemplazar: boolean
    actorId: number
    /** Certificados que ya recibieron un archivo en esta tanda. */
    aceptados: Set<number>
}

function detalle(archivo: string, resultado: ResultadoCarga, extra: Partial<DetalleCarga> & { mensaje: string }): DetalleCarga {
    return {
        archivo,
        resultado,
        certificadoId: null,
        codigo: null,
        estado: null,
        firmas: null,
        firmasRequeridas: null,
        coincidencia: null,
        codigoError: null,
        ...extra,
    }
}

async function buscarPorCodigo(codigo: string): Promise<CertificadoFirma | null> {
    return prisma.certificado.findUnique({ where: { codigo }, select: selectCertificado })
}

/**
 * Empareja el archivo con su certificado: por el código en el nombre; si el nombre no trae un
 * código, por el `codigo_externo` (UNDC). Si así no aparece, por el `Subject` del PDF ya leído
 * (`ciisic:<código>:<generación>`; que sea el generado vigente se comprueba después).
 */
async function emparejar(archivo: ArchivoSubido, leido: FirmadoLeido, ctx: ContextoCarga): Promise<{ certificado: CertificadoFirma | null, codigo: string | null }> {
    const codigo = extraerCodigo(archivo.originalname, ctx.prefijo)
    if (codigo) {
        const certificado = await buscarPorCodigo(codigo)
        if (certificado) return { certificado, codigo }
    } else {
        const externo = candidatoExterno(archivo.originalname)
        const certificado = externo ? await prisma.certificado.findUnique({ where: { codigoExterno: externo }, select: selectCertificado }) : null
        if (certificado) return { certificado, codigo: certificado.codigo }
    }
    const identidad = identidadDeSubject(leido.subject)
    const certificado = identidad && identidad.codigo !== codigo ? await buscarPorCodigo(identidad.codigo) : null
    return { certificado, codigo: certificado?.codigo ?? codigo }
}

async function procesarArchivo(archivo: ArchivoSubido, ctx: ContextoCarga): Promise<DetalleCarga> {
    const nombre = nombreVisible(archivo.originalname)
    if (!hasPdfSignature(archivo.buffer)) {
        return detalle(nombre, 'INVALIDO', { codigoError: 'INVALID_PDF', mensaje: 'El archivo no es un PDF válido.' })
    }

    // El PDF se lee una sola vez: sirve para emparejar por Subject y para el análisis
    const leido = await leerFirmado(archivo.buffer)
    const { certificado: c, codigo } = await emparejar(archivo, leido, ctx)
    if (!c) {
        return detalle(nombre, 'NO_ENCONTRADO', {
            codigo,
            mensaje: codigo ? 'No hay un certificado con ese código.' : 'El nombre del archivo no tiene el código del certificado.',
        })
    }
    if (c.eventoId !== ctx.eventoId) {
        return detalle(nombre, 'OTRO_EVENTO', { codigo, mensaje: 'El certificado es de otro evento: súbelo en su evento.' })
    }

    const requeridas = firmasRequeridas(c)
    const base: Partial<DetalleCarga> = { certificadoId: c.id, codigo: c.codigo, estado: c.estado, firmasRequeridas: requeridas }
    if (ctx.aceptados.has(c.id)) {
        return detalle(nombre, 'DUPLICADO', { ...base, mensaje: 'Otro archivo de esta carga ya es de este certificado.' })
    }
    if (c.estado === 'ANULADO') return detalle(nombre, 'ANULADO', { ...base, mensaje: 'El certificado está anulado.' })

    const conservado = { ...base, firmas: c.firmasDetectadas, coincidencia: c.coincidencia === 'FORZADO' ? null : c.coincidencia }
    if (c.estado === 'FIRMADO' && c.hashFirmado === leido.hash) {
        return detalle(nombre, 'YA_FIRMADO', { ...conservado, mensaje: 'Este archivo ya estaba cargado.' })
    }
    if (c.estado === 'FIRMADO' && !ctx.reemplazar) {
        return detalle(nombre, 'YA_FIRMADO', { ...conservado, mensaje: 'El certificado ya está firmado. Quien gestiona los certificados puede reemplazarlo («reemplazar»).' })
    }
    if (c.estado === 'EN_FIRMA' && c.hashFirmado === leido.hash) {
        // Mismo archivo: nada que guardar, pero si ahora alcanza (bajaron las firmas requeridas) queda FIRMADO
        const ahora = await completarSiAlcanza(c)
        ctx.aceptados.add(c.id)
        if (ahora?.estado === 'FIRMADO') {
            return detalle(nombre, 'FIRMADO', { ...conservado, estado: 'FIRMADO', mensaje: `Este archivo ya estaba cargado y ahora alcanza las firmas requeridas (${c.firmasDetectadas} de ${requeridas}).` })
        }
        return detalle(nombre, 'PARCIAL', { ...conservado, mensaje: 'Este archivo ya estaba cargado.' })
    }

    const generado = generadoDe(c)
    if (!generado) {
        return detalle(nombre, 'NO_COINCIDE', { ...base, codigoError: 'CERTIFICATE_NOT_GENERATED', mensaje: 'El certificado aún no se generó: no hay un PDF con el que comparar.' })
    }

    const analisis = await analizarFirmado(leido, generado)
    const conAnalisis = { ...base, firmas: analisis.firmas, coincidencia: analisis.coincidencia }
    const problema = analisis.problema
    if (problema && problema.codigo !== 'SIGNED_MODIFIED') {
        return detalle(nombre, 'INVALIDO', { ...conAnalisis, codigoError: problema.codigo, mensaje: problema.mensaje })
    }
    if (!analisis.coincidencia || analisis.coincidencia === 'METADATOS' || problema) {
        const codigoError = problema?.codigo ?? (analisis.coincidencia === 'METADATOS' ? 'SIGNED_REWRITTEN' : 'SIGNED_MISMATCH')
        return detalle(nombre, 'NO_COINCIDE', { ...conAnalisis, codigoError, mensaje: problema?.mensaje ?? MENSAJES_RECHAZO[codigoError] })
    }
    if (analisis.firmas === 0) {
        return detalle(nombre, 'SIN_FIRMA', { ...conAnalisis, codigoError: 'SIGNATURE_NOT_FOUND', mensaje: 'El PDF no tiene firmas válidas.' })
    }

    const completo = analisis.firmas >= requeridas
    if (c.estado === 'FIRMADO' && !completo) {
        return detalle(nombre, 'YA_FIRMADO', { ...conAnalisis, mensaje: `El archivo nuevo tiene ${analisis.firmas} de ${requeridas} firmas: se conserva el firmado.` })
    }
    if (c.estado === 'EN_FIRMA' && !continuaElFirmado(c, archivo.buffer) && analisis.firmas <= c.firmasDetectadas) {
        ctx.aceptados.add(c.id)
        return detalle(nombre, 'PARCIAL', {
            ...conservado,
            mensaje: `Se conserva el archivo cargado antes (${c.firmasDetectadas} firmas): este no continúa sus firmas ni tiene más (¿se firmó en paralelo?).`,
        })
    }

    const guardado = await guardarFirmado(c, archivo.buffer, { analisis, coincidencia: analisis.coincidencia, motivoForzado: null, actorId: ctx.actorId })
    if (!guardado) {
        return detalle(nombre, 'NO_COINCIDE', { ...conAnalisis, codigoError: 'CERTIFICATE_CHANGED', mensaje: 'El certificado cambió mientras se cargaba el archivo. Vuelve a subirlo.' })
    }
    ctx.aceptados.add(c.id)
    return completo
        ? detalle(nombre, 'FIRMADO', { ...conAnalisis, estado: guardado.estado, mensaje: `Firmado (${analisis.firmas} de ${requeridas} firmas).` })
        : detalle(nombre, 'PARCIAL', { ...conAnalisis, estado: guardado.estado, mensaje: `Firma parcial: ${analisis.firmas} de ${requeridas} firmas.` })
}

const soloGestion = (accion: string) => new HttpError(403, 'FORBIDDEN', `Solo quien gestiona los certificados puede ${accion}.`)

/**
 * Carga una tanda de firmados del evento (≤10 archivos, en orden y cediendo el turno entre uno y
 * otro). Cada archivo se informa por separado; ninguno corta la tanda. `rechazados`: nombres que la
 * subida descartó por no ser PDF. `reemplazar` (cambiar un FIRMADO) exige `certificados.gestionar`.
 */
export async function cargarFirmados(
    eventoId: number,
    archivos: readonly ArchivoSubido[],
    rechazados: readonly string[],
    opciones: { reemplazar: boolean },
    actor: Actor,
): Promise<ReporteCarga> {
    if (opciones.reemplazar && !actor.permisos.has('certificados.gestionar')) throw soloGestion('reemplazar un certificado ya firmado')
    if (!archivos.length && !rechazados.length) {
        throw unprocessable('FILE_REQUIRED', 'Adjunta los PDF firmados (campo files).', { files: 'Adjunta al menos un PDF' })
    }
    const evento = await prisma.evento.findUnique({ where: { id: eventoId }, select: { id: true } })
    if (!evento) throw notFound('EVENT_NOT_FOUND', 'El evento no existe.')

    const { prefijo } = await configuracionCertificados()
    const ctx: ContextoCarga = { eventoId, prefijo, reemplazar: opciones.reemplazar, actorId: actor.id, aceptados: new Set() }
    const lista: DetalleCarga[] = rechazados.map((nombre) =>
        detalle(nombreVisible(nombre), 'INVALIDO', { codigoError: 'INVALID_FILE_TYPE', mensaje: 'Solo se aceptan archivos PDF.' }))
    for (const [i, archivo] of archivos.entries()) {
        if (i > 0) await ceder()
        lista.push(await procesarArchivo(archivo, ctx))
    }

    const resumen: ResumenCarga = { firmados: 0, parciales: 0, sinFirma: 0, noCoincide: 0, noEncontrados: 0, otroEvento: 0, anulados: 0, yaFirmados: 0, duplicados: 0, invalidos: 0 }
    for (const d of lista) resumen[CLAVE_RESUMEN[d.resultado]]++
    return { resumen, detalle: lista }
}

// ─── Reemplazo individual, quitar firmado y anular ──────────────────────────

export interface FirmadoActual {
    id: number
    codigo: string
    estado: EstadoCertificado
    firmasDetectadas: number
    firmasRequeridas: number
    coincidencia: CoincidenciaFirmado | null
    firmantes: Firmante[]
    firmadoEn: Date | null
}

async function leerCertificado(id: number): Promise<CertificadoFirma> {
    const c = await prisma.certificado.findUnique({ where: { id }, select: selectCertificado })
    if (!c) throw certificadoNoEncontrado()
    return c
}

const certificadoCambio = () => conflict('CERTIFICATE_CHANGED', 'El certificado cambió mientras se procesaba la solicitud. Vuelve a intentarlo.')

/** Coincidencia con la que se acepta el archivo, o el error si no se acepta. */
function coincidenciaAceptada(analisis: AnalisisFirmado, forzar: boolean): CoincidenciaFirmado {
    const { problema, coincidencia } = analisis
    if (problema && problema.codigo !== 'SIGNED_MODIFIED') throw unprocessable(problema.codigo, problema.mensaje)
    if (analisis.firmas === 0) throw unprocessable('SIGNATURE_NOT_FOUND', 'El PDF no tiene firmas válidas.')
    if (coincidencia === 'PREFIJO' && !problema) return 'PREFIJO'
    if (forzar) return coincidencia === 'METADATOS' ? 'METADATOS' : 'FORZADO'
    if (problema) throw unprocessable(problema.codigo, problema.mensaje)
    const codigo = coincidencia === 'METADATOS' ? 'SIGNED_REWRITTEN' : 'SIGNED_MISMATCH'
    throw unprocessable(codigo, MENSAJES_RECHAZO[codigo])
}

/**
 * Sube el firmado de un certificado concreto (sin emparejar por nombre). Un FIRMADO solo se
 * reemplaza con `reemplazar`, por quien gestiona los certificados y por otro completo; un EN_FIRMA,
 * por uno que continúe sus firmas o tenga más. `forzar` (solo `certificados.gestionar`, con motivo)
 * acepta un archivo que no coincide, reescrito o con cambios; nunca uno sin firmas válidas, con una
 * firma que no verifica o con contenido activo.
 */
export async function reemplazarFirmado(id: number, archivo: ArchivoSubido | undefined, input: ReemplazarFirmadoInput, actor: Actor): Promise<FirmadoActual> {
    const gestiona = actor.permisos.has('certificados.gestionar')
    if (input.forzar && !gestiona) throw soloGestion('forzar un firmado que no coincide')
    if (!archivo) throw unprocessable('FILE_REQUIRED', 'Adjunta el PDF firmado (campo file).', { file: 'Adjunta el PDF firmado' })

    const c = await leerCertificado(id)
    if (c.estado === 'ANULADO') throw conflict('CERTIFICATE_ANNULLED', 'El certificado está anulado.')
    const generado = generadoDe(c)
    if (!generado) throw conflict('CERTIFICATE_NOT_GENERATED', 'Genera el certificado antes de subir su firmado.')
    if (c.estado === 'FIRMADO' && !input.reemplazar) {
        throw conflict('CERTIFICATE_ALREADY_SIGNED', 'El certificado ya está firmado. Marca «reemplazar» para cambiar el archivo.')
    }
    if (c.estado === 'FIRMADO' && !gestiona) throw soloGestion('reemplazar un certificado ya firmado')
    if (!hasPdfSignature(archivo.buffer)) throw unprocessable('INVALID_PDF', 'El archivo no es un PDF válido.')

    const requeridas = firmasRequeridas(c)
    const actual = (estado: EstadoCertificado, firmas: number, coinc: CoincidenciaFirmado | null, firmantes: Firmante[], firmadoEn: Date | null): FirmadoActual => ({
        id: c.id, codigo: c.codigo, estado, firmasDetectadas: firmas, firmasRequeridas: requeridas, coincidencia: coinc, firmantes, firmadoEn,
    })

    const leido = await leerFirmado(archivo.buffer)
    const analisis = await analizarFirmado(leido, generado)
    const coincidencia = coincidenciaAceptada(analisis, input.forzar)
    if (c.estado === 'FIRMADO' && analisis.firmas < requeridas) {
        throw unprocessable('SIGNATURES_INCOMPLETE', `El archivo nuevo tiene ${analisis.firmas} de ${requeridas} firmas: se conserva el firmado.`)
    }

    // Mismo archivo que el ya cargado: nada que guardar (salvo completar si bajaron las firmas requeridas)
    if (c.hashFirmado === analisis.hash) {
        const ahora = await completarSiAlcanza(c)
        if (!ahora) throw certificadoCambio()
        return actual(ahora.estado, c.firmasDetectadas, c.coincidencia, analisis.firmantes, ahora.firmadoEn)
    }
    if (c.estado === 'EN_FIRMA' && !input.forzar && !continuaElFirmado(c, archivo.buffer) && analisis.firmas <= c.firmasDetectadas) {
        throw conflict('SIGNATURES_NOT_EXTENDED', `El archivo no continúa las firmas del ya cargado (${c.firmasDetectadas} de ${requeridas}) ni tiene más: se conserva el cargado.`)
    }

    const motivoForzado = coincidencia === 'FORZADO' || coincidencia === 'METADATOS' ? input.motivo ?? null : null
    const guardado = await guardarFirmado(c, archivo.buffer, { analisis, coincidencia, motivoForzado, actorId: actor.id })
    if (!guardado) throw certificadoCambio()
    if (motivoForzado) console.warn(`Firmado forzado (${coincidencia}): certificado ${c.id} por la cuenta ${actor.id}`)
    else if (c.estado === 'FIRMADO') console.warn(`Firmado reemplazado: certificado ${c.id} por la cuenta ${actor.id}`)
    return actual(guardado.estado, analisis.firmas, coincidencia, analisis.firmantes, guardado.firmadoEn)
}

/** Quita el firmado y el certificado vuelve a PREPARADO; el archivo pasa a `firmados/reemplazados/`. */
export async function quitarFirmado(id: number, actor: Actor): Promise<{ id: number, codigo: string, estado: EstadoCertificado }> {
    const c = await leerCertificado(id)
    if (c.estado === 'ANULADO') throw conflict('CERTIFICATE_ANNULLED', 'El certificado está anulado.')
    if (!c.archivoFirmado || (c.estado !== 'FIRMADO' && c.estado !== 'EN_FIRMA')) {
        throw conflict('CERTIFICATE_NOT_SIGNED', 'El certificado no tiene un firmado cargado.')
    }
    const estado: EstadoCertificado = generadoDe(c) ? 'PREPARADO' : 'PENDIENTE'
    const { count } = await prisma.certificado.updateMany({
        where: { id: c.id, estado: c.estado, archivoFirmado: c.archivoFirmado },
        data: {
            estado,
            archivoFirmado: null,
            hashFirmado: null,
            bytesFirmado: null,
            firmantes: Prisma.DbNull,
            firmasDetectadas: 0,
            coincidencia: null,
            motivoForzado: null,
            firmadoEn: null,
            firmadoCargadoPorId: null,
            editadoPorId: actor.id,
        },
    })
    if (!count) throw certificadoCambio()
    await archivarAnterior(c)
    console.info(`Firmado quitado: certificado ${c.id} por la cuenta ${actor.id}`)
    return { id: c.id, codigo: c.codigo, estado }
}

/**
 * Anula el certificado: deja de ser vigente (`clave_vigente` NULL, se puede volver a emitir), la
 * verificación pública lo muestra ANULADO y sale del portal. Los archivos se conservan.
 */
export async function anularCertificado(id: number, motivo: string, actor: Actor) {
    const c = await prisma.certificado.findUnique({ where: { id }, select: { id: true, codigo: true, estado: true } })
    if (!c) throw certificadoNoEncontrado()
    const yaAnulado = () => conflict('CERTIFICATE_ALREADY_ANNULLED', 'El certificado ya está anulado.')
    if (c.estado === 'ANULADO') throw yaAnulado()
    const anuladoEn = new Date()
    const { count } = await prisma.certificado.updateMany({
        where: { id: c.id, estado: { not: 'ANULADO' } },
        data: { estado: 'ANULADO', claveVigente: null, anuladoEn, motivoAnulacion: motivo, anuladoPorId: actor.id },
    })
    if (!count) throw yaAnulado()
    console.info(`Certificado ${c.id} anulado por la cuenta ${actor.id}`)
    return { id: c.id, codigo: c.codigo, estado: 'ANULADO' as const, anuladoEn, motivoAnulacion: motivo }
}

import { access, mkdir, rm, writeFile } from 'fs/promises'
import path from 'path'
import QRCode from 'qrcode'
import type { Participante, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { fechaSoloDia, horaLima } from '../../../core/fechas'
import { monto } from '../../../core/catalogos'
import { asegurarCodigoCredencial } from '../../../core/codigos'
import { DIRECTORIO_FOTOS, nuevoNombreFoto, rutaCertificadoFirmado, rutaFoto } from '../../../core/almacenamiento'
import { limpiarMetadatos, MIME_POR_TIPO, TIPO_POR_MIME, tipoDeImagen, type TipoFoto } from '../../../core/imagenes'
import { archivoCredencial } from '../../inscription/services/inscription'
import { borrarCredenciales } from '../../inscription/utils/generatePdf'
import type { ActualizarPerfilInput } from '../validation'

/**
 * Portal del inscrito (specs 011 y 014): cada participante ve solo lo suyo. No expone quién revisó,
 * rutas de archivos ni detalles internos de verificación.
 */
const incluir = {
    evento: true,
    tipoInscripcion: { include: { categoria: true } },
    clasificacion: true,
    estado: true,
} satisfies Prisma.InscripcionInclude

type InscripcionPortal = Prisma.InscripcionGetPayload<{ include: typeof incluir }>

const participanteNoEncontrado = () => notFound('PARTICIPANT_NOT_FOUND', 'No encontramos tu registro.')
const inscripcionNoEncontrada = () => notFound('INSCRIPTION_NOT_FOUND', 'La inscripción no existe.')

export function aInscripcionPortal(i: InscripcionPortal) {
    const precioRegular = i.tipoInscripcion ? monto(i.tipoInscripcion.precio) : monto(i.monto)
    const aprobada = i.estado.codigo === 'APROBADO'
    return {
        id: i.id,
        evento: {
            codigo: i.evento.codigo,
            nombre: i.evento.nombre,
            nombreCorto: i.evento.nombreCorto,
            fechaInicio: fechaSoloDia(i.evento.fechaInicio),
            fechaFin: fechaSoloDia(i.evento.fechaFin),
            sede: i.evento.sede,
        },
        tipoInscripcion: i.tipoInscripcion
            ? { nombre: i.tipoInscripcion.nombre, etiqueta: i.tipoInscripcion.etiqueta, categoria: i.tipoInscripcion.categoria.nombre }
            : null,
        clasificacion: i.clasificacion ? { nombre: i.clasificacion.nombre } : null,
        monto: monto(i.monto),
        precioRegular,
        descuento: monto(i.descuento),
        pago: {
            modalidad: i.modalidadPago,
            banco: i.banco,
            tipoOperacion: i.tipoOperacion,
            billeteraDigital: i.billeteraDigital,
            numeroOperacion: i.numeroOperacion,
            fechaPago: fechaSoloDia(i.fechaPago),
        },
        estado: { codigo: i.estado.codigo, nombre: i.estado.nombre },
        motivoRechazo: i.estado.codigo === 'RECHAZADO' ? i.motivoRechazo : null,
        revisadoEn: i.revisadoEn,
        credencial: { disponible: aprobada, enviadaEn: aprobada ? i.credencialEnviadaEn : null },
        fotocheck: { disponible: aprobada },
        creadoEn: i.creadoEn,
    }
}

// ─── Perfil ─────────────────────────────────────────────────────────────────

function aPerfil(p: Participante) {
    return {
        id: p.id,
        nombres: p.nombres,
        apellidos: p.apellidos,
        correo: p.correo,
        tipoDocumento: p.tipoDocumentoId,
        numeroDocumento: p.numeroDocumento,
        celular: p.celular,
        foto: { tiene: Boolean(p.fotoArchivo), actualizadaEn: p.fotoArchivo ? p.fotoActualizadaEn : null },
        google: { vinculado: Boolean(p.googleSub) },
    }
}

export async function miPerfil(participanteId: number) {
    const p = await prisma.participante.findUnique({ where: { id: participanteId } })
    if (!p) throw participanteNoEncontrado()
    return aPerfil(p)
}

/** Solo el celular (los demás campos los descarta la validación). */
export async function actualizarPerfil(participanteId: number, input: ActualizarPerfilInput) {
    return aPerfil(await prisma.participante.update({ where: { id: participanteId }, data: { celular: input.celular } }))
}

// ─── Inscripciones y credencial ─────────────────────────────────────────────

export async function misInscripciones(participanteId: number) {
    const filas = await prisma.inscripcion.findMany({ where: { participanteId }, include: incluir, orderBy: { creadoEn: 'desc' } })
    return filas.map(aInscripcionPortal)
}

/** Ruta del PDF de la credencial, solo si la inscripción es del participante (si no, 404). */
export async function miCredencial(participanteId: number, inscripcionId: number) {
    const propia = await prisma.inscripcion.findFirst({ where: { id: inscripcionId, participanteId }, select: { id: true, evento: { select: { codigo: true } } } })
    if (!propia) throw inscripcionNoEncontrada()
    return { ruta: await archivoCredencial(inscripcionId), nombre: `credencial-${propia.evento.codigo}-${propia.id}.pdf` }
}

// ─── Fotocheck ──────────────────────────────────────────────────────────────

/** `70001234` → `****1234`: el fotocheck se muestra y se guarda en el celular; el escáner ve el documento completo. */
function enmascararDocumento(numero: string): string {
    return `****${numero.slice(-4)}`
}

/**
 * Fotocheck virtual (spec 014) de una inscripción aprobada del participante. El QR codifica solo el
 * código opaco de la credencial (sin URL ni datos personales). 404 si no existe o es ajena; 409
 * `NOT_APPROVED` si aún no está aprobada.
 */
export async function miFotocheck(participanteId: number, inscripcionId: number) {
    const i = await prisma.inscripcion.findFirst({
        where: { id: inscripcionId, participanteId },
        select: {
            id: true,
            codigoCredencial: true,
            estado: { select: { codigo: true } },
            evento: { select: { nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true, sede: true } },
            participante: { select: { nombres: true, apellidos: true, tipoDocumentoId: true, numeroDocumento: true, fotoArchivo: true } },
            tipoInscripcion: { select: { nombre: true, etiqueta: true } },
        },
    })
    if (!i) throw inscripcionNoEncontrada()
    if (i.estado.codigo !== 'APROBADO') throw conflict('NOT_APPROVED', 'Tu fotocheck estará disponible cuando se apruebe tu inscripción.')

    const codigo = i.codigoCredencial ?? await asegurarCodigoCredencial(i.id)
    const p = i.participante
    return {
        inscripcionId: i.id,
        codigo,
        qr: await QRCode.toDataURL(codigo, { errorCorrectionLevel: 'M', margin: 2, width: 480 }),
        evento: {
            nombre: i.evento.nombre,
            nombreCorto: i.evento.nombreCorto,
            fechaInicio: fechaSoloDia(i.evento.fechaInicio),
            fechaFin: fechaSoloDia(i.evento.fechaFin),
            sede: i.evento.sede,
        },
        participante: {
            nombres: p.nombres,
            apellidos: p.apellidos,
            tipoDocumento: p.tipoDocumentoId,
            documentoEnmascarado: enmascararDocumento(p.numeroDocumento),
        },
        tipoInscripcion: i.tipoInscripcion ? { nombre: i.tipoInscripcion.nombre, etiqueta: i.tipoInscripcion.etiqueta } : null,
        foto: { tiene: Boolean(p.fotoArchivo) },
    }
}

// ─── Foto ───────────────────────────────────────────────────────────────────

/** Intentos ante un cambio simultáneo de la foto (otra pestaña): cada uno relee la foto vigente. */
const INTENTOS_FOTO = 3

async function borrarArchivoFoto(archivo: string | null): Promise<void> {
    const ruta = rutaFoto(archivo)
    if (ruta) await rm(ruta, { force: true }).catch((error: Error) => console.error('No se pudo borrar una foto anterior:', error.message))
}

/** Los PDF guardados llevan la foto: se borran para que no quede una copia (la huella ya evita reutilizarlos). */
async function invalidarCredenciales(participanteId: number): Promise<void> {
    const inscripciones = await prisma.inscripcion.findMany({ where: { participanteId }, select: { id: true } })
    for (const { id } of inscripciones) borrarCredenciales(id)
}

/**
 * Cambia la foto vigente sin pisar un cambio simultáneo (`updateMany` condicionado a la foto leída)
 * y borra la anterior del disco: así no quedan fotos huérfanas. Devuelve false si no hubo cambio.
 */
async function cambiarFoto(participanteId: number, archivo: string | null, actualizadaEn: Date | null): Promise<boolean> {
    for (let intento = 0; intento < INTENTOS_FOTO; intento++) {
        const actual = await prisma.participante.findUnique({ where: { id: participanteId }, select: { fotoArchivo: true } })
        if (!actual) throw participanteNoEncontrado()
        if (actual.fotoArchivo === archivo) return false
        const { count } = await prisma.participante.updateMany({
            where: { id: participanteId, fotoArchivo: actual.fotoArchivo },
            data: { fotoArchivo: archivo, fotoActualizadaEn: actualizadaEn },
        })
        if (count === 1) {
            await borrarArchivoFoto(actual.fotoArchivo)
            await invalidarCredenciales(participanteId)
            return true
        }
    }
    throw conflict('PHOTO_CONFLICT', 'Tu foto se está actualizando desde otra ventana. Intenta nuevamente.')
}

/**
 * Guarda la foto del fotocheck (spec 014, Ley 29733): exige el consentimiento, acepta solo JPEG o
 * PNG reales (firma de bytes que coincide con el tipo declarado), quita los metadatos (EXIF, GPS,
 * textos) y escribe con un nombre nuevo del servidor (`wx`: nunca sobrescribe).
 */
export async function guardarFoto(participanteId: number, archivo: { buffer: Buffer, mimetype: string }, consentimiento: unknown) {
    if (consentimiento !== 'true') {
        throw unprocessable('CONSENT_REQUIRED', 'Debes aceptar el uso de tu foto en el fotocheck.', { consentimiento: 'Acepta el uso de tu foto' })
    }
    const tipo = tipoDeImagen(archivo.buffer)
    if ((tipo !== 'png' && tipo !== 'jpg') || tipo !== TIPO_POR_MIME[archivo.mimetype]) {
        throw unprocessable('INVALID_FILE_CONTENT', 'El archivo no es una imagen JPG o PNG válida.')
    }
    const limpia = limpiarMetadatos(archivo.buffer, tipo)

    const nombre = nuevoNombreFoto(tipo)
    const ruta = path.join(DIRECTORIO_FOTOS, nombre)
    await mkdir(DIRECTORIO_FOTOS, { recursive: true })
    await writeFile(ruta, limpia, { flag: 'wx' })

    const actualizadaEn = new Date()
    try {
        await cambiarFoto(participanteId, nombre, actualizadaEn)
    } catch (error) {
        await rm(ruta, { force: true }).catch(() => undefined)
        throw error
    }
    return { foto: { tiene: true, actualizadaEn } }
}

/** Quita la foto (idempotente). */
export async function borrarFoto(participanteId: number) {
    await cambiarFoto(participanteId, null, null)
    return { foto: { tiene: false } }
}

/** Ruta y tipo de la foto del participante; 404 `PHOTO_NOT_FOUND` si no tiene o el archivo ya no está. */
export async function miFoto(participanteId: number): Promise<{ ruta: string, mime: string }> {
    const sinFoto = () => notFound('PHOTO_NOT_FOUND', 'No tienes una foto registrada.')
    const p = await prisma.participante.findUnique({ where: { id: participanteId }, select: { fotoArchivo: true } })
    const ruta = rutaFoto(p?.fotoArchivo)
    if (!ruta) throw sinFoto()
    try {
        await access(ruta)
    } catch {
        throw sinFoto()
    }
    return { ruta, mime: MIME_POR_TIPO[path.extname(ruta).slice(1) as TipoFoto] }
}

// ─── Asistencia ─────────────────────────────────────────────────────────────

/**
 * Asistencia del participante por evento (spec 014): solo eventos donde su inscripción está
 * aprobada, con todas las actividades del evento y si asistió. Las marcas anuladas no cuentan.
 */
export async function misAsistencias(participanteId: number) {
    const inscripciones = await prisma.inscripcion.findMany({
        where: { participanteId, estado: { codigo: 'APROBADO' } },
        select: { evento: { select: { id: true, nombre: true, nombreCorto: true } } },
        orderBy: { evento: { fechaInicio: 'desc' } },
    })
    if (!inscripciones.length) return []

    const actividades = await prisma.actividad.findMany({
        where: { eventoId: { in: inscripciones.map((i) => i.evento.id) } },
        select: {
            id: true, eventoId: true, nombre: true, fecha: true, horaInicio: true, horaFin: true,
            asistencias: { where: { participanteId, anuladoEn: null }, select: { registradoEn: true, anuladoEn: true } },
        },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    })

    return inscripciones.map(({ evento }) => {
        const delEvento = actividades.filter((a) => a.eventoId === evento.id).map((a) => {
            const marca = a.asistencias.find((x) => x.anuladoEn === null)
            return {
                id: a.id,
                nombre: a.nombre,
                fecha: fechaSoloDia(a.fecha),
                horaInicio: horaLima(a.horaInicio),
                horaFin: horaLima(a.horaFin),
                asistio: Boolean(marca),
                registradoEn: marca?.registradoEn ?? null,
            }
        })
        return {
            evento: { id: evento.id, nombre: evento.nombre, nombreCorto: evento.nombreCorto },
            totalActividades: delEvento.length,
            asistidas: delEvento.filter((a) => a.asistio).length,
            actividades: delEvento,
        }
    })
}

// ─── Certificados (spec 015) ────────────────────────────────────────────────

/** Solo los certificados FIRMADOS del participante: ni anulados ni en preparación. */
const CERTIFICADO_PROPIO_FIRMADO = (participanteId: number) => ({ participanteId, estado: 'FIRMADO' as const })

export const certificadoNoEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'El certificado no existe o aún no está firmado.')

/**
 * Certificados firmados del participante, para ver y descargar. Sin documento, quién lo emitió ni
 * rutas de archivo; la URL de verificación es la impresa en su QR.
 */
export async function misCertificados(participanteId: number) {
    const filas = await prisma.certificado.findMany({
        where: CERTIFICADO_PROPIO_FIRMADO(participanteId),
        select: {
            id: true,
            codigo: true,
            codigoImpreso: true,
            fechaEmision: true,
            horas: true,
            detalle: true,
            firmadoEn: true,
            urlVerificacion: true,
            evento: { select: { codigo: true, nombre: true, nombreCorto: true, fechaInicio: true, fechaFin: true } },
            tipo: { select: { codigo: true, nombre: true } },
        },
        orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }],
    })
    return filas.map((c) => ({
        id: c.id,
        codigoImpreso: c.codigoImpreso ?? c.codigo,
        evento: {
            codigo: c.evento.codigo,
            nombre: c.evento.nombre,
            nombreCorto: c.evento.nombreCorto,
            fechaInicio: fechaSoloDia(c.evento.fechaInicio),
            fechaFin: fechaSoloDia(c.evento.fechaFin),
        },
        tipo: { codigo: c.tipo.codigo, nombre: c.tipo.nombre },
        fechaEmision: fechaSoloDia(c.fechaEmision),
        horas: c.horas,
        detalle: c.detalle,
        firmadoEn: c.firmadoEn,
        urlVerificacion: c.urlVerificacion,
    }))
}

/** Ruta y nombre de descarga del PDF firmado propio; 404 si es ajeno, no está firmado o falta el archivo. */
export async function miCertificadoFirmado(participanteId: number, certificadoId: number): Promise<{ ruta: string, nombre: string }> {
    const c = await prisma.certificado.findFirst({
        where: { id: certificadoId, ...CERTIFICADO_PROPIO_FIRMADO(participanteId) },
        select: { eventoId: true, codigo: true, codigoImpreso: true, archivoFirmado: true },
    })
    const ruta = c ? rutaCertificadoFirmado(c.eventoId, c.archivoFirmado) : null
    if (!c || !ruta) throw certificadoNoEncontrado()
    // El código impreso lo puede asignar la UNDC: en el nombre solo letras, números, guion y punto
    const nombre = `certificado-${(c.codigoImpreso ?? c.codigo).replace(/[^A-Za-z0-9.-]+/g, '_')}.pdf`
    return { ruta, nombre }
}

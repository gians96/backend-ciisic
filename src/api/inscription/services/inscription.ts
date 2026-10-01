import crypto from 'crypto'
import fs from 'fs'
import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { monto, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { pageMeta, type Pagination } from '../../../core/pagination'
import {
    asegurarCodigoCredencial, conReintentoDeCodigo, enmascararCorreo, INDICE_CODIGO_CREDENCIAL, nuevoCodigoCredencial,
} from '../../../core/codigos'
import { rutaFoto } from '../../../core/almacenamiento'
import { uploadedFilePath } from '../../../middlewares/upload'
import { inscripcionesAbiertas, obtenerEventoPorId } from '../../event/services/public-event'
import { apellidosDe, nombresOficiales } from '../../document-lookup/services/cache'
import { leerVerificacion, type ResultadoVerificacion } from '../../student-verification/services/verification-token'
import { aSnapshot, verificarEstudiante } from '../../student-verification/services/student-verification'
import { leerVerificacionCorreo } from '../../google-auth/services/verificacion-correo'
import { borrarCredenciales, generarCredencialPdf, rutaCredencial } from '../utils/generatePdf'
import { enDiferido, enviarAvisoCorreoConservado, enviarCorreoAprobacion } from '../utils/sendEmail'
import { calcularPrecio, esCorreoInstitucional } from './pricing'
import { aDetalle, aFilaLista, detalleInclude, type InscripcionDetalle } from './mappers'
import type { CortesiaInput, CrearInscripcionInput } from '../validation'

export interface OpcionesCreacion {
    /** Ruta legacy: voucher opcional y regla histórica de precio por dominio de correo. */
    legacy?: boolean
}

/** Traduce violaciones de unicidad a errores de negocio comprensibles. */
function errorDeUnicidad(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '')
        if (target.includes('numero_operacion')) throw conflict('OPERATION_ALREADY_REGISTERED', 'El número de operación ya está registrado.')
        if (target.includes('evento_participante')) throw conflict('ALREADY_REGISTERED', 'Ya tienes una inscripción registrada en este evento.')
        if (target.includes('participantes_correo')) throw conflict('EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')
        throw conflict('DUPLICATE_RECORD', 'Ya existe un registro con estos datos.')
    }
    throw error
}

/** La inscripción creada y si se conservó el correo registrado en lugar del enviado (spec 014). */
export type InscripcionCreada = InscripcionDetalle & { correoConservado: boolean }

/** El correo no puede pertenecer a otra persona (409 `EMAIL_IN_USE`). */
async function exigirCorreoLibre(tx: Prisma.TransactionClient, correo: string, participanteId: number | null): Promise<void> {
    const dueno = await tx.participante.findUnique({ where: { correo } })
    if (dueno && dueno.id !== participanteId) throw conflict('EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')
}

/**
 * Crea una inscripción (spec 002): valida evento y tipo, calcula el precio en el servidor,
 * reutiliza al participante por documento y crea la inscripción en estado PENDIENTE.
 *
 * Correo al reinscribirse (spec 014): el correo es la llave del portal y de la credencial, y el
 * formulario público no prueba que quien lo envía sea el dueño del documento (verificar con Google
 * solo prueba que controla el correo **nuevo**). Por eso un correo distinto del registrado nunca lo
 * reemplaza desde aquí, venga o no verificado: la inscripción se hace con el participante tal cual
 * (correo y celular registrados), `correoConservado` es `true` y se avisa al correo registrado. El
 * precio por dominio institucional y `esCorreoInstitucional` salen del correo con que queda la
 * inscripción. Cambiar el correo lo hace el staff (`PUT /v1/participants/:id`, con aviso al anterior).
 */
export async function crearInscripcion(evento: Evento, input: CrearInscripcionInput, voucherArchivo: string | null, opciones: OpcionesCreacion = {}): Promise<InscripcionCreada> {
    if (!inscripcionesAbiertas(evento)) throw conflict('REGISTRATION_CLOSED', 'Las inscripciones para este evento están cerradas.')
    if (!voucherArchivo && !opciones.legacy) throw unprocessable('VOUCHER_REQUIRED', 'Adjunta el voucher de pago.')

    const tipo = await prisma.tipoInscripcion.findFirst({
        where: { id: input.tipoInscripcionId, activo: true, categoria: { eventoId: evento.id } },
        include: { categoria: true },
    })
    if (!tipo) throw unprocessable('REGISTRATION_TYPE_INVALID', 'El tipo de inscripción no existe o no está disponible para este evento.')
    if (input.clasificacionId) {
        const clasificacion = await prisma.clasificacion.findUnique({ where: { id: input.clasificacionId } })
        if (!clasificacion) throw unprocessable('CLASSIFICATION_INVALID', 'La clasificación seleccionada no existe.')
    }

    const p = input.participante
    const correo = p.correo.trim().toLowerCase()

    // Nombres oficiales (RENIEC) si el DNI ya fue consultado; si no, los enviados.
    const oficiales = p.tipoDocumento === 'dni' ? await nombresOficiales(p.numeroDocumento) : null
    const nombres = oficiales?.nombres ?? p.nombres
    const apellidos = oficiales ? apellidosDe(oficiales) : p.apellidos

    let verificacion: ResultadoVerificacion | null = null
    if (tipo.categoria.esEstudiantil) {
        verificacion = opciones.legacy
            ? (esCorreoInstitucional(correo, evento.dominioInstitucional) ? await verificarEstudiante(evento, { correo, tipoDocumento: p.tipoDocumento, numeroDocumento: p.numeroDocumento }) : null)
            : leerVerificacion(input.verificacionToken, { eventoId: evento.id, tipoDocumento: p.tipoDocumento, numeroDocumento: p.numeroDocumento, correo })
    }

    /** Precio con el correo con que queda la inscripción (el ingresado o, si se conserva, el registrado). */
    const precioPara = (correoFinal: string) => {
        const correoInstitucional = esCorreoInstitucional(correoFinal, evento.dominioInstitucional)
        const precio = calcularPrecio({
            precio: monto(tipo.precio),
            precioInstitucional: monto(tipo.precioInstitucional),
            esEstudiantil: tipo.categoria.esEstudiantil,
            estudianteUndcVerificado: verificacion?.esEstudianteUndc ?? false,
            correoInstitucional,
            legacy: opciones.legacy,
        })
        return { ...precio, correoInstitucional }
    }

    // Evidencia opcional de que el correo se verificó con Google; no cambia el precio (spec 010)
    const verificacionCorreo = opciones.legacy ? null : leerVerificacionCorreo(input.verificacionCorreoToken, { eventoId: evento.id, correo })

    const snapshot = tipo.categoria.esEstudiantil
        ? (verificacion ? aSnapshot(verificacion) : { esEstudianteUndc: false, motivo: 'SIN_VERIFICACION', verificadoEn: new Date().toISOString() })
        : null

    try {
        // Si el código de la credencial choca con otro (improbable), se repite la transacción con uno nuevo
        const { inscripcion: creada, correoConservado } = await conReintentoDeCodigo(() => prisma.$transaction(async (tx) => {
            let participante = await tx.participante.findUnique({
                where: { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: p.tipoDocumento, numeroDocumento: p.numeroDocumento } },
            })
            let conservado = false
            // Correo con que queda la inscripción: el ingresado o, si se conserva, el registrado
            let correoFinal = correo

            if (participante) {
                const existente = await tx.inscripcion.findUnique({ where: { eventoId_participanteId: { eventoId: evento.id, participanteId: participante.id } } })
                if (existente) throw conflict('ALREADY_REGISTERED', 'Ya tienes una inscripción registrada en este evento.')
                conservado = participante.correo.toLowerCase() !== correo
                correoFinal = participante.correo
                if (conservado) {
                    // Quien envió el formulario no probó ser el dueño del registro (ni con Google: eso
                    // solo prueba el correo nuevo): no se toca su contacto ni su vínculo con Google; los
                    // nombres oficiales (RENIEC) sí se actualizan
                    if (oficiales) participante = await tx.participante.update({ where: { id: participante.id }, data: { nombres, apellidos } })
                } else {
                    participante = await tx.participante.update({
                        where: { id: participante.id },
                        data: { celular: p.celular, ...(oficiales ? { nombres, apellidos } : {}) },
                    })
                }
            } else {
                await exigirCorreoLibre(tx, correo, null)
                participante = await tx.participante.create({
                    data: { tipoDocumentoId: p.tipoDocumento, numeroDocumento: p.numeroDocumento, nombres, apellidos, correo, celular: p.celular },
                })
            }

            const precio = precioPara(correoFinal)
            // La verificación con Google es del correo ingresado: si se conservó el registrado, no aplica
            const correoVerificado = conservado ? null : verificacionCorreo
            const inscripcion = await tx.inscripcion.create({
                data: {
                    evento: { connect: { id: evento.id } },
                    participante: { connect: { id: participante.id } },
                    tipoInscripcion: { connect: { id: tipo.id } },
                    ...(input.clasificacionId ? { clasificacion: { connect: { id: input.clasificacionId } } } : {}),
                    estado: { connect: { codigo: 'PENDIENTE' } },
                    codigoCredencial: nuevoCodigoCredencial(),
                    modalidadPago: input.modalidadPago,
                    banco: input.modalidadPago === 'banco' ? input.banco ?? null : null,
                    tipoOperacion: input.modalidadPago === 'banco' ? input.tipoOperacion ?? null : null,
                    billeteraDigital: input.modalidadPago === 'billetera' ? input.billeteraDigital ?? null : null,
                    numeroOperacion: input.numeroOperacion.trim(),
                    fechaPago: aColumnaFecha(input.fechaPago),
                    voucherArchivo,
                    monto: precio.monto,
                    descuento: precio.descuento,
                    tieneDescuento: precio.descuento > 0,
                    esCorreoInstitucional: precio.correoInstitucional,
                    esEstudianteUndc: verificacion?.esEstudianteUndc ?? false,
                    codigoEstudiante: verificacion?.esEstudianteUndc ? verificacion.codigoEstudiante : null,
                    verificacionEstudiante: snapshot ?? Prisma.JsonNull,
                    esCorreoVerificado: Boolean(correoVerificado),
                    verificacionCorreo: correoVerificado
                        ? { metodo: correoVerificado.metodo, tipoCuenta: correoVerificado.tipoCuenta, hd: correoVerificado.hd, verificadoEn: correoVerificado.verificadoEn }
                        : Prisma.JsonNull,
                },
                include: detalleInclude,
            })
            return { inscripcion, correoConservado: conservado }
        }))
        if (correoConservado) {
            const ingresado = enmascararCorreo(correo)
            enDiferido(`el aviso de correo conservado (inscripción ${creada.id})`, () => enviarAvisoCorreoConservado(creada, ingresado))
        }
        return { ...creada, correoConservado }
    } catch (error) {
        return errorDeUnicidad(error)
    }
}

// ─── Consultas administrativas ──────────────────────────────────────────────

export interface FiltrosInscripcion {
    estado?: string
    tipoInscripcionId?: number
    categoria?: string
    esEstudianteUndc?: boolean
    q?: string
}

/** Sin `conPago` la búsqueda libre no mira el número de operación (es un dato de pago). */
export function construirFiltro(eventoId: number, filtros: FiltrosInscripcion, conPago = true): Prisma.InscripcionWhereInput {
    const q = filtros.q?.trim()
    return {
        eventoId,
        ...(filtros.estado ? { estado: { codigo: filtros.estado } } : {}),
        ...(filtros.tipoInscripcionId ? { tipoInscripcionId: filtros.tipoInscripcionId } : {}),
        ...(filtros.categoria ? { tipoInscripcion: { categoria: { codigo: filtros.categoria } } } : {}),
        ...(filtros.esEstudianteUndc !== undefined ? { esEstudianteUndc: filtros.esEstudianteUndc } : {}),
        ...(q
            ? {
                OR: [
                    ...(conPago ? [{ numeroOperacion: { contains: q } }] : []),
                    { participante: { numeroDocumento: { contains: q } } },
                    { participante: { nombres: { contains: q } } },
                    { participante: { apellidos: { contains: q } } },
                    { participante: { correo: { contains: q } } },
                ],
            }
            : {}),
    }
}

export async function listarInscripciones(eventoId: number, filtros: FiltrosInscripcion, paginacion: Pagination, conPago = true) {
    const where = construirFiltro(eventoId, filtros, conPago)
    const [total, filas] = await Promise.all([
        prisma.inscripcion.count({ where }),
        prisma.inscripcion.findMany({ where, include: detalleInclude, orderBy: { id: 'desc' }, skip: paginacion.skip, take: paginacion.take }),
    ])
    return { data: filas.map((fila) => aFilaLista(fila, conPago)), meta: pageMeta(paginacion, total) }
}

export function todasLasInscripciones(eventoId: number): Promise<InscripcionDetalle[]> {
    return prisma.inscripcion.findMany({ where: { eventoId }, include: detalleInclude, orderBy: { id: 'asc' } })
}

export async function obtenerInscripcion(id: number): Promise<InscripcionDetalle> {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id }, include: detalleInclude })
    if (!inscripcion) throw notFound('INSCRIPTION_NOT_FOUND', `Inscripción con id ${id} no encontrada`)
    return inscripcion
}

const instante = (fecha?: Date | null) => fecha?.getTime() ?? 0

/** Si el PDF existe y se generó después de `desde` (ms). */
function pdfVigente(ruta: string, desde: number): boolean {
    try {
        return fs.statSync(ruta).mtimeMs >= desde
    } catch {
        return false
    }
}

/**
 * La inscripción con su código de credencial. Las creadas por la imagen anterior no tienen: se les
 * asigna uno (ver `asegurarCodigoCredencial`).
 */
async function conCodigo(inscripcion: InscripcionDetalle): Promise<InscripcionDetalle> {
    if (inscripcion.codigoCredencial) return inscripcion
    return { ...inscripcion, codigoCredencial: await asegurarCodigoCredencial(inscripcion.id) }
}

/**
 * PDF de la credencial ya generado o uno nuevo si no existe (el nombre lleva la huella de lo que se
 * imprime, spec 014) o es anterior al último cambio de la persona o del evento.
 * `inscripcion.actualizadoEn` no sirve para esto: cambia con cada envío.
 */
async function pdfDeCredencial(inscripcion: InscripcionDetalle): Promise<string> {
    const ruta = rutaCredencial(inscripcion)
    const ultimoCambio = Math.max(instante(inscripcion.participante.actualizadoEn), instante(inscripcion.evento.actualizadoEn))
    return pdfVigente(ruta, ultimoCambio) ? ruta : generarCredencialPdf(inscripcion)
}

/**
 * Envía la credencial y registra la fecha de envío. Nunca lanza. Al aprobar se genera de nuevo (la
 * fecha de aprobación cambia); al reenviar se reutiliza el PDF ya generado si sigue al día.
 */
async function emitirCredencial(registro: InscripcionDetalle, reutilizarPdf = false): Promise<boolean> {
    try {
        const inscripcion = await conCodigo(registro)
        const pdf = reutilizarPdf ? await pdfDeCredencial(inscripcion) : await generarCredencialPdf(inscripcion)
        const enviado = await enviarCorreoAprobacion(inscripcion, pdf)
        if (enviado) await prisma.inscripcion.update({ where: { id: inscripcion.id }, data: { credencialEnviadaEn: new Date() } })
        return enviado
    } catch {
        console.error('No se pudo generar o enviar la credencial de una inscripción')
        return false
    }
}

export async function cambiarEstado(id: number, codigo: CodigoEstadoInscripcion, motivo: string | null | undefined, adminId?: number) {
    const actual = await obtenerInscripcion(id)
    const aprueba = codigo === 'APROBADO' && actual.estado.codigo !== 'APROBADO'
    // El código se asigna antes de aprobar: así una inscripción de la imagen anterior que se aprueba
    // ahora no queda marcada con el QR anterior (`esQrLegado`)
    if (aprueba && !actual.codigoCredencial) await asegurarCodigoCredencial(id)
    const actualizada = await prisma.inscripcion.update({
        where: { id },
        data: {
            estado: { connect: { codigo } },
            motivoRechazo: codigo === 'RECHAZADO' ? (motivo ?? null) : null,
            revisadoEn: new Date(),
            ...(adminId ? { revisadoPor: { connect: { id: adminId } } } : {}),
        },
        include: detalleInclude,
    })
    let credencialEnviada: boolean | null = null
    if (aprueba) credencialEnviada = await emitirCredencial(actualizada)
    return { inscripcion: await obtenerInscripcion(id), credencialEnviada }
}

export async function reenviarCredencial(id: number) {
    const inscripcion = await obtenerInscripcion(id)
    if (inscripcion.estado.codigo !== 'APROBADO') throw conflict('NOT_APPROVED', 'Solo se puede reenviar la credencial de inscripciones aprobadas.')
    return { credencialEnviada: await emitirCredencial(inscripcion, true) }
}

export async function archivoCredencial(id: number): Promise<string> {
    const inscripcion = await obtenerInscripcion(id)
    if (inscripcion.estado.codigo !== 'APROBADO') throw conflict('NOT_APPROVED', 'La credencial solo existe para inscripciones aprobadas.')
    return pdfDeCredencial(await conCodigo(inscripcion))
}

export async function archivoVoucher(id: number): Promise<string> {
    const inscripcion = await obtenerInscripcion(id)
    if (!inscripcion.voucherArchivo) throw notFound('VOUCHER_NOT_FOUND', 'La inscripción no tiene voucher.')
    const ruta = uploadedFilePath(inscripcion.voucherArchivo)
    if (!fs.existsSync(ruta)) throw notFound('VOUCHER_NOT_FOUND', 'El archivo del voucher no existe en el servidor.')
    return ruta
}

export async function eliminarInscripcion(id: number) {
    const inscripcion = await obtenerInscripcion(id)
    await prisma.inscripcion.delete({ where: { id } })
    const voucher = inscripcion.voucherArchivo ? uploadedFilePath(inscripcion.voucherArchivo) : null
    if (voucher && fs.existsSync(voucher)) fs.unlinkSync(voucher)
    borrarCredenciales(id)
}

// ─── Cortesía y foto para el escáner (spec 014) ─────────────────────────────

const PREFIJO_CORTESIA = 'CORTESIA-'

/**
 * Número de operación de una cortesía: `CORTESIA-` y 12 hexadecimales aleatorios, **independientes
 * del código de la credencial**: el número sale en listados, CSV y búsquedas, y con el código
 * cualquiera podría armar el QR de la persona.
 */
function numeroOperacionCortesia(): string {
    return `${PREFIJO_CORTESIA}${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

/**
 * Un choque del número de operación de una cortesía (aleatorio, improbable) se trata como uno del
 * código para que `conReintentoDeCodigo` repita la creación con valores nuevos.
 */
function comoColisionDeCodigo(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('numero_operacion')) {
        return new Prisma.PrismaClientKnownRequestError(error.message, { code: 'P2002', clientVersion: error.clientVersion, meta: { target: INDICE_CODIGO_CREDENCIAL } })
    }
    return error
}

/**
 * Inscripción de cortesía (organizadores, ponentes, invitados): nace APROBADO, con monto 0,
 * modalidad `cortesia` y número de operación `CORTESIA-<12 hex aleatorios>`; queda revisada por
 * quien la registra. Con `enviarCredencial` genera y envía la credencial como al aprobar (si el envío
 * falla, la inscripción se mantiene y `credencialEnviada` es `false`).
 */
export async function crearInscripcionCortesia(eventoId: number, input: CortesiaInput, adminId: number) {
    const evento = await obtenerEventoPorId(eventoId)
    const participante = await prisma.participante.findUnique({ where: { id: input.participanteId } })
    if (!participante) throw notFound('PARTICIPANT_NOT_FOUND', `Participante con id ${input.participanteId} no encontrado`)
    if (input.tipoInscripcionId) {
        const tipo = await prisma.tipoInscripcion.findFirst({ where: { id: input.tipoInscripcionId, categoria: { eventoId: evento.id } }, select: { id: true } })
        if (!tipo) throw unprocessable('REGISTRATION_TYPE_INVALID', 'El tipo de inscripción no existe o no pertenece a este evento.')
    }
    const existente = await prisma.inscripcion.findUnique({
        where: { eventoId_participanteId: { eventoId: evento.id, participanteId: participante.id } },
        select: { id: true },
    })
    if (existente) throw conflict('ALREADY_REGISTERED', 'La persona ya tiene una inscripción en este evento.')

    const ahora = new Date()
    let creada: InscripcionDetalle
    try {
        creada = await conReintentoDeCodigo(async () => {
            try {
                return await prisma.inscripcion.create({
                    data: {
                        evento: { connect: { id: evento.id } },
                        participante: { connect: { id: participante.id } },
                        ...(input.tipoInscripcionId ? { tipoInscripcion: { connect: { id: input.tipoInscripcionId } } } : {}),
                        estado: { connect: { codigo: 'APROBADO' } },
                        codigoCredencial: nuevoCodigoCredencial(),
                        modalidadPago: 'cortesia',
                        numeroOperacion: numeroOperacionCortesia(),
                        fechaPago: aColumnaFecha(fechaLima(ahora)),
                        monto: 0,
                        descuento: 0,
                        tieneDescuento: false,
                        esCorreoInstitucional: esCorreoInstitucional(participante.correo, evento.dominioInstitucional),
                        verificacionEstudiante: Prisma.JsonNull,
                        verificacionCorreo: Prisma.JsonNull,
                        revisadoEn: ahora,
                        revisadoPor: { connect: { id: adminId } },
                    },
                    include: detalleInclude,
                })
            } catch (error) {
                throw comoColisionDeCodigo(error)
            }
        })
    } catch (error) {
        return errorDeUnicidad(error)
    }

    if (!input.enviarCredencial) return { inscripcion: creada, credencialEnviada: null }
    const credencialEnviada = await emitirCredencial(creada)
    return { inscripcion: await obtenerInscripcion(creada.id), credencialEnviada }
}

/**
 * Foto del participante de una inscripción, para el escáner de asistencia y el panel. 404
 * `PHOTO_NOT_FOUND` si no tiene o el archivo ya no está.
 */
export async function archivoFoto(inscripcionId: number): Promise<string> {
    const fila = await prisma.inscripcion.findUnique({ where: { id: inscripcionId }, select: { participante: { select: { fotoArchivo: true } } } })
    if (!fila) throw notFound('INSCRIPTION_NOT_FOUND', `Inscripción con id ${inscripcionId} no encontrada`)
    const ruta = rutaFoto(fila.participante.fotoArchivo)
    if (!ruta || !fs.existsSync(ruta)) throw notFound('PHOTO_NOT_FOUND', 'El participante no tiene foto.')
    return ruta
}

// ─── Exportación CSV ────────────────────────────────────────────────────────

/** Celda CSV segura: escapa comillas y neutraliza fórmulas (inyección CSV). */
export function celdaCsv(valor: unknown): string {
    let texto = valor === null || valor === undefined ? '' : String(valor)
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/** Columnas del CSV. Las de pago solo salen con `conPago`. */
const COLUMNAS_CSV: Array<{ titulo: string, pago?: true, valor: (d: ReturnType<typeof aDetalle>) => unknown }> = [
    { titulo: 'ID', valor: (d) => d.id },
    { titulo: 'Fecha registro', valor: (d) => fechaLima(d.creadoEn) },
    { titulo: 'Tipo doc.', valor: (d) => d.participante.tipoDocumento.toUpperCase() },
    { titulo: 'N° documento', valor: (d) => d.participante.numeroDocumento },
    { titulo: 'Nombres', valor: (d) => d.participante.nombres },
    { titulo: 'Apellidos', valor: (d) => d.participante.apellidos },
    { titulo: 'Correo', valor: (d) => d.participante.correo },
    { titulo: 'Celular', valor: (d) => d.participante.celular },
    { titulo: 'Categoría', valor: (d) => d.tipoInscripcion?.categoria.nombre },
    { titulo: 'Tipo de inscripción', valor: (d) => d.tipoInscripcion?.nombre },
    { titulo: 'Etiqueta', valor: (d) => d.tipoInscripcion?.etiqueta },
    { titulo: 'Clasificación', valor: (d) => d.clasificacion?.nombre },
    { titulo: 'Monto', pago: true, valor: (d) => d.pago.monto?.toFixed(2) },
    { titulo: 'Descuento', pago: true, valor: (d) => d.pago.descuento?.toFixed(2) },
    { titulo: 'Estudiante UNDC', valor: (d) => (d.verificacion.esEstudianteUndc ? 'Sí' : 'No') },
    { titulo: 'Código estudiante', valor: (d) => d.verificacion.codigoEstudiante },
    { titulo: 'Correo verificado', valor: (d) => (d.verificacion.correo.verificado ? 'Sí (Google)' : 'No') },
    { titulo: 'Modalidad', pago: true, valor: (d) => d.pago.modalidad },
    { titulo: 'Banco / billetera', pago: true, valor: (d) => d.pago.banco ?? d.pago.billeteraDigital },
    { titulo: 'N° operación', pago: true, valor: (d) => d.pago.numeroOperacion },
    { titulo: 'Fecha de pago', pago: true, valor: (d) => d.pago.fechaPago },
    { titulo: 'Estado', valor: (d) => d.estado.nombre },
    { titulo: 'Revisado', valor: (d) => (d.revision.revisadoEn ? fechaLima(d.revision.revisadoEn) : '') },
    { titulo: 'Motivo de rechazo', valor: (d) => d.revision.motivoRechazo },
]

export async function exportarCsv(eventoId: number, filtros: FiltrosInscripcion, conPago = true): Promise<string> {
    const filas = await prisma.inscripcion.findMany({ where: construirFiltro(eventoId, filtros, conPago), include: detalleInclude, orderBy: { id: 'asc' } })
    const columnas = COLUMNAS_CSV.filter((columna) => conPago || !columna.pago)
    const lineas = filas.map((fila) => {
        const d = aDetalle(fila, conPago)
        return columnas.map((columna) => celdaCsv(columna.valor(d))).join(';')
    })
    return '﻿' + [columnas.map((columna) => columna.titulo).join(';'), ...lineas].join('\r\n')
}

import fs from 'fs'
import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { monto, type CodigoEstadoInscripcion } from '../../../core/catalogos'
import { pageMeta, type Pagination } from '../../../core/pagination'
import { uploadedFilePath } from '../../../middlewares/upload'
import { inscripcionesAbiertas } from '../../event/services/public-event'
import { apellidosDe, nombresOficiales } from '../../document-lookup/services/cache'
import { leerVerificacion, type ResultadoVerificacion } from '../../student-verification/services/verification-token'
import { aSnapshot, verificarEstudiante } from '../../student-verification/services/student-verification'
import { leerVerificacionCorreo } from '../../google-auth/services/verificacion-correo'
import { generarCredencialPdf, rutaCredencial } from '../utils/generatePdf'
import { enviarCorreoAprobacion } from '../utils/sendEmail'
import { calcularPrecio, esCorreoInstitucional } from './pricing'
import { aDetalle, aFilaLista, detalleInclude, type InscripcionDetalle } from './mappers'
import type { CrearInscripcionInput } from '../validation'

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

/**
 * Crea una inscripción (spec 002): valida evento y tipo, calcula el precio en el servidor,
 * reutiliza al participante por documento y crea la inscripción en estado PENDIENTE.
 */
export async function crearInscripcion(evento: Evento, input: CrearInscripcionInput, voucherArchivo: string | null, opciones: OpcionesCreacion = {}) {
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

    const correoInstitucional = esCorreoInstitucional(correo, evento.dominioInstitucional)
    let verificacion: ResultadoVerificacion | null = null
    if (tipo.categoria.esEstudiantil) {
        verificacion = opciones.legacy
            ? (correoInstitucional ? await verificarEstudiante(evento, { correo, tipoDocumento: p.tipoDocumento, numeroDocumento: p.numeroDocumento }) : null)
            : leerVerificacion(input.verificacionToken, { eventoId: evento.id, tipoDocumento: p.tipoDocumento, numeroDocumento: p.numeroDocumento, correo })
    }

    const precio = calcularPrecio({
        precio: monto(tipo.precio),
        precioInstitucional: monto(tipo.precioInstitucional),
        esEstudiantil: tipo.categoria.esEstudiantil,
        estudianteUndcVerificado: verificacion?.esEstudianteUndc ?? false,
        correoInstitucional,
        legacy: opciones.legacy,
    })

    // Evidencia opcional de que el correo se verificó con Google; no cambia el precio (spec 010)
    const verificacionCorreo = opciones.legacy ? null : leerVerificacionCorreo(input.verificacionCorreoToken, { eventoId: evento.id, correo })

    const snapshot = tipo.categoria.esEstudiantil
        ? (verificacion ? aSnapshot(verificacion) : { esEstudianteUndc: false, motivo: 'SIN_VERIFICACION', verificadoEn: new Date().toISOString() })
        : null

    try {
        const creada = await prisma.$transaction(async (tx) => {
            let participante = await tx.participante.findUnique({
                where: { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: p.tipoDocumento, numeroDocumento: p.numeroDocumento } },
            })
            const duenoCorreo = await tx.participante.findUnique({ where: { correo } })
            if (duenoCorreo && duenoCorreo.id !== participante?.id) throw conflict('EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')

            if (participante) {
                const existente = await tx.inscripcion.findUnique({ where: { eventoId_participanteId: { eventoId: evento.id, participanteId: participante.id } } })
                if (existente) throw conflict('ALREADY_REGISTERED', 'Ya tienes una inscripción registrada en este evento.')
                const cambiaCorreo = participante.correo.toLowerCase() !== correo
                participante = await tx.participante.update({
                    where: { id: participante.id },
                    data: {
                        correo,
                        celular: p.celular,
                        ...(oficiales ? { nombres, apellidos } : {}),
                        // Un correo nuevo invalida el vínculo con la cuenta Google anterior
                        ...(cambiaCorreo ? { googleSub: null, googleVinculadoEn: null } : {}),
                    },
                })
            } else {
                participante = await tx.participante.create({
                    data: { tipoDocumentoId: p.tipoDocumento, numeroDocumento: p.numeroDocumento, nombres, apellidos, correo, celular: p.celular },
                })
            }

            return tx.inscripcion.create({
                data: {
                    evento: { connect: { id: evento.id } },
                    participante: { connect: { id: participante.id } },
                    tipoInscripcion: { connect: { id: tipo.id } },
                    ...(input.clasificacionId ? { clasificacion: { connect: { id: input.clasificacionId } } } : {}),
                    estado: { connect: { codigo: 'PENDIENTE' } },
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
                    esCorreoInstitucional: correoInstitucional,
                    esEstudianteUndc: verificacion?.esEstudianteUndc ?? false,
                    codigoEstudiante: verificacion?.esEstudianteUndc ? verificacion.codigoEstudiante : null,
                    verificacionEstudiante: snapshot ?? Prisma.JsonNull,
                    esCorreoVerificado: Boolean(verificacionCorreo),
                    verificacionCorreo: verificacionCorreo
                        ? { metodo: verificacionCorreo.metodo, tipoCuenta: verificacionCorreo.tipoCuenta, hd: verificacionCorreo.hd, verificadoEn: verificacionCorreo.verificadoEn }
                        : Prisma.JsonNull,
                },
                include: detalleInclude,
            })
        })
        return creada
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

export function construirFiltro(eventoId: number, filtros: FiltrosInscripcion): Prisma.InscripcionWhereInput {
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
                    { numeroOperacion: { contains: q } },
                    { participante: { numeroDocumento: { contains: q } } },
                    { participante: { nombres: { contains: q } } },
                    { participante: { apellidos: { contains: q } } },
                    { participante: { correo: { contains: q } } },
                ],
            }
            : {}),
    }
}

export async function listarInscripciones(eventoId: number, filtros: FiltrosInscripcion, paginacion: Pagination) {
    const where = construirFiltro(eventoId, filtros)
    const [total, filas] = await Promise.all([
        prisma.inscripcion.count({ where }),
        prisma.inscripcion.findMany({ where, include: detalleInclude, orderBy: { id: 'desc' }, skip: paginacion.skip, take: paginacion.take }),
    ])
    return { data: filas.map(aFilaLista), meta: pageMeta(paginacion, total) }
}

export function todasLasInscripciones(eventoId: number): Promise<InscripcionDetalle[]> {
    return prisma.inscripcion.findMany({ where: { eventoId }, include: detalleInclude, orderBy: { id: 'asc' } })
}

export async function obtenerInscripcion(id: number): Promise<InscripcionDetalle> {
    const inscripcion = await prisma.inscripcion.findUnique({ where: { id }, include: detalleInclude })
    if (!inscripcion) throw notFound('INSCRIPTION_NOT_FOUND', `Inscripción con id ${id} no encontrada`)
    return inscripcion
}

/** Genera la credencial, la envía y registra la fecha de envío. Nunca lanza. */
async function emitirCredencial(inscripcion: InscripcionDetalle): Promise<boolean> {
    try {
        const pdf = await generarCredencialPdf(inscripcion)
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
    if (codigo === 'APROBADO' && actual.estado.codigo !== 'APROBADO') credencialEnviada = await emitirCredencial(actualizada)
    return { inscripcion: await obtenerInscripcion(id), credencialEnviada }
}

export async function reenviarCredencial(id: number) {
    const inscripcion = await obtenerInscripcion(id)
    if (inscripcion.estado.codigo !== 'APROBADO') throw conflict('NOT_APPROVED', 'Solo se puede reenviar la credencial de inscripciones aprobadas.')
    return { credencialEnviada: await emitirCredencial(inscripcion) }
}

export async function archivoCredencial(id: number): Promise<string> {
    const inscripcion = await obtenerInscripcion(id)
    if (inscripcion.estado.codigo !== 'APROBADO') throw conflict('NOT_APPROVED', 'La credencial solo existe para inscripciones aprobadas.')
    const ruta = rutaCredencial(inscripcion)
    return fs.existsSync(ruta) ? ruta : generarCredencialPdf(inscripcion)
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
    for (const ruta of [inscripcion.voucherArchivo ? uploadedFilePath(inscripcion.voucherArchivo) : null, rutaCredencial(inscripcion)]) {
        if (ruta && fs.existsSync(ruta)) fs.unlinkSync(ruta)
    }
}

// ─── Exportación CSV ────────────────────────────────────────────────────────

/** Celda CSV segura: escapa comillas y neutraliza fórmulas (inyección CSV). */
export function celdaCsv(valor: unknown): string {
    let texto = valor === null || valor === undefined ? '' : String(valor)
    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export async function exportarCsv(eventoId: number, filtros: FiltrosInscripcion): Promise<string> {
    const filas = await prisma.inscripcion.findMany({ where: construirFiltro(eventoId, filtros), include: detalleInclude, orderBy: { id: 'asc' } })
    const encabezado = ['ID', 'Fecha registro', 'Tipo doc.', 'N° documento', 'Nombres', 'Apellidos', 'Correo', 'Celular', 'Categoría',
        'Tipo de inscripción', 'Etiqueta', 'Clasificación', 'Monto', 'Descuento', 'Estudiante UNDC', 'Código estudiante', 'Correo verificado', 'Modalidad',
        'Banco / billetera', 'N° operación', 'Fecha de pago', 'Estado', 'Revisado', 'Motivo de rechazo']
    const lineas = filas.map((fila) => {
        const d = aDetalle(fila)
        return [
            d.id, fechaLima(d.creadoEn), d.participante.tipoDocumento.toUpperCase(), d.participante.numeroDocumento, d.participante.nombres,
            d.participante.apellidos, d.participante.correo, d.participante.celular, d.tipoInscripcion?.categoria.nombre, d.tipoInscripcion?.nombre,
            d.tipoInscripcion?.etiqueta, d.clasificacion?.nombre, d.pago.monto.toFixed(2), d.pago.descuento.toFixed(2),
            d.verificacion.esEstudianteUndc ? 'Sí' : 'No', d.verificacion.codigoEstudiante, d.verificacion.correo.verificado ? 'Sí (Google)' : 'No', d.pago.modalidad,
            d.pago.banco ?? d.pago.billeteraDigital, d.pago.numeroOperacion, d.pago.fechaPago, d.estado.nombre,
            d.revision.revisadoEn ? fechaLima(d.revision.revisadoEn) : '', d.revision.motivoRechazo,
        ].map(celdaCsv).join(';')
    })
    return '﻿' + [encabezado.join(';'), ...lineas].join('\r\n')
}

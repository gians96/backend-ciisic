import type { Prisma } from '@prisma/client'
import { fechaSoloDia } from '../../../core/fechas'
import { monto } from '../../../core/catalogos'
import { enmascararCorreo } from '../../../core/codigos'
import { mimeDeArchivo } from '../../../middlewares/upload'

/** Relaciones que se cargan para mostrar una inscripción completa. */
export const detalleInclude = {
    participante: true,
    tipoInscripcion: { include: { categoria: true } },
    clasificacion: true,
    estado: true,
    evento: true,
    revisadoPor: { select: { id: true, nombres: true, apellidos: true } },
} satisfies Prisma.InscripcionInclude

export type InscripcionDetalle = Prisma.InscripcionGetPayload<{ include: typeof detalleInclude }>

/** Datos del pago de una inscripción (monto, operación, voucher). */
function pagoDe(i: InscripcionDetalle) {
    return {
        monto: monto(i.monto),
        descuento: monto(i.descuento),
        tieneDescuento: i.tieneDescuento,
        modalidad: i.modalidadPago,
        banco: i.banco,
        tipoOperacion: i.tipoOperacion,
        billeteraDigital: i.billeteraDigital,
        numeroOperacion: i.numeroOperacion,
        fechaPago: fechaSoloDia(i.fechaPago),
        tieneVoucher: Boolean(i.voucherArchivo),
        voucherMime: i.voucherArchivo ? mimeDeArchivo(i.voucherArchivo) : null,
    }
}

/**
 * Pago sin «pagos.ver» (spec 013): las mismas claves con los datos en null y sin voucher. Es un
 * objeto y no `null` porque el panel anterior lee `pago.tieneVoucher` y `pago.monto` sin comprobarlo.
 */
function pagoOculto() {
    return {
        monto: null,
        descuento: null,
        tieneDescuento: null,
        modalidad: null,
        banco: null,
        tipoOperacion: null,
        billeteraDigital: null,
        numeroOperacion: null,
        fechaPago: null,
        tieneVoucher: false,
        voucherMime: null,
    }
}

/**
 * Inscripción completa para el panel. Sin `conPago` (cuentas sin «pagos.ver», spec 013) los datos
 * de `pago` y los precios del tipo van en null.
 */
export function aDetalle(i: InscripcionDetalle, conPago = true) {
    return {
        id: i.id,
        eventoId: i.eventoId,
        evento: { id: i.evento.id, codigo: i.evento.codigo, nombreCorto: i.evento.nombreCorto },
        creadoEn: i.creadoEn,
        actualizadoEn: i.actualizadoEn,
        /** Código del QR del fotocheck (spec 014). No va en los listados ni en el CSV. */
        codigoCredencial: i.codigoCredencial,
        esQrLegado: i.esQrLegado,
        participante: {
            id: i.participante.id,
            tipoDocumento: i.participante.tipoDocumentoId,
            numeroDocumento: i.participante.numeroDocumento,
            nombres: i.participante.nombres,
            apellidos: i.participante.apellidos,
            correo: i.participante.correo,
            celular: i.participante.celular,
        },
        tipoInscripcion: i.tipoInscripcion
            ? {
                id: i.tipoInscripcion.id,
                codigo: i.tipoInscripcion.codigo,
                nombre: i.tipoInscripcion.nombre,
                etiqueta: i.tipoInscripcion.etiqueta,
                precio: conPago ? monto(i.tipoInscripcion.precio) : null,
                precioInstitucional: conPago ? monto(i.tipoInscripcion.precioInstitucional) : null,
                categoria: {
                    id: i.tipoInscripcion.categoria.id,
                    codigo: i.tipoInscripcion.categoria.codigo,
                    nombre: i.tipoInscripcion.categoria.nombre,
                    esEstudiantil: i.tipoInscripcion.categoria.esEstudiantil,
                },
            }
            : null,
        clasificacion: i.clasificacion ? { id: i.clasificacion.id, nombre: i.clasificacion.nombre } : null,
        estado: { id: i.estado.id, codigo: i.estado.codigo, nombre: i.estado.nombre },
        pago: conPago ? pagoDe(i) : pagoOculto(),
        verificacion: {
            esEstudianteUndc: i.esEstudianteUndc,
            esCorreoInstitucional: i.esCorreoInstitucional,
            codigoEstudiante: i.codigoEstudiante,
            detalle: i.verificacionEstudiante ?? null,
            correo: { verificado: i.esCorreoVerificado, detalle: i.verificacionCorreo ?? null },
        },
        revision: {
            motivoRechazo: i.motivoRechazo,
            revisadoPor: i.revisadoPor,
            revisadoEn: i.revisadoEn,
            credencialEnviadaEn: i.credencialEnviadaEn,
        },
    }
}

/** Fila compacta para listados. Sin `conPago` los datos del pago van en null y `tieneVoucher` en false. */
export function aFilaLista(i: InscripcionDetalle, conPago = true) {
    const d = aDetalle(i, conPago)
    return {
        id: d.id,
        creadoEn: d.creadoEn,
        participante: d.participante,
        tipoInscripcion: d.tipoInscripcion ? { id: d.tipoInscripcion.id, nombre: d.tipoInscripcion.nombre, etiqueta: d.tipoInscripcion.etiqueta, categoria: d.tipoInscripcion.categoria.codigo } : null,
        clasificacion: d.clasificacion,
        estado: d.estado,
        monto: d.pago.monto,
        modalidadPago: d.pago.modalidad ?? null,
        numeroOperacion: d.pago.numeroOperacion ?? null,
        fechaPago: d.pago.fechaPago ?? null,
        tieneVoucher: d.pago.tieneVoucher,
        esEstudianteUndc: d.verificacion.esEstudianteUndc,
        esCorreoVerificado: d.verificacion.correo.verificado,
        revisadoEn: d.revision.revisadoEn,
    }
}

/** `987654321` → `*********`: ni un dígito (con un documento ajeno no se debe poder averiguar nada). */
export function ocultarCelular(celular: string): string {
    return '*'.repeat(Math.max(celular.length, 3))
}

/**
 * Contacto que ve quien envió el formulario. Si se conservó el correo registrado (spec 014), quien
 * envió el formulario no lo escribió (pudo ser cualquiera que conozca el documento): el correo sale
 * enmascarado (`a***@g***.com`, para que la persona reconozca cuál es) y el celular, oculto.
 */
function contactoVisible(i: InscripcionDetalle, correoConservado: boolean) {
    return correoConservado
        ? { correo: enmascararCorreo(i.participante.correo), celular: ocultarCelular(i.participante.celular) }
        : { correo: i.participante.correo, celular: i.participante.celular }
}

/**
 * Aviso de la spec 014 para la landing: `correoConservado` es `true` si el documento ya estaba
 * registrado con otro correo (aunque el nuevo venga verificado con Google, o por la ruta legacy).
 */
function avisoCorreo(i: InscripcionDetalle, correoConservado: boolean) {
    return { correoConservado, correoEnmascarado: correoConservado ? enmascararCorreo(i.participante.correo) : null }
}

/** Respuesta pública al crear una inscripción (la persona ve su propio pago). */
export function aCreada(i: InscripcionDetalle, correoConservado = false) {
    const d = aDetalle(i)
    const pago = pagoDe(i)
    return {
        id: d.id,
        evento: { codigo: d.evento.codigo, nombreCorto: d.evento.nombreCorto },
        participante: {
            tipoDocumento: d.participante.tipoDocumento,
            numeroDocumento: d.participante.numeroDocumento,
            nombres: d.participante.nombres,
            apellidos: d.participante.apellidos,
            ...contactoVisible(i, correoConservado),
        },
        tipoInscripcion: d.tipoInscripcion
            ? { id: d.tipoInscripcion.id, nombre: d.tipoInscripcion.nombre, etiqueta: d.tipoInscripcion.etiqueta, categoria: d.tipoInscripcion.categoria.codigo }
            : null,
        clasificacion: d.clasificacion,
        monto: pago.monto,
        precioRegular: d.tipoInscripcion?.precio ?? pago.monto,
        descuento: pago.descuento,
        esEstudianteUndc: d.verificacion.esEstudianteUndc,
        esCorreoVerificado: d.verificacion.correo.verificado,
        modalidadPago: pago.modalidad,
        banco: pago.banco,
        tipoOperacion: pago.tipoOperacion,
        billeteraDigital: pago.billeteraDigital,
        numeroOperacion: pago.numeroOperacion,
        fechaPago: pago.fechaPago,
        estado: { codigo: d.estado.codigo, nombre: d.estado.nombre },
        creadoEn: d.creadoEn,
        ...avisoCorreo(i, correoConservado),
    }
}

/** Forma anterior de la respuesta (landing actual, rutas legacy). */
export function aLegacy(i: InscripcionDetalle) {
    return {
        id: i.id,
        usuarioId: i.participanteId,
        usuario: {
            id: i.participante.id,
            nombres: i.participante.nombres,
            apellidos: i.participante.apellidos,
            correoElectronico: i.participante.correo,
            celular: i.participante.celular,
            numero: i.participante.numeroDocumento,
            dni: i.participante.numeroDocumento,
            idTipoDocumentoId: i.participante.tipoDocumentoId,
        },
        tipoInscripcionId: i.tipoInscripcionId,
        tipoInscripcion: i.tipoInscripcion
            ? { id: i.tipoInscripcion.id, nombre: i.tipoInscripcion.nombre, precio: monto(i.tipoInscripcion.precio), badge: i.tipoInscripcion.etiqueta }
            : null,
        clasificacionId: i.clasificacionId,
        clasificacion: i.clasificacion ? { id: i.clasificacion.id, nombre: i.clasificacion.nombre } : null,
        estadoId: i.estadoId,
        estado: { id: i.estado.id, nombre: i.estado.nombre },
        modalidadDeposito: i.modalidadPago,
        bancoSeleccionado: i.banco,
        tipoOperacion: i.tipoOperacion,
        billeteraDigital: i.billeteraDigital,
        file: i.voucherArchivo,
        numeroOperacion: i.numeroOperacion,
        fechaPago: i.fechaPago,
        pago: monto(i.monto),
        esEmailInstitucional: i.esCorreoInstitucional,
        hasDiscount: i.tieneDescuento,
        descuento: monto(i.descuento),
        creadoEn: i.creadoEn,
        actualizadoEn: i.actualizadoEn,
    }
}

/** Respuesta de la ruta legacy al crear: la forma anterior más el aviso de correo conservado (spec 014). */
export function aLegacyCreada(i: InscripcionDetalle, correoConservado = false) {
    const legacy = aLegacy(i)
    const contacto = contactoVisible(i, correoConservado)
    return {
        ...legacy,
        usuario: { ...legacy.usuario, correoElectronico: contacto.correo, celular: contacto.celular },
        ...avisoCorreo(i, correoConservado),
    }
}

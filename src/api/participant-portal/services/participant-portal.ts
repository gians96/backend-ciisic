import type { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound } from '../../../core/http-error'
import { fechaSoloDia } from '../../../core/fechas'
import { monto } from '../../../core/catalogos'
import { archivoCredencial } from '../../inscription/services/inscription'

/**
 * Portal del inscrito (spec 011): cada participante ve solo sus inscripciones. No expone quién
 * revisó, rutas de archivos ni detalles internos de verificación.
 */
const incluir = {
    evento: true,
    tipoInscripcion: { include: { categoria: true } },
    clasificacion: true,
    estado: true,
} satisfies Prisma.InscripcionInclude

type InscripcionPortal = Prisma.InscripcionGetPayload<{ include: typeof incluir }>

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
        creadoEn: i.creadoEn,
    }
}

export async function miPerfil(participanteId: number) {
    const p = await prisma.participante.findUnique({ where: { id: participanteId } })
    if (!p) throw notFound('PARTICIPANT_NOT_FOUND', 'No encontramos tu registro.')
    return { id: p.id, nombres: p.nombres, apellidos: p.apellidos, correo: p.correo, tipoDocumento: p.tipoDocumentoId, numeroDocumento: p.numeroDocumento }
}

export async function misInscripciones(participanteId: number) {
    const filas = await prisma.inscripcion.findMany({ where: { participanteId }, include: incluir, orderBy: { creadoEn: 'desc' } })
    return filas.map(aInscripcionPortal)
}

/** Ruta del PDF de la credencial, solo si la inscripción es del participante (si no, 404). */
export async function miCredencial(participanteId: number, inscripcionId: number) {
    const propia = await prisma.inscripcion.findFirst({ where: { id: inscripcionId, participanteId }, select: { id: true, evento: { select: { codigo: true } } } })
    if (!propia) throw notFound('INSCRIPTION_NOT_FOUND', 'La inscripción no existe.')
    return { ruta: await archivoCredencial(inscripcionId), nombre: `credencial-${propia.evento.codigo}-${propia.id}.pdf` }
}

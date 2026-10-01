import { prisma } from '../../../database/prisma'
import { HttpError, notFound } from '../../../core/http-error'
import { topeFallosVerificacion, type TopeDeFallos } from '../../../middlewares/rate-limit'
import { fechaSoloDia } from '../../../core/fechas'
import { normalizarCodigo } from '../codigos/codigo'

/**
 * Verificación pública de certificados (spec 015, `GET /v1/public/certificates/:codigo`, sin sesión;
 * excepción a los principios III y IV de la constitución).
 *
 * - Un código con otro formato responde 404 sin consultar la BD.
 * - Solo responden los FIRMADO (`VALIDO`) y los ANULADO; PENDIENTE, PREPARADO y EN_FIRMA son 404
 *   con el mismo mensaje que un código inexistente (un borrador filtrado no «verifica»).
 * - Solo titular (nombre impreso), tipo, evento, fechas y horas: nunca el documento, el correo, el
 *   motivo de la anulación ni el PDF. El código no se adivina (30 bits aleatorios) y la ruta lleva
 *   límite por IP; además, pasado el tope global de códigos inexistentes por minuto, los que no existen
 *   responden 429 (los que existen siguen respondiendo).
 */
export interface EventoVerificado {
    nombre: string
    fechaInicio: string | null
    fechaFin: string | null
}

export interface CertificadoVerificado {
    codigo: string
    estado: 'VALIDO' | 'ANULADO'
    titular: string
    tipo: string
    evento: EventoVerificado
    fechaEmision: string | null
    horas: number | null
    firmadoEn: Date | null
    /** Solo en los anulados. */
    anuladoEn?: Date | null
}

const noEncontrado = () => notFound('CERTIFICATE_NOT_FOUND', 'No encontramos un certificado firmado con ese código.')

/** 404, o 429 si ya se superó el tope global de códigos inexistentes de la ventana. */
function fallo(tope: TopeDeFallos): HttpError {
    if (!tope.registrar()) return noEncontrado()
    console.warn('Tope global de verificaciones fallidas alcanzado')
    return new HttpError(429, 'RATE_LIMITED', 'El servicio de verificación está muy solicitado. Intenta nuevamente en un minuto.', undefined, tope.segundosRestantes())
}

export async function verificarCertificado(codigoEscrito: unknown, tope: TopeDeFallos = topeFallosVerificacion): Promise<CertificadoVerificado> {
    const codigo = normalizarCodigo(codigoEscrito)
    // Un formato inválido no toca la BD ni cuenta para el tope
    if (!codigo) throw noEncontrado()
    const c = await prisma.certificado.findUnique({
        where: { codigo },
        select: {
            codigo: true,
            estado: true,
            nombreImpreso: true,
            fechaEmision: true,
            horas: true,
            firmadoEn: true,
            anuladoEn: true,
            tipo: { select: { nombre: true } },
            evento: { select: { nombre: true, fechaInicio: true, fechaFin: true } },
        },
    })
    if (!c || (c.estado !== 'FIRMADO' && c.estado !== 'ANULADO')) throw fallo(tope)
    const anulado = c.estado === 'ANULADO'
    return {
        codigo: c.codigo,
        estado: anulado ? 'ANULADO' : 'VALIDO',
        titular: c.nombreImpreso,
        tipo: c.tipo.nombre,
        evento: { nombre: c.evento.nombre, fechaInicio: fechaSoloDia(c.evento.fechaInicio), fechaFin: fechaSoloDia(c.evento.fechaFin) },
        fechaEmision: fechaSoloDia(c.fechaEmision),
        horas: c.horas,
        firmadoEn: c.firmadoEn,
        ...(anulado ? { anuladoEn: c.anuladoEn } : {}),
    }
}

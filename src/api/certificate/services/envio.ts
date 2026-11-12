import fs from 'fs'
import path from 'path'
import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { rutaCertificado } from '../../../core/almacenamiento'
import { primerNombre, renderTemplate } from '../../../core/html'
import { conflict, HttpError } from '../../../core/http-error'
import { credencialParaEvento, enviarConCredencial, prepararEnvioMasivo } from '../../email-credential/services/email-credential'
import { conRecuento, type EnviosPorCredencial } from '../../email-credential/services/recuento-envios'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { enlacesDe, exigirOrigenPanel } from './enlaces'

/**
 * Envío de los certificados por correo (spec 015), como los envíos masivos de la spec 039: un correo por persona
 * con su PDF adjunto y los dos enlaces (su certificado y la consulta por DNI). Antes de enviar se **reserva** la
 * marca `enviadoEn` con un `UPDATE` condicionado a lo leído (dos cuentas a la vez no duplican el correo) y, si el
 * envío falla, vuelve a como estaba y se guarda el motivo. Solo salen los certificados con su PDF (`LISTO`).
 */

export interface ResultadoEnvioCertificados {
    enviados: number
    /** Ya se habían enviado (y no se pidió reenviar), o los tomó otra petición al mismo tiempo. */
    yaEnviados: number
    /** No existen, son de otro evento, están anulados o aún no tienen su PDF. */
    noElegibles: number
    fallidos: number
    porCredencial?: EnviosPorCredencial[]
    agotado?: true
}

let plantillaEnCache: string | null = null
function plantilla(): string {
    plantillaEnCache ??= fs.readFileSync(path.join(__dirname, '..', 'templates', 'certificado.html'), 'utf8')
    return plantillaEnCache
}

interface DatosCorreo {
    nombres: string
    titular: string
    tipo: string
    codigo: string
}

/** Tipo en minúsculas para el texto: `ASISTENTE` → «asistente». */
const tipoEnTexto = (tipo: string) => tipo.toLowerCase()

export function htmlCertificado(datos: DatosCorreo, evento: Pick<Evento, 'nombre' | 'correoContacto'>, remitenteCorreo: string, urlPanel: string): string {
    const enlaces = enlacesDe(urlPanel, datos.codigo)
    if (!enlaces) throw new Error('Certificado sin enlaces')
    return renderTemplate(plantilla(), {
        EVENTO: evento.nombre,
        SALUDO: primerNombre(datos.nombres) || 'participante',
        TIPO: tipoEnTexto(datos.tipo),
        TITULAR: datos.titular,
        CODIGO: datos.codigo,
        URL_CERTIFICADO: enlaces.certificado,
        URL_CONSULTA: enlaces.consulta,
        CONTACTO: evento.correoContacto ?? remitenteCorreo,
    })
}

const sinCredencialDeCorreo = () => conflict('EMAIL_CREDENTIAL_UNAVAILABLE', 'No hay una credencial de correo activa. Configúrala en Correo para poder enviar.')

async function cambiarMarca(id: number, esperada: Date | null, nueva: Date | null): Promise<boolean> {
    const { count } = await prisma.certificado.updateMany({ where: { id, estado: 'LISTO', enviadoEn: esperada }, data: { enviadoEn: nueva } })
    return count === 1
}

export async function enviarCertificados(
    eventoId: number,
    input: { ids: number[], reenviar: boolean },
    actorId: number,
    ahora = new Date(),
): Promise<ResultadoEnvioCertificados> {
    const evento = await obtenerEventoPorId(eventoId)
    const urlPanel = await exigirOrigenPanel()
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) throw sinCredencialDeCorreo()
    await prepararEnvioMasivo(evento.credencialCorreoId)

    const filas = await prisma.certificado.findMany({
        where: { eventoId, estado: 'LISTO', id: { in: input.ids } },
        select: { id: true, eventoId: true, codigo: true, tipo: true, nombreImpreso: true, archivo: true, enviadoEn: true, participante: { select: { nombres: true, correo: true } } },
    })
    const porId = new Map(filas.map((fila) => [fila.id, fila]))
    const remitente = { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto }

    const { valor, porCredencial, agotado } = await conRecuento(async (recuento) => {
        const total: ResultadoEnvioCertificados = { enviados: 0, yaEnviados: 0, noElegibles: 0, fallidos: 0 }
        for (const id of input.ids) {
            const fila = porId.get(id)
            const ruta = fila ? rutaCertificado(fila.eventoId, fila.archivo) : null
            if (!fila || !ruta) {
                total.noElegibles += 1
                continue
            }
            const previa = fila.enviadoEn
            if (previa !== null && !input.reenviar) {
                total.yaEnviados += 1
                continue
            }
            if (!(await cambiarMarca(id, previa, ahora))) {
                total.yaEnviados += 1
                continue
            }
            let error: string | null
            try {
                const adjunto = (await fs.promises.readFile(ruta)).toString('base64')
                error = await enviarConCredencial(credencial, {
                    remitente,
                    para: [{ email: fila.participante.correo }],
                    asunto: `Tu certificado · ${evento.nombre}`,
                    html: htmlCertificado({ nombres: fila.participante.nombres, titular: fila.nombreImpreso, tipo: fila.tipo, codigo: fila.codigo }, evento, credencial.remitenteCorreo, urlPanel),
                    adjuntos: [{ nombre: `certificado-${fila.codigo}.pdf`, contenidoBase64: adjunto }],
                })
            } catch {
                error = 'No se pudo preparar el correo.'
            }
            if (error === null) {
                total.enviados += 1
                await prisma.certificado.update({ where: { id }, data: { enviadoPorId: actorId, envioError: null } }).catch(() => undefined)
                continue
            }
            await cambiarMarca(id, ahora, previa).catch(() => undefined)
            await prisma.certificado.update({ where: { id }, data: { envioError: error.slice(0, 300) } }).catch(() => undefined)
            if (recuento.agotado) break
            total.fallidos += 1
        }
        return total
    })
    console.info(`[certificados] La cuenta ${actorId} envió ${valor.enviados} de ${input.ids.length} certificado(s) del evento ${eventoId}`)
    return { ...valor, ...(porCredencial.length ? { porCredencial } : {}), ...(agotado ? { agotado: true as const } : {}) }
}

/** Manda un certificado a una dirección de prueba para ver el correo; no marca nada. */
export async function probarEnvio(eventoId: number, id: number, correo: string, actorId: number): Promise<{ enviado: true }> {
    const evento = await obtenerEventoPorId(eventoId)
    const urlPanel = await exigirOrigenPanel()
    const credencial = await credencialParaEvento(evento.credencialCorreoId)
    if (!credencial) throw sinCredencialDeCorreo()
    const fila = await prisma.certificado.findFirst({
        where: { id, eventoId, estado: 'LISTO' },
        select: { eventoId: true, codigo: true, tipo: true, nombreImpreso: true, archivo: true, participante: { select: { nombres: true } } },
    })
    const ruta = fila ? rutaCertificado(fila.eventoId, fila.archivo) : null
    if (!fila || !ruta) throw conflict('CERTIFICATE_NOT_READY', 'El certificado aún no tiene su PDF firmado.')
    const error = await enviarConCredencial(credencial, {
        remitente: { email: credencial.remitenteCorreo, name: evento.remitenteNombre || credencial.remitenteNombre || evento.nombreCorto },
        para: [{ email: correo }],
        asunto: `[Prueba] Tu certificado · ${evento.nombre}`,
        html: htmlCertificado({ nombres: fila.participante.nombres, titular: fila.nombreImpreso, tipo: fila.tipo, codigo: fila.codigo }, evento, credencial.remitenteCorreo, urlPanel),
        adjuntos: [{ nombre: `certificado-${fila.codigo}.pdf`, contenidoBase64: (await fs.promises.readFile(ruta)).toString('base64') }],
    })
    if (error !== null) throw new HttpError(502, 'EMAIL_SEND_FAILED', 'No se pudo enviar el correo de prueba. Revisa la credencial de correo.')
    console.info(`[certificados] La cuenta ${actorId} envió una prueba del certificado ${id} del evento ${eventoId}`)
    return { enviado: true }
}

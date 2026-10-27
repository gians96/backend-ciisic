import crypto from 'crypto'
import nodemailer, { type Transporter } from 'nodemailer'
import { CorreoFallido, type CorreoSaliente, type CuentaCorreo } from './correo'

/**
 * Envío directo por el SMTP de Gmail (spec 041), con SSL (puerto 465) y una **contraseña de aplicación**
 * de Google (16 letras; exige la verificación en 2 pasos). El servidor es fijo: no se acepta un
 * host del cliente (sería una salida de red abierta; `validarUrlSaliente` solo cubre URLs HTTP).
 * Sirve también a una cuenta de Google Workspace (`@undc.edu.pe`).
 */
export const SMTP_GMAIL = { host: 'smtp.gmail.com', port: 465 } as const

export interface CuentaSmtp {
    /** Cuenta de Gmail con la que se inicia sesión; también es el remitente (Gmail no deja firmar con otro). */
    usuario: string
    /** Contraseña de aplicación, sin espacios. */
    clave: string
}

/** Las contraseñas de aplicación son 16 letras minúsculas; Google las muestra en 4 grupos separados por espacios. */
export const CLAVE_DE_APLICACION = /^[a-z]{16}$/

export function normalizarClaveDeAplicacion(clave: string): string {
    return clave.replace(/\s+/g, '').toLowerCase()
}

const MAXIMO_TRANSPORTES = 4
/** Un transporte con conexiones reutilizadas por cuenta: un envío masivo no abre una sesión SMTP por correo (Gmail limita los inicios de sesión). */
const transportes = new Map<string, Transporter>()

function transporteDe(cuenta: CuentaSmtp): Transporter {
    // La clave del mapa es un hash: el secreto no queda como llave legible ni se repite en memoria
    const llave = crypto.createHash('sha256').update(`${cuenta.usuario}\0${cuenta.clave}`).digest('hex')
    const existente = transportes.get(llave)
    if (existente) {
        transportes.delete(llave)
        transportes.set(llave, existente)
        return existente
    }
    const transporte = nodemailer.createTransport({
        host: SMTP_GMAIL.host,
        port: SMTP_GMAIL.port,
        secure: true,
        auth: { user: cuenta.usuario, pass: cuenta.clave },
        pool: true,
        maxConnections: 2,
        maxMessages: 100,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    })
    transportes.set(llave, transporte)
    while (transportes.size > MAXIMO_TRANSPORTES) {
        const [masAntigua] = transportes.keys()
        transportes.get(masAntigua)?.close()
        transportes.delete(masAntigua)
    }
    return transporte
}

/** Cierra las conexiones abiertas (al apagar el servidor y en las pruebas). */
export function cerrarTransportesGmail(): void {
    for (const transporte of transportes.values()) transporte.close()
    transportes.clear()
}

interface ErrorSmtp { code?: string, responseCode?: number, response?: string }

const ERRORES_DE_RED = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'EDNS', 'ECONNREFUSED'])
/** Gmail dice «límite diario» o «ritmo inusual» con 4xx/5xx y el código mejorado 5.4.5 / 4.7.x. */
const LIMITE_DE_GMAIL = /5\.4\.5|daily|limit|quota|unusual rate|too many/i

/** Traduce un error de nodemailer a un mensaje legible sin citar al destinatario ni la contraseña. */
function aCorreoFallido(error: unknown): CorreoFallido {
    const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorSmtp
    const estado = e.responseCode
    const respuesta = (e.response ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (e.code === 'EAUTH' || estado === 535 || estado === 534) {
        return new CorreoFallido('Gmail rechazó el usuario o la contraseña de aplicación: revisa que la verificación en 2 pasos esté activa y que uses la contraseña de aplicación (16 letras), no la de la cuenta', estado, true)
    }
    if (estado !== undefined && estado >= 400 && LIMITE_DE_GMAIL.test(respuesta)) {
        return new CorreoFallido('Gmail alcanzó su límite de envíos (500 al día en una cuenta personal y 2000 en Google Workspace); se restablece en unas horas', estado, true)
    }
    if (e.code && ERRORES_DE_RED.has(e.code)) {
        return new CorreoFallido(e.code === 'ETIMEDOUT' ? 'Gmail no respondió a tiempo' : 'No se pudo conectar con smtp.gmail.com')
    }
    const detalle = respuesta ? `: ${respuesta}` : ''
    return new CorreoFallido(`Gmail respondió ${estado ?? e.code ?? 'con un error'}${detalle}`, estado)
}

/**
 * Envía el correo y **comprueba que Gmail aceptó a todos los destinatarios**: nodemailer puede resolver con
 * algunos en `rejected`, y eso no es un envío completo.
 */
export async function enviarConGmail(cuenta: CuentaSmtp, correo: CorreoSaliente): Promise<{ messageId: string | null }> {
    try {
        const resultado = await transporteDe(cuenta).sendMail({
            from: { name: correo.remitente.name ?? '', address: correo.remitente.email },
            to: correo.para.map((destinatario) => ({ name: destinatario.name ?? '', address: destinatario.email })),
            subject: correo.asunto,
            html: correo.html,
            attachments: correo.adjuntos?.map((adjunto) => ({ filename: adjunto.nombre, content: adjunto.contenidoBase64, encoding: 'base64' })),
        })
        if (!resultado.accepted?.length || resultado.rejected?.length) throw new CorreoFallido('Gmail no aceptó al destinatario del correo')
        return { messageId: resultado.messageId ?? null }
    } catch (error) {
        throw error instanceof CorreoFallido ? error : aCorreoFallido(error)
    }
}

/** Inicia sesión en Gmail sin enviar nada: confirma la cuenta y la contraseña de aplicación. */
export async function verificarGmail(cuenta: CuentaSmtp): Promise<CuentaCorreo> {
    try {
        await transporteDe(cuenta).verify()
    } catch (error) {
        throw aCorreoFallido(error)
    }
    return { correo: cuenta.usuario, empresa: null, planes: [] }
}

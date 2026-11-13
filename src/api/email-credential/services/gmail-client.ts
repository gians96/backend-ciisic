import crypto from 'crypto'
import nodemailer, { type Transporter } from 'nodemailer'
import { CorreoFallido, type CorreoSaliente, type CuentaCorreo } from './correo'

/**
 * Envío directo por el SMTP de Gmail (spec 041) con una **contraseña de aplicación** de Google (16 letras; exige
 * la verificación en 2 pasos). El servidor es fijo: no se acepta un host del cliente (sería una salida de red
 * abierta; `validarUrlSaliente` solo cubre URLs HTTP). Sirve también a una cuenta de Google Workspace (`@undc.edu.pe`).
 *
 * Dos puertos válidos en Gmail: **465** con SSL desde el inicio y **587** que arranca sin cifrar y pasa a TLS con
 * STARTTLS (obligatorio: `requireTLS`). Algunas redes bloquean uno de los dos; si el elegido no conecta, se prueba
 * el otro (solo ante un fallo de conexión: nunca después de que Gmail empezó a recibir el correo).
 */
export const SMTP_GMAIL = { host: 'smtp.gmail.com', puertos: [465, 587] } as const

export type PuertoSmtp = typeof SMTP_GMAIL.puertos[number]

/** 465 por defecto (lo que había antes de poder elegir). */
export const PUERTO_SMTP_POR_DEFECTO: PuertoSmtp = 465

export function esPuertoSmtp(valor: unknown): valor is PuertoSmtp {
    return valor === 465 || valor === 587
}

/** «465 (SSL)» / «587 (STARTTLS)». */
export function etiquetaPuerto(puerto: PuertoSmtp): string {
    return puerto === 465 ? '465 (SSL)' : '587 (STARTTLS)'
}

export interface CuentaSmtp {
    /** Cuenta de Gmail con la que se inicia sesión; también es el remitente (Gmail no deja firmar con otro). */
    usuario: string
    /** Contraseña de aplicación, sin espacios. */
    clave: string
    /** Puerto preferido; sin él, 465. */
    puerto?: number | null
}

/** Las contraseñas de aplicación son 16 letras minúsculas; Google las muestra en 4 grupos separados por espacios. */
export const CLAVE_DE_APLICACION = /^[a-z]{16}$/

export function normalizarClaveDeAplicacion(clave: string): string {
    return clave.replace(/\s+/g, '').toLowerCase()
}

const MAXIMO_TRANSPORTES = 4
/** Un transporte con conexiones reutilizadas por cuenta: un envío masivo no abre una sesión SMTP por correo (Gmail limita los inicios de sesión). */
const transportes = new Map<string, Transporter>()

/** Puertos en el orden en que se prueban: primero el elegido y luego el otro. */
export function ordenDePuertos(preferido: number | null | undefined): PuertoSmtp[] {
    const primero = esPuertoSmtp(preferido) ? preferido : PUERTO_SMTP_POR_DEFECTO
    return [primero, ...SMTP_GMAIL.puertos.filter((puerto) => puerto !== primero)]
}

function transporteDe(cuenta: CuentaSmtp, puerto: PuertoSmtp): Transporter {
    // La clave del mapa es un hash: el secreto no queda como llave legible ni se repite en memoria
    const llave = crypto.createHash('sha256').update(`${cuenta.usuario}\0${cuenta.clave}\0${puerto}`).digest('hex')
    const existente = transportes.get(llave)
    if (existente) {
        transportes.delete(llave)
        transportes.set(llave, existente)
        return existente
    }
    const transporte = nodemailer.createTransport({
        host: SMTP_GMAIL.host,
        port: puerto,
        // 465: SSL desde el inicio. 587: STARTTLS obligatorio (nunca se envía la contraseña sin cifrar)
        secure: puerto === 465,
        requireTLS: puerto === 587,
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

const FALLOS_DE_CONEXION = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED'])

/**
 * No se llegó a conectar con el puerto: se puede probar el otro sin riesgo de enviar dos veces. nodemailer marca
 * con `command: 'CONN'` los errores de la conexión inicial; una conexión rechazada nunca empezó.
 */
export function esFalloDeConexion(error: unknown): boolean {
    const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorSmtp & { command?: string }
    return Boolean(e.code && FALLOS_DE_CONEXION.has(e.code) && (e.command === 'CONN' || e.code === 'ECONNREFUSED'))
}

const sinConexion = () => new CorreoFallido('No se pudo conectar con smtp.gmail.com por el puerto 465 ni por el 587: revisa que el servidor tenga salida a internet por esos puertos')

/**
 * Hace la tarea por el puerto elegido y, si ese puerto no conecta, por el otro. Cualquier otro error (contraseña,
 * límite, destinatario) se informa tal cual: cambiar de puerto no lo arreglaría.
 */
async function conRespaldoDePuerto<T>(cuenta: CuentaSmtp, tarea: (transporte: Transporter) => Promise<T>): Promise<{ valor: T, puerto: PuertoSmtp }> {
    const puertos = ordenDePuertos(cuenta.puerto)
    for (const [indice, puerto] of puertos.entries()) {
        try {
            return { valor: await tarea(transporteDe(cuenta, puerto)), puerto }
        } catch (error) {
            if (error instanceof CorreoFallido) throw error
            if (!esFalloDeConexion(error)) throw aCorreoFallido(error)
            if (indice === puertos.length - 1) throw sinConexion()
        }
    }
    throw sinConexion()
}

/**
 * Envía el correo y **comprueba que Gmail aceptó a todos los destinatarios**: nodemailer puede resolver con
 * algunos en `rejected`, y eso no es un envío completo.
 */
export async function enviarConGmail(cuenta: CuentaSmtp, correo: CorreoSaliente): Promise<{ messageId: string | null }> {
    const { valor: resultado } = await conRespaldoDePuerto(cuenta, (transporte) => transporte.sendMail({
        from: { name: correo.remitente.name ?? '', address: correo.remitente.email },
        to: correo.para.map((destinatario) => ({ name: destinatario.name ?? '', address: destinatario.email })),
        subject: correo.asunto,
        html: correo.html,
        attachments: correo.adjuntos?.map((adjunto) => ({ filename: adjunto.nombre, content: adjunto.contenidoBase64, encoding: 'base64' })),
    }))
    if (!resultado.accepted?.length || resultado.rejected?.length) throw new CorreoFallido('Gmail no aceptó al destinatario del correo')
    return { messageId: resultado.messageId ?? null }
}

/**
 * Inicia sesión en Gmail sin enviar nada: confirma la cuenta y la contraseña de aplicación, y dice por qué puerto
 * conectó (si no fue el elegido, la red bloquea ese puerto).
 */
export async function verificarGmail(cuenta: CuentaSmtp): Promise<CuentaCorreo & { puerto: PuertoSmtp }> {
    const { puerto } = await conRespaldoDePuerto(cuenta, (transporte) => transporte.verify())
    return { correo: cuenta.usuario, empresa: null, planes: [], puerto }
}

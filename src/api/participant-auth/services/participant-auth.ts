import fs from 'fs'
import path from 'path'
import { ipKeyGenerator } from 'express-rate-limit'
import { Prisma, type CredencialCorreo } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound } from '../../../core/http-error'
import { renderTemplate } from '../../../core/html'
import { compararHash, hashCodigoAcceso, normalizarCorreo, nuevoCodigoAcceso } from '../../../core/codigos'
import { firmarSesionParticipante, type MetodoSesion, type MetodoSesionParticipante } from '../../../core/sesiones'
import { consultarActor } from '../../../core/actor-consulta'
import type { Actor } from '../../../core/actor'
import { credencialUtilizable, enviarConCredencial } from '../../email-credential/services/email-credential'

/**
 * Acceso al portal del participante con un código de 6 dígitos enviado al correo (spec 014) y paso
 * del staff a su propio portal. El código siempre abre una sesión de participante, nunca de staff,
 * y sirve también para las cuentas vinculadas a Google. En la BD solo queda su HMAC.
 */

const MINUTO_MS = 60 * 1000
const HORA_MS = 60 * MINUTO_MS
const DIA_MS = 24 * HORA_MS

export const VIDA_CODIGO_SEGUNDOS = 10 * 60
export const ESPERA_ENTRE_CODIGOS_SEGUNDOS = 60
const INTENTOS_POR_CODIGO = 5
/** Se aceptan los 2 últimos códigos vigentes: un correo que llega tarde sigue sirviendo. */
const CODIGOS_VIGENTES = 2
const CODIGOS_POR_CORREO_HORA = 5
const CODIGOS_POR_CORREO_DIA = 10
/** Alto a propósito: el día del evento muchas personas comparten la IP pública de la universidad. */
const CODIGOS_POR_IP_HORA = 200
/**
 * Presupuesto global de códigos **enviados** (solo a participantes que existen): una ráfaga de
 * solicitudes, aun desde muchas IP, no agota la cuota de Brevo que comparten los correos de aprobación.
 */
const ENVIOS_GLOBALES_HORA = 400
const ENVIOS_GLOBALES_DIA = 2000
/** Intentos fallidos por correo en una hora (cada código probado cuenta uno) antes de `CODE_LOCKED`. */
const FALLOS_POR_CORREO_HORA = 10
/** Verificaciones fallidas por IP (IPv6: por subred /56) en una hora antes de `429 RATE_LIMITED` (en memoria). */
const FALLOS_POR_IP_HORA = 50
/**
 * Disyuntor global (en memoria del proceso): verificaciones fallidas **contra participantes que
 * existen** en una hora que pausan el acceso. Los fallos con correos inventados no cuentan (no hay
 * nada que adivinar) y el tope por IP impide que una sola red lo abra.
 */
const FALLOS_GLOBALES_HORA = 150
const PAUSA_GLOBAL_MS = HORA_MS
/** Tope de IP distintas que se recuerdan; al pasarlo se olvidan las que ya no tienen fallos en la hora. */
const MAX_IPS_RECORDADAS = 10_000
const RETENCION_MS = 7 * DIA_MS
const ASUNTO = 'Tu código de acceso al portal del participante'

/** Error con un tiempo de espera: el `errorHandler` lo anuncia en `Retry-After` (y va en `fields`). */
export class EsperaRequerida extends HttpError {
    readonly segundos: number

    constructor(status: number, code: string, message: string, segundos: number) {
        const enteros = Math.max(1, Math.ceil(segundos))
        super(status, code, message, { reintentarEnSegundos: String(enteros) }, enteros)
        this.segundos = enteros
    }
}

const hace = (ahora: Date, ms: number) => new Date(ahora.getTime() - ms)
/** Segundos que faltan para que `desde + duracionMs` llegue. */
const segundosHasta = (desde: Date, duracionMs: number, ahora: Date) => (desde.getTime() + duracionMs - ahora.getTime()) / 1000
const codigoExpirado = () => new HttpError(401, 'CODE_EXPIRED', 'El código venció o ya no es válido. Pide uno nuevo.')
const noDisponible = () => new HttpError(503, 'CODE_LOGIN_UNAVAILABLE', 'El acceso con código no está disponible en este momento. Entra con Google.')

// ─── Estado del proceso ─────────────────────────────────────────────────────

const disyuntor = { fallos: [] as number[], pausadoHasta: 0 }
/** Momentos de las verificaciones fallidas de la última hora por IP (clave de `claveDeIp`). */
const fallosPorIp = new Map<string, number[]>()
/**
 * Solicitudes en curso por correo: una ráfaga en paralelo no salta la espera de 60 s. Vive en la
 * memoria del proceso: con varias réplicas, dos solicitudes simultáneas en réplicas distintas podrían
 * crear dos códigos (los topes por correo de la BD siguen valiendo). Hoy corre un solo proceso.
 */
const solicitudesEnCurso = new Set<string>()
let ultimaLimpieza = 0

/** Solo para pruebas. */
export function reiniciarEstadoCodigos(): void {
    disyuntor.fallos = []
    disyuntor.pausadoHasta = 0
    fallosPorIp.clear()
    solicitudesEnCurso.clear()
    ultimaLimpieza = 0
}

function exigirSinPausa(ahora: Date) {
    if (disyuntor.pausadoHasta <= ahora.getTime()) return
    throw new EsperaRequerida(503, 'CODE_LOGIN_PAUSED', 'El acceso con código está pausado por seguridad. Entra con Google o inténtalo más tarde.',
        (disyuntor.pausadoHasta - ahora.getTime()) / 1000)
}

function registrarFalloGlobal(ahora: number) {
    disyuntor.fallos = disyuntor.fallos.filter((momento) => ahora - momento < HORA_MS)
    disyuntor.fallos.push(ahora)
    if (disyuntor.fallos.length < FALLOS_GLOBALES_HORA) return
    disyuntor.pausadoHasta = ahora + PAUSA_GLOBAL_MS
    disyuntor.fallos = []
    console.warn(`Acceso por código pausado 1 h: ${FALLOS_GLOBALES_HORA} verificaciones fallidas contra participantes en la última hora`)
}

/** Fallos de la última hora de una IP (el más antiguo primero); olvida la IP si ya no tiene. */
function fallosRecientesDeIp(clave: string, ahora: number): number[] {
    const recientes = (fallosPorIp.get(clave) ?? []).filter((momento) => ahora - momento < HORA_MS)
    if (recientes.length) fallosPorIp.set(clave, recientes)
    else fallosPorIp.delete(clave)
    return recientes
}

/** 429 `RATE_LIMITED` si la IP acumuló demasiados códigos incorrectos en la última hora. */
function exigirIpSinBloqueo(clave: string | null, ahora: Date) {
    if (!clave) return
    const recientes = fallosRecientesDeIp(clave, ahora.getTime())
    if (recientes.length < FALLOS_POR_IP_HORA) return
    const liberaEn = new Date(recientes[recientes.length - FALLOS_POR_IP_HORA])
    throw new EsperaRequerida(429, 'RATE_LIMITED', 'Demasiados códigos incorrectos desde esta red. Intenta más tarde o entra con Google.',
        segundosHasta(liberaEn, HORA_MS, ahora))
}

function registrarFalloDeIp(clave: string | null, ahora: number) {
    if (!clave) return
    if (!fallosPorIp.has(clave) && fallosPorIp.size >= MAX_IPS_RECORDADAS) {
        for (const otra of [...fallosPorIp.keys()]) fallosRecientesDeIp(otra, ahora)
    }
    fallosPorIp.set(clave, [...fallosRecientesDeIp(clave, ahora), ahora])
}

/** Borra los códigos de más de 7 días, como mucho una vez por hora y sin bloquear la respuesta. */
function limpiarAntiguos(ahora: Date) {
    if (ahora.getTime() - ultimaLimpieza < HORA_MS) return
    ultimaLimpieza = ahora.getTime()
    Promise.resolve()
        .then(() => prisma.codigoAcceso.deleteMany({ where: { creadoEn: { lt: hace(ahora, RETENCION_MS) } } }))
        .catch(() => undefined)
}

// ─── Plantilla y disponibilidad ─────────────────────────────────────────────

const RUTA_PLANTILLA = path.join(__dirname, '..', 'templates', 'codigo-acceso.html')
let plantilla: string | null = null
let avisoSinPlantilla = false

/** Sin la plantilla (por ejemplo, si la imagen no la copió) el acceso por código se apaga en vez de fallar en silencio. */
function plantillaCodigo(): string | null {
    if (plantilla !== null) return plantilla
    try {
        plantilla = fs.readFileSync(RUTA_PLANTILLA, 'utf8')
    } catch {
        if (!avisoSinPlantilla) console.error('Falta la plantilla codigo-acceso.html: el acceso por código queda deshabilitado')
        avisoSinPlantilla = true
    }
    return plantilla
}

/**
 * Si el panel puede ofrecer el acceso por código (`/v1/auth/config`): hay una credencial de correo
 * utilizable, la plantilla existe y el disyuntor no está abierto. Nunca lanza.
 */
export async function accesoCodigoDisponible(ahora = new Date()): Promise<boolean> {
    if (disyuntor.pausadoHasta > ahora.getTime() || !plantillaCodigo()) return false
    try {
        return (await credencialUtilizable(ahora)) !== null
    } catch {
        return false
    }
}

// ─── Solicitud del código ───────────────────────────────────────────────────

export interface CodigoSolicitado {
    expiraEnSegundos: number
    reintentarEnSegundos: number
}

/** Espera de 60 s y topes de 5 por hora y 10 por día por correo, con los códigos ya pedidos (más reciente primero). */
function exigirTopesPorCorreo(creados: Date[], ahora: Date) {
    const esperas: { segundos: number, mensaje: string }[] = []
    const ultimo = creados[0]
    if (ultimo) {
        const segundos = segundosHasta(ultimo, ESPERA_ENTRE_CODIGOS_SEGUNDOS * 1000, ahora)
        if (segundos > 0) esperas.push({ segundos, mensaje: 'Espera un momento antes de pedir otro código.' })
    }
    const enLaHora = creados.filter((creado) => ahora.getTime() - creado.getTime() < HORA_MS)
    const quintoEnLaHora = enLaHora[CODIGOS_POR_CORREO_HORA - 1]
    if (quintoEnLaHora) esperas.push({ segundos: segundosHasta(quintoEnLaHora, HORA_MS, ahora), mensaje: 'Pediste varios códigos seguidos. Intenta más tarde o entra con Google.' })
    const decimoDelDia = creados[CODIGOS_POR_CORREO_DIA - 1]
    if (decimoDelDia) esperas.push({ segundos: segundosHasta(decimoDelDia, DIA_MS, ahora), mensaje: 'Alcanzaste el máximo de códigos por día. Intenta mañana o entra con Google.' })
    const mayor = esperas.sort((a, b) => b.segundos - a.segundos)[0]
    if (mayor) throw new EsperaRequerida(429, 'CODE_COOLDOWN', mayor.mensaje, mayor.segundos)
}

interface Destinatario {
    correo: string
    nombres: string
}

/** Fallo del envío sin datos personales: el detalle del proveedor queda en la credencial (`ultimoError`). */
class EnvioFallido extends Error {}

/**
 * El resultado no se guarda en la credencial (`registrar: false`): el envío lo provoca un anónimo y
 * solo ocurre si el correo existe, así que su fallo no debe cambiar `accesoCodigo.disponible`.
 */
async function enviarCodigo(credencial: CredencialCorreo, html: string, destinatario: Destinatario, codigo: string, ahora: Date) {
    const error = await enviarConCredencial(credencial, {
        remitente: { email: credencial.remitenteCorreo, name: credencial.remitenteNombre || 'CIISIC' },
        para: [{ email: destinatario.correo }],
        asunto: ASUNTO,
        html: renderTemplate(html, { NOMBRE: destinatario.nombres, CODIGO: codigo, MINUTOS: VIDA_CODIGO_SEGUNDOS / 60, ANIO: ahora.getFullYear() }),
    }, { registrar: false })
    if (error) throw new EnvioFallido('el proveedor de correo rechazó el envío')
}

/** 503 `CODE_LOGIN_UNAVAILABLE` (con `Retry-After`) si se agotó el presupuesto global de envíos. */
function exigirPresupuestoDeEnvios(enLaHora: { creadoEn: Date }[], enElDia: { creadoEn: Date }[], ahora: Date) {
    const espera = (filas: { creadoEn: Date }[], ventanaMs: number) => (filas[0] ? segundosHasta(filas[0].creadoEn, ventanaMs, ahora) : 0)
    const segundos = Math.max(espera(enLaHora, HORA_MS), espera(enElDia, DIA_MS))
    if (segundos <= 0) return
    console.warn('Acceso por código: se alcanzó el tope global de códigos enviados')
    throw new EsperaRequerida(503, 'CODE_LOGIN_UNAVAILABLE', 'El acceso con código no está disponible en este momento. Entra con Google o inténtalo más tarde.', segundos)
}

/** Clave de la IP para el tope en la BD: la IPv4 tal cual y la IPv6 por su subred /56 (como los limitadores). */
function claveDeIp(ip: string | null | undefined): string | null {
    if (!ip) return null
    try {
        return ipKeyGenerator(ip).slice(0, 45)
    } catch {
        return ip.slice(0, 45)
    }
}

/**
 * `POST /v1/auth/participant/code`. Responde lo mismo exista o no el correo (y tenga o no Google):
 * la fila se crea siempre y el correo sale en diferido solo si hay un participante con ese correo.
 * Topes: 60 s, 5 por hora y 10 por día por correo; 200 por hora por IP; y un presupuesto global de
 * envíos (400 por hora y 2000 por día) que se aplica igual exista o no el correo.
 */
export async function solicitarCodigo(correoIngresado: string, ip: string | null | undefined, ahora = new Date()): Promise<CodigoSolicitado> {
    const correo = normalizarCorreo(correoIngresado)
    exigirSinPausa(ahora)
    const html = plantillaCodigo()
    const credencial = html ? await credencialUtilizable(ahora) : null
    if (!html || !credencial) throw noDisponible()

    if (solicitudesEnCurso.has(correo)) {
        throw new EsperaRequerida(429, 'CODE_COOLDOWN', 'Espera un momento antes de pedir otro código.', ESPERA_ENTRE_CODIGOS_SEGUNDOS)
    }
    solicitudesEnCurso.add(correo)
    try {
        const ipGuardada = claveDeIp(ip)
        // La fila n.º `tope` de la ventana entre los códigos enviados (con participante): si existe, se agotó
        const enviados = (ventanaMs: number, tope: number) => prisma.codigoAcceso.findMany({
            where: { participanteId: { not: null }, creadoEn: { gt: hace(ahora, ventanaMs) } },
            orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
            skip: tope - 1,
            take: 1,
            select: { creadoEn: true },
        })
        const [recientes, topeIp, participante, topeHora, topeDia] = await Promise.all([
            prisma.codigoAcceso.findMany({
                where: { correo, creadoEn: { gt: hace(ahora, DIA_MS) } },
                orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
                take: CODIGOS_POR_CORREO_DIA,
                select: { creadoEn: true },
            }),
            // La fila n.º 200 de la última hora desde esta IP (si existe, se alcanzó el tope)
            ipGuardada
                ? prisma.codigoAcceso.findMany({
                    where: { ip: ipGuardada, creadoEn: { gt: hace(ahora, HORA_MS) } },
                    orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
                    skip: CODIGOS_POR_IP_HORA - 1,
                    take: 1,
                    select: { creadoEn: true },
                })
                : Promise.resolve([]),
            // Se busca siempre, para no responder antes cuando el correo no existe
            prisma.participante.findUnique({ where: { correo }, select: { id: true, nombres: true, correo: true } }),
            enviados(HORA_MS, ENVIOS_GLOBALES_HORA),
            enviados(DIA_MS, ENVIOS_GLOBALES_DIA),
        ])
        exigirTopesPorCorreo(recientes.map((fila) => fila.creadoEn), ahora)
        const [topeAlcanzado] = topeIp
        if (topeAlcanzado) {
            throw new EsperaRequerida(429, 'RATE_LIMITED', 'Demasiadas solicitudes de código desde esta red. Intenta más tarde.', segundosHasta(topeAlcanzado.creadoEn, HORA_MS, ahora))
        }
        exigirPresupuestoDeEnvios(topeHora, topeDia, ahora)

        const codigo = nuevoCodigoAcceso()
        const fila = await prisma.$transaction(async (tx) => {
            // Quedan vigentes solo el código más reciente y el nuevo
            const vigente = await tx.codigoAcceso.findFirst({
                where: { correo, usadoEn: null, invalidadoEn: null, expiraEn: { gt: ahora } },
                orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
                select: { id: true },
            })
            await tx.codigoAcceso.updateMany({
                where: { correo, usadoEn: null, invalidadoEn: null, ...(vigente ? { id: { not: vigente.id } } : {}) },
                data: { invalidadoEn: ahora },
            })
            return tx.codigoAcceso.create({
                data: {
                    correo,
                    codigoHash: hashCodigoAcceso(correo, codigo),
                    participanteId: participante?.id ?? null,
                    ip: ipGuardada,
                    expiraEn: new Date(ahora.getTime() + VIDA_CODIGO_SEGUNDOS * 1000),
                    creadoEn: ahora,
                },
                select: { id: true },
            })
        })

        if (participante) {
            const destinatario: Destinatario = { correo: participante.correo, nombres: participante.nombres }
            setImmediate(() => {
                enviarCodigo(credencial, html, destinatario, codigo, ahora).catch((error: unknown) => {
                    // Sin correo, nombre ni código en el registro: solo el id de la solicitud y la causa
                    const causa = error instanceof EnvioFallido ? error.message : error instanceof Error ? error.name : 'error desconocido'
                    console.error(`No se pudo enviar el código de acceso (solicitud ${fila.id}): ${causa}`)
                })
            })
        }
        limpiarAntiguos(ahora)
        return { expiraEnSegundos: VIDA_CODIGO_SEGUNDOS, reintentarEnSegundos: ESPERA_ENTRE_CODIGOS_SEGUNDOS }
    } finally {
        solicitudesEnCurso.delete(correo)
    }
}

// ─── Verificación y sesión ──────────────────────────────────────────────────

interface DatosParticipante {
    id: number
    nombres: string
    apellidos: string
    correo: string
}

export interface SesionParticipante {
    jwt: string
    tipo: 'PARTICIPANTE'
    participante: DatosParticipante
    expiraEn: string
}

function sesionDeParticipante(p: DatosParticipante, metodo: MetodoSesionParticipante): SesionParticipante {
    const participante = { id: p.id, nombres: p.nombres, apellidos: p.apellidos, correo: p.correo }
    const sesion = firmarSesionParticipante(participante, metodo)
    return { jwt: sesion.jwt, tipo: 'PARTICIPANTE', participante, expiraEn: sesion.expiraEn }
}

/** Segundos hasta que los fallos de la última hora bajen del tope (las filas salen de la ventana de la más antigua a la más nueva). */
function esperaDeBloqueo(filas: { intentos: number, creadoEn: Date }[], fallos: number, ahora: Date): number {
    let quedan = fallos
    for (const fila of [...filas].reverse()) {
        quedan -= fila.intentos
        if (quedan < FALLOS_POR_CORREO_HORA) return segundosHasta(fila.creadoEn, HORA_MS, ahora)
    }
    return HORA_MS / 1000
}

/**
 * Marca el código como usado e invalida los demás del correo. `otrasReservas`: códigos más nuevos a
 * los que esta misma petición les reservó un intento antes de acertar con uno anterior; se devuelve
 * para que entrar con el penúltimo código no cuente como un fallo del correo.
 */
async function abrirSesionConCodigo(fila: { id: number, participanteId: number | null }, correo: string, otrasReservas: number[], ahora: Date): Promise<SesionParticipante> {
    const { count } = await prisma.codigoAcceso.updateMany({ where: { id: fila.id, usadoEn: null, invalidadoEn: null }, data: { usadoEn: ahora } })
    if (!count) throw codigoExpirado()
    await prisma.codigoAcceso.updateMany({ where: { correo, id: { not: fila.id }, usadoEn: null, invalidadoEn: null }, data: { invalidadoEn: ahora } })
    if (otrasReservas.length) {
        await prisma.codigoAcceso.updateMany({ where: { id: { in: otrasReservas }, intentos: { gt: 0 } }, data: { intentos: { decrement: 1 } } })
    }
    // El código solo se envió si la persona existía al pedirlo, y debe seguir teniendo ese correo
    const participante = fila.participanteId === null
        ? null
        : await prisma.participante.findUnique({ where: { id: fila.participanteId }, select: { id: true, nombres: true, apellidos: true, correo: true } })
    if (!participante || normalizarCorreo(participante.correo) !== correo) throw codigoExpirado()
    return sesionDeParticipante(participante, 'CODIGO')
}

/**
 * `POST /v1/auth/participant/code/verify`: sesión de participante de 12 h (`metodo: 'CODIGO'`). Un
 * código incorrecto cuenta para el correo (10 por hora), para la IP (50 por hora) y, si el correo es
 * de un participante, para el disyuntor global.
 */
export async function verificarCodigo(correoIngresado: string, codigo: string, ip?: string | null, ahora = new Date()): Promise<SesionParticipante> {
    const correo = normalizarCorreo(correoIngresado)
    const claveIp = claveDeIp(ip)
    exigirSinPausa(ahora)
    exigirIpSinBloqueo(claveIp, ahora)

    const filas = await prisma.codigoAcceso.findMany({
        where: { correo, creadoEn: { gt: hace(ahora, HORA_MS) } },
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        take: 50,
        select: { id: true, codigoHash: true, participanteId: true, intentos: true, expiraEn: true, usadoEn: true, invalidadoEn: true, creadoEn: true },
    })
    // Un ingreso correcto reinicia la cuenta: solo cuentan los códigos pedidos después del último usado
    const ultimoUsado = filas.findIndex((fila) => fila.usadoEn !== null)
    const pendientes = ultimoUsado < 0 ? filas : filas.slice(0, ultimoUsado)
    const fallos = pendientes.reduce((suma, fila) => suma + fila.intentos, 0)
    if (fallos >= FALLOS_POR_CORREO_HORA) {
        throw new EsperaRequerida(429, 'CODE_LOCKED', 'Demasiados intentos con este correo. Espera un momento o entra con Google.', esperaDeBloqueo(pendientes, fallos, ahora))
    }

    const candidatos = pendientes
        .filter((fila) => fila.invalidadoEn === null && fila.expiraEn > ahora && fila.intentos < INTENTOS_POR_CODIGO)
        .slice(0, CODIGOS_VIGENTES)
    if (!candidatos.length) throw codigoExpirado()

    const hash = hashCodigoAcceso(correo, codigo)
    const reservadas: number[] = []
    let restantes = 0
    let deParticipante = false
    for (const fila of candidatos) {
        // El intento se reserva antes de comparar: ni con peticiones en paralelo se pasa de 5 por código
        const { count } = await prisma.codigoAcceso.updateMany({
            where: { id: fila.id, usadoEn: null, invalidadoEn: null, intentos: { lt: INTENTOS_POR_CODIGO }, expiraEn: { gt: ahora } },
            data: { intentos: { increment: 1 } },
        })
        if (!count) continue
        if (compararHash(fila.codigoHash, hash)) return abrirSesionConCodigo(fila, correo, reservadas, ahora)
        reservadas.push(fila.id)
        deParticipante ||= fila.participanteId !== null
        restantes = Math.max(restantes, INTENTOS_POR_CODIGO - (fila.intentos + 1))
    }
    const reservas = reservadas.length
    if (!reservas) throw codigoExpirado()

    registrarFalloDeIp(claveIp, ahora.getTime())
    if (deParticipante) registrarFalloGlobal(ahora.getTime())
    restantes = Math.max(0, Math.min(restantes, FALLOS_POR_CORREO_HORA - (fallos + reservas)))
    throw new HttpError(401, 'INVALID_CODE',
        restantes ? `El código no es correcto. Te quedan ${restantes} intento${restantes === 1 ? '' : 's'}.` : 'El código no es correcto. Pide uno nuevo.',
        { restantes: String(restantes) })
}

// ─── Paso del staff a su portal ─────────────────────────────────────────────

const codigoRequerido = () => new HttpError(409, 'CODE_REQUIRED', 'Para entrar a tu portal de participante inicia sesión con Google o pide un código a tu correo.')
const cuentaGoogleDistinta = () => new HttpError(403, 'GOOGLE_ACCOUNT_MISMATCH', 'Tu inscripción está vinculada a otra cuenta de Google. Entra con esa cuenta o pide un código a tu correo.')

/**
 * `POST /v1/auth/participant/switch`: el staff que entró con Google pasa a su portal sin otro paso
 * (Google ya probó que controla el correo). Con contraseña debe pedir el código. Un solo sentido:
 * nada lleva del portal al panel.
 */
export async function cambiarAPortal(actor: Actor, metodoSesion: MetodoSesion | undefined): Promise<SesionParticipante> {
    if (metodoSesion !== 'GOOGLE') throw codigoRequerido()
    const participante = await prisma.participante.findUnique({
        where: { correo: normalizarCorreo(actor.correo) },
        select: { id: true, nombres: true, apellidos: true, correo: true, googleSub: true },
    })
    if (!participante) throw notFound('PARTICIPANT_NOT_FOUND', 'No hay una inscripción con el correo de tu cuenta.')

    // La cuenta Google del staff (la guarda ya comprobó que la sesión sigue valiendo)
    const googleSub = (await consultarActor(actor.id))?.googleSub ?? null
    if (!googleSub) throw codigoRequerido()
    if (participante.googleSub && participante.googleSub !== googleSub) throw cuentaGoogleDistinta()
    if (!participante.googleSub) {
        const { count } = await prisma.participante.updateMany({
            where: { id: participante.id, googleSub: null },
            data: { googleSub, googleVinculadoEn: new Date() },
        }).catch((error: unknown) => {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw conflict('GOOGLE_ACCOUNT_IN_USE', 'Esta cuenta de Google ya está vinculada a otro registro.')
            }
            throw error
        })
        // Otra petición la vinculó en paralelo: vale solo si fue con la misma cuenta
        if (!count) {
            const actual = await prisma.participante.findUnique({ where: { id: participante.id }, select: { googleSub: true } })
            if (actual?.googleSub !== googleSub) throw cuentaGoogleDistinta()
        }
    }
    return sesionDeParticipante(participante, 'GOOGLE')
}

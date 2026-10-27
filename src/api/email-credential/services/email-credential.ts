import type { CredencialCorreo, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound, unprocessable } from '../../../core/http-error'
import { escapeHtml } from '../../../core/html'
import { cifrar, descifrar, sufijo } from '../../../core/crypto'
import { cuentaBrevo, enviarConBrevo } from './brevo-client'
import { CorreoFallido, type CorreoSaliente, type CuentaCorreo } from './correo'
import { CLAVE_DE_APLICACION, enviarConGmail, normalizarClaveDeAplicacion, verificarGmail } from './gmail-client'
import type { ActualizarCredencialInput, CrearCredencialInput, OrdenarCredencialesInput } from '../validation'

type CredencialConEventos = CredencialCorreo & { eventos?: { id: number, codigo: string, nombreCorto: string }[] }

const conEventos = { eventos: { select: { id: true, codigo: true, nombreCorto: true }, orderBy: { id: 'asc' } } } satisfies Prisma.CredencialCorreoInclude

/** Orden en que se prueban las credenciales (spec 041): la predeterminada, luego las de respaldo por prioridad y antigüedad. */
const ORDEN_DE_PRIORIDAD = [{ esPredeterminada: 'desc' }, { prioridad: 'asc' }, { id: 'asc' }] satisfies Prisma.CredencialCorreoOrderByWithRelationInput[]

/** Cuántas credenciales se prueban como máximo por correo (cada una puede tardar hasta su tiempo de espera). */
const MAXIMO_INTENTOS = 3

export function aCredencial(c: CredencialConEventos) {
    return {
        id: c.id,
        proveedor: c.proveedor,
        nombre: c.nombre,
        apiKeyEnmascarada: `••••${c.apiKeySufijo}`,
        remitenteCorreo: c.remitenteCorreo,
        remitenteNombre: c.remitenteNombre,
        esPredeterminada: c.esPredeterminada,
        prioridad: c.prioridad,
        activo: c.activo,
        ultimoEstado: c.ultimoEstado,
        ultimoError: c.ultimoError,
        ultimaPruebaEn: c.ultimaPruebaEn,
        ultimoEnvioEn: c.ultimoEnvioEn,
        eventos: c.eventos ?? [],
        creadoEn: c.creadoEn,
        actualizadoEn: c.actualizadoEn,
    }
}

async function obtener(id: number) {
    const credencial = await prisma.credencialCorreo.findUnique({ where: { id }, include: conEventos })
    if (!credencial) throw notFound('EMAIL_CREDENTIAL_NOT_FOUND', 'La credencial de correo no existe.')
    return credencial
}

export async function listarCredenciales() {
    const credenciales = await prisma.credencialCorreo.findMany({
        include: conEventos,
        orderBy: ORDEN_DE_PRIORIDAD,
    })
    return credenciales.map(aCredencial)
}

/**
 * Secreto listo para guardar. La contraseña de aplicación de Gmail se escribe con espacios (Google la
 * muestra en 4 grupos de 4 letras): se normaliza y se comprueba su forma. La API key de Brevo va tal cual.
 */
function secretoParaGuardar(proveedor: CredencialCorreo['proveedor'], apiKey: string): string {
    if (proveedor !== 'GMAIL_SMTP') return apiKey
    const clave = normalizarClaveDeAplicacion(apiKey)
    if (!CLAVE_DE_APLICACION.test(clave)) {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', {
            apiKey: 'La contraseña de aplicación de Google tiene 16 letras (puedes pegarla con sus espacios). Se crea en myaccount.google.com/apppasswords.',
        })
    }
    return clave
}

export async function crearCredencial(input: CrearCredencialInput) {
    const proveedor = input.proveedor ?? 'BREVO'
    const secreto = secretoParaGuardar(proveedor, input.apiKey)
    // La primera credencial queda como predeterminada.
    const esPredeterminada = (await prisma.credencialCorreo.count()) === 0 ? true : input.esPredeterminada ?? false
    const credencial = await prisma.$transaction(async (tx) => {
        if (esPredeterminada) await tx.credencialCorreo.updateMany({ data: { esPredeterminada: false } })
        // Una de respaldo va al final de la fila; la predeterminada no entra en ella (siempre es la primera)
        const ultima = esPredeterminada ? null : await tx.credencialCorreo.aggregate({ _max: { prioridad: true } })
        return tx.credencialCorreo.create({
            data: {
                proveedor,
                nombre: input.nombre,
                apiKeyCifrada: cifrar(secreto),
                apiKeySufijo: sufijo(secreto),
                remitenteCorreo: input.remitenteCorreo,
                remitenteNombre: input.remitenteNombre ?? null,
                esPredeterminada,
                prioridad: esPredeterminada ? 0 : (ultima?._max.prioridad ?? 0) + 1,
                activo: input.activo ?? true,
            },
            include: conEventos,
        })
    })
    return aCredencial(credencial)
}

export async function actualizarCredencial(id: number, input: ActualizarCredencialInput) {
    const actual = await obtener(id)
    if (input.esPredeterminada === false && actual.esPredeterminada) {
        throw unprocessable('DEFAULT_CREDENTIAL_REQUIRED', 'Marca otra credencial como predeterminada en lugar de quitarle la marca a esta.')
    }
    if (actual.proveedor === 'GMAIL_SMTP' && input.remitenteCorreo !== undefined && input.remitenteCorreo !== actual.remitenteCorreo && input.apiKey === undefined) {
        // En Gmail el remitente es la cuenta con la que se inicia sesión: la contraseña guardada ya no sirve
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', {
            apiKey: 'Cambiaste la cuenta de Gmail: pega también la contraseña de aplicación de esa cuenta.',
        })
    }
    const data: Prisma.CredencialCorreoUpdateInput = {}
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.remitenteCorreo !== undefined) data.remitenteCorreo = input.remitenteCorreo
    if (input.remitenteNombre !== undefined) data.remitenteNombre = input.remitenteNombre
    if (input.activo !== undefined) data.activo = input.activo
    if (input.apiKey !== undefined) {
        const secreto = secretoParaGuardar(actual.proveedor, input.apiKey)
        data.apiKeyCifrada = cifrar(secreto)
        data.apiKeySufijo = sufijo(secreto)
        data.ultimoEstado = null
        data.ultimoError = null
    }
    if (input.esPredeterminada) data.esPredeterminada = true
    const credencial = await prisma.$transaction(async (tx) => {
        if (input.esPredeterminada) await tx.credencialCorreo.updateMany({ where: { id: { not: id } }, data: { esPredeterminada: false } })
        return tx.credencialCorreo.update({ where: { id }, data, include: conEventos })
    })
    if (input.apiKey !== undefined || input.activo !== undefined) reanudar(id)
    return aCredencial(credencial)
}

export async function eliminarCredencial(id: number) {
    const credencial = await obtener(id)
    await prisma.$transaction(async (tx) => {
        await tx.credencialCorreo.delete({ where: { id } })
        if (!credencial.esPredeterminada) return
        // Se promueve otra (activa primero, la de mayor prioridad) para no quedar sin predeterminada.
        const siguiente = await tx.credencialCorreo.findFirst({ orderBy: [{ activo: 'desc' }, { prioridad: 'asc' }, { id: 'asc' }] })
        if (siguiente) await tx.credencialCorreo.update({ where: { id: siguiente.id }, data: { esPredeterminada: true } })
    })
    reanudar(id)
}

/**
 * Fija el orden de respaldo (spec 041): `ids` trae **todas** las credenciales, de la primera a la última.
 * La primera queda como predeterminada (debe estar activa) y las demás se prueban en ese orden cuando
 * la anterior falla o se queda sin créditos.
 */
export async function ordenarCredenciales(input: OrdenarCredencialesInput) {
    const ids = input.ids
    if (new Set(ids).size !== ids.length) throw unprocessable('INVALID_ORDER', 'El orden repite una credencial.')
    const credenciales = await prisma.credencialCorreo.findMany({ select: { id: true, activo: true } })
    const existentes = new Set(credenciales.map((credencial) => credencial.id))
    if (ids.length !== existentes.size || ids.some((id) => !existentes.has(id))) {
        throw unprocessable('INVALID_ORDER', 'El orden debe incluir todas las credenciales, una sola vez. Recarga la lista e inténtalo de nuevo.')
    }
    if (!credenciales.find((credencial) => credencial.id === ids[0])?.activo) {
        throw unprocessable('DEFAULT_CREDENTIAL_INACTIVE', 'La primera credencial es la predeterminada y debe estar activa.')
    }
    await prisma.$transaction(async (tx) => {
        for (const [indice, id] of ids.entries()) {
            await tx.credencialCorreo.update({ where: { id }, data: { prioridad: indice + 1, esPredeterminada: indice === 0 } })
        }
    })
    return listarCredenciales()
}

async function registrarResultado(id: number, error: string | null, campo: 'ultimaPruebaEn' | 'ultimoEnvioEn') {
    await prisma.credencialCorreo.update({
        where: { id },
        data: error
            ? { ultimoEstado: 'ERROR', ultimoError: error.slice(0, 500), [campo]: new Date() }
            : { ultimoEstado: 'OK', ultimoError: null, [campo]: new Date() },
    })
}

function mensajeDe(error: unknown): string {
    return error instanceof CorreoFallido ? error.message : 'Error inesperado al contactar al proveedor de correo'
}

/** Envía un correo con el proveedor de la credencial (Brevo por API o Gmail por SMTP), sin respaldo. */
function enviarPorProveedor(credencial: CredencialCorreo, correo: CorreoSaliente) {
    const secreto = descifrar(credencial.apiKeyCifrada)
    if (credencial.proveedor === 'GMAIL_SMTP') return enviarConGmail({ usuario: credencial.remitenteCorreo, clave: secreto }, correo)
    return enviarConBrevo(secreto, correo)
}

/** Verifica la credencial contra su proveedor (sin enviar correos) y devuelve la cuenta y sus créditos, si los informa. */
export async function probarCredencial(id: number): Promise<{ ok: boolean, cuenta?: CuentaCorreo, error?: string, credencial: ReturnType<typeof aCredencial> }> {
    const credencial = await obtener(id)
    try {
        const secreto = descifrar(credencial.apiKeyCifrada)
        const cuenta = credencial.proveedor === 'GMAIL_SMTP'
            ? await verificarGmail({ usuario: credencial.remitenteCorreo, clave: secreto })
            : await cuentaBrevo(secreto)
        await registrarResultado(id, null, 'ultimaPruebaEn')
        reanudar(id)
        return { ok: true, cuenta, credencial: aCredencial(await obtener(id)) }
    } catch (error) {
        await registrarResultado(id, mensajeDe(error), 'ultimaPruebaEn')
        return { ok: false, error: mensajeDe(error), credencial: aCredencial(await obtener(id)) }
    }
}

/** Envía un correo de prueba **solo con esta credencial** (sin respaldo) para confirmar que el remitente funciona. */
export async function enviarCorreoDePrueba(id: number, correo: string) {
    const credencial = await obtener(id)
    const remitente = credencial.remitenteNombre || 'CIISIC'
    try {
        await enviarPorProveedor(credencial, {
            remitente: { email: credencial.remitenteCorreo, name: remitente },
            para: [{ email: correo }],
            asunto: `Correo de prueba · ${remitente}`,
            html: `<p>Este es un correo de prueba de la credencial <strong>${escapeHtml(credencial.nombre)}</strong>.</p>`
                + '<p>Si lo recibiste, los correos de aprobación de inscripciones se enviarán correctamente.</p>',
        })
        await registrarResultado(id, null, 'ultimoEnvioEn')
        reanudar(id)
        return { ok: true, credencial: aCredencial(await obtener(id)) }
    } catch (error) {
        await registrarResultado(id, mensajeDe(error), 'ultimoEnvioEn')
        return { ok: false, error: mensajeDe(error), credencial: aCredencial(await obtener(id)) }
    }
}

/**
 * Credencial con la que se envían los correos de un evento: la del evento si está activa;
 * si no, la primera activa por prioridad (la predeterminada). `null` si no hay ninguna.
 */
export async function credencialParaEvento(credencialCorreoId: number | null): Promise<CredencialCorreo | null> {
    if (credencialCorreoId) {
        const propia = await prisma.credencialCorreo.findFirst({ where: { id: credencialCorreoId, activo: true } })
        if (propia) return propia
    }
    return prisma.credencialCorreo.findFirst({ where: { activo: true }, orderBy: ORDEN_DE_PRIORIDAD })
}

/** Tras un envío o una prueba fallidos, la credencial no se ofrece para el código de acceso durante este tiempo. */
const ESPERA_TRAS_ERROR_MS = 15 * 60 * 1000

/** Si el último envío o prueba de la credencial falló hace menos de 15 min. */
function falloReciente(credencial: CredencialCorreo, ahora: Date): boolean {
    if (credencial.ultimoEstado !== 'ERROR') return false
    const ultimoResultado = Math.max(credencial.ultimoEnvioEn?.getTime() ?? 0, credencial.ultimaPruebaEn?.getTime() ?? 0)
    return ahora.getTime() - ultimoResultado < ESPERA_TRAS_ERROR_MS
}

/**
 * Credencial para los correos que no son de un evento (código de acceso al portal, spec 014): la
 * primera activa por prioridad cuyo último envío o prueba no falló hace menos de 15 min (si la
 * predeterminada falla, sigue la siguiente: spec 041). `null` si no hay ninguna: funciona como un
 * disyuntor que se recupera solo (el panel muestra `ultimoError` en Correo).
 */
export async function credencialUtilizable(ahora = new Date()): Promise<CredencialCorreo | null> {
    const activas = await prisma.credencialCorreo.findMany({ where: { activo: true }, orderBy: ORDEN_DE_PRIORIDAD })
    return activas.find((credencial) => !falloReciente(credencial, ahora)) ?? null
}

// ─── Respaldo entre credenciales (spec 041) ─────────────────────────────────

/**
 * Credenciales cuya cuenta falló (sin créditos, límite diario, clave inválida) y hasta cuándo no se
 * intenta con ellas: así un envío masivo no golpea 500 veces una cuenta agotada antes de pasar a la
 * siguiente. En memoria: se pierde al reiniciar, y entonces el primer envío vuelve a comprobarla.
 */
const enEspera = new Map<number, number>()

function estaEnEspera(id: number, ahora = Date.now()): boolean {
    const hasta = enEspera.get(id)
    if (hasta === undefined) return false
    if (hasta > ahora) return true
    enEspera.delete(id)
    return false
}

function reanudar(id: number) {
    enEspera.delete(id)
}

/** Vacía las esperas (pruebas). */
export function reiniciarEsperasDeCredenciales() {
    enEspera.clear()
}

/**
 * Credenciales a probar para un correo, en orden: la elegida y luego las activas por prioridad, sin las
 * que están en espera (salvo que todas lo estén: se intenta igual, es mejor que no enviar). Una falla
 * de la BD no impide el envío con la elegida.
 */
async function credencialesParaIntentar(elegida: CredencialCorreo): Promise<CredencialCorreo[]> {
    let respaldo: CredencialCorreo[] = []
    try {
        respaldo = (await prisma.credencialCorreo.findMany({ where: { activo: true, id: { not: elegida.id } }, orderBy: ORDEN_DE_PRIORIDAD }))
            .filter((credencial) => credencial.id !== elegida.id)
    } catch {
        respaldo = []
    }
    const todas = [elegida, ...respaldo]
    const libres = todas.filter((credencial) => !estaEnEspera(credencial.id))
    return (libres.length ? libres : todas).slice(0, MAXIMO_INTENTOS)
}

export interface OpcionesEnvio {
    /**
     * Si el resultado queda en la credencial (`ultimoEstado`, `ultimoError`, `ultimoEnvioEn`). Los
     * envíos que provoca un anónimo (código de acceso, spec 014) no lo registran: un fallo suyo no
     * debe apagar el acceso por código (`credencialUtilizable`) ni revelar qué correos existen.
     */
    registrar?: boolean
}

/**
 * Envía un correo con una credencial y registra el resultado; devuelve el error o `null`. Si la
 * credencial falla, lo prueba con las demás activas por prioridad (hasta 3): el remitente pasa a ser
 * el de la credencial que envía (Brevo exige uno verificado y Gmail solo firma con su cuenta). El error
 * que se devuelve es el de la elegida. Una cuenta agotada (sin créditos, límite diario) queda 15 min en
 * espera y no se vuelve a intentar mientras haya otra.
 */
export async function enviarConCredencial(credencial: CredencialCorreo, correo: CorreoSaliente, opciones: OpcionesEnvio = {}): Promise<string | null> {
    const registrar = opciones.registrar ?? true
    let primerError: string | null = null
    for (const candidata of await credencialesParaIntentar(credencial)) {
        const mensaje = candidata.id === credencial.id ? correo : { ...correo, remitente: { ...correo.remitente, email: candidata.remitenteCorreo } }
        try {
            await enviarPorProveedor(candidata, mensaje)
            reanudar(candidata.id)
            if (registrar) await registrarResultado(candidata.id, null, 'ultimoEnvioEn').catch(() => undefined)
            if (candidata.id !== credencial.id) console.warn(`[correo] La credencial ${credencial.id} falló; el correo salió por la ${candidata.id}`)
            return null
        } catch (error) {
            const detalle = mensajeDe(error)
            primerError ??= detalle
            if (error instanceof CorreoFallido && error.deLaCuenta) enEspera.set(candidata.id, Date.now() + ESPERA_TRAS_ERROR_MS)
            if (registrar) await registrarResultado(candidata.id, detalle, 'ultimoEnvioEn').catch(() => undefined)
        }
    }
    return primerError
}

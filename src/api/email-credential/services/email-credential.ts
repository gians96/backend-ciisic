import type { CredencialCorreo, Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { notFound, unprocessable } from '../../../core/http-error'
import { escapeHtml } from '../../../core/html'
import { cifrar, descifrar, sufijo } from '../../../core/crypto'
import { CorreoFallido, cuentaBrevo, enviarConBrevo, type CorreoSaliente, type CuentaBrevo } from './brevo-client'
import type { ActualizarCredencialInput, CrearCredencialInput } from '../validation'

type CredencialConEventos = CredencialCorreo & { eventos?: { id: number, codigo: string, nombreCorto: string }[] }

const conEventos = { eventos: { select: { id: true, codigo: true, nombreCorto: true }, orderBy: { id: 'asc' } } } satisfies Prisma.CredencialCorreoInclude

export function aCredencial(c: CredencialConEventos) {
    return {
        id: c.id,
        proveedor: c.proveedor,
        nombre: c.nombre,
        apiKeyEnmascarada: `••••${c.apiKeySufijo}`,
        remitenteCorreo: c.remitenteCorreo,
        remitenteNombre: c.remitenteNombre,
        esPredeterminada: c.esPredeterminada,
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
        orderBy: [{ esPredeterminada: 'desc' }, { id: 'asc' }],
    })
    return credenciales.map(aCredencial)
}

export async function crearCredencial(input: CrearCredencialInput) {
    // La primera credencial queda como predeterminada.
    const esPredeterminada = (await prisma.credencialCorreo.count()) === 0 ? true : input.esPredeterminada ?? false
    const credencial = await prisma.$transaction(async (tx) => {
        if (esPredeterminada) await tx.credencialCorreo.updateMany({ data: { esPredeterminada: false } })
        return tx.credencialCorreo.create({
            data: {
                nombre: input.nombre,
                apiKeyCifrada: cifrar(input.apiKey),
                apiKeySufijo: sufijo(input.apiKey),
                remitenteCorreo: input.remitenteCorreo,
                remitenteNombre: input.remitenteNombre ?? null,
                esPredeterminada,
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
    const data: Prisma.CredencialCorreoUpdateInput = {}
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.remitenteCorreo !== undefined) data.remitenteCorreo = input.remitenteCorreo
    if (input.remitenteNombre !== undefined) data.remitenteNombre = input.remitenteNombre
    if (input.activo !== undefined) data.activo = input.activo
    if (input.apiKey !== undefined) {
        data.apiKeyCifrada = cifrar(input.apiKey)
        data.apiKeySufijo = sufijo(input.apiKey)
        data.ultimoEstado = null
        data.ultimoError = null
    }
    if (input.esPredeterminada) data.esPredeterminada = true
    const credencial = await prisma.$transaction(async (tx) => {
        if (input.esPredeterminada) await tx.credencialCorreo.updateMany({ where: { id: { not: id } }, data: { esPredeterminada: false } })
        return tx.credencialCorreo.update({ where: { id }, data, include: conEventos })
    })
    return aCredencial(credencial)
}

export async function eliminarCredencial(id: number) {
    const credencial = await obtener(id)
    await prisma.$transaction(async (tx) => {
        await tx.credencialCorreo.delete({ where: { id } })
        if (!credencial.esPredeterminada) return
        // Se promueve otra (activa primero, la más antigua) para no quedar sin predeterminada.
        const siguiente = await tx.credencialCorreo.findFirst({ orderBy: [{ activo: 'desc' }, { id: 'asc' }] })
        if (siguiente) await tx.credencialCorreo.update({ where: { id: siguiente.id }, data: { esPredeterminada: true } })
    })
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

/** Verifica la API key contra Brevo (sin enviar correos) y devuelve la cuenta y sus créditos. */
export async function probarCredencial(id: number): Promise<{ ok: boolean, cuenta?: CuentaBrevo, error?: string, credencial: ReturnType<typeof aCredencial> }> {
    const credencial = await obtener(id)
    try {
        const cuenta = await cuentaBrevo(descifrar(credencial.apiKeyCifrada))
        await registrarResultado(id, null, 'ultimaPruebaEn')
        return { ok: true, cuenta, credencial: aCredencial(await obtener(id)) }
    } catch (error) {
        await registrarResultado(id, mensajeDe(error), 'ultimaPruebaEn')
        return { ok: false, error: mensajeDe(error), credencial: aCredencial(await obtener(id)) }
    }
}

/** Envía un correo de prueba para confirmar que el remitente está verificado en Brevo. */
export async function enviarCorreoDePrueba(id: number, correo: string) {
    const credencial = await obtener(id)
    const remitente = credencial.remitenteNombre || 'CIISIC'
    try {
        await enviarConBrevo(descifrar(credencial.apiKeyCifrada), {
            remitente: { email: credencial.remitenteCorreo, name: remitente },
            para: [{ email: correo }],
            asunto: `Correo de prueba · ${remitente}`,
            html: `<p>Este es un correo de prueba de la credencial <strong>${escapeHtml(credencial.nombre)}</strong>.</p>`
                + '<p>Si lo recibiste, los correos de aprobación de inscripciones se enviarán correctamente.</p>',
        })
        await registrarResultado(id, null, 'ultimoEnvioEn')
        return { ok: true, credencial: aCredencial(await obtener(id)) }
    } catch (error) {
        await registrarResultado(id, mensajeDe(error), 'ultimoEnvioEn')
        return { ok: false, error: mensajeDe(error), credencial: aCredencial(await obtener(id)) }
    }
}

/**
 * Credencial con la que se envían los correos de un evento: la del evento si está activa;
 * si no, la predeterminada activa; si no, la activa más antigua. `null` si no hay ninguna.
 */
export async function credencialParaEvento(credencialCorreoId: number | null): Promise<CredencialCorreo | null> {
    if (credencialCorreoId) {
        const propia = await prisma.credencialCorreo.findFirst({ where: { id: credencialCorreoId, activo: true } })
        if (propia) return propia
    }
    return prisma.credencialCorreo.findFirst({ where: { activo: true }, orderBy: [{ esPredeterminada: 'desc' }, { id: 'asc' }] })
}

/** Envía un correo con una credencial y registra el resultado; devuelve el error o `null`. */
export async function enviarConCredencial(credencial: CredencialCorreo, correo: CorreoSaliente): Promise<string | null> {
    try {
        await enviarConBrevo(descifrar(credencial.apiKeyCifrada), correo)
        await registrarResultado(credencial.id, null, 'ultimoEnvioEn').catch(() => undefined)
        return null
    } catch (error) {
        await registrarResultado(credencial.id, mensajeDe(error), 'ultimoEnvioEn').catch(() => undefined)
        return mensajeDe(error)
    }
}

import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError } from '../../../core/http-error'
import { tipoCuentaUndc } from '../../../core/correo-institucional'
import { firmarSesionAdmin, firmarSesionParticipante } from '../../../core/sesiones'
import { aUsuarioSesion } from '../../admin/services/admin'
import { verificarIdTokenGoogle, type IdentidadGoogle } from './google-verifier'
import { firmarVerificacionCorreo } from './verificacion-correo'

type Vinculable = { id: number, googleSub: string | null }

/**
 * Vincula la cuenta Google (sub estable) en el primer ingreso y exige la misma en los siguientes.
 * Protege contra correos de Workspace reasignados a otra persona.
 */
async function vincular(tabla: 'administrador' | 'participante', registro: Vinculable, identidad: IdentidadGoogle) {
    if (registro.googleSub) {
        if (registro.googleSub !== identidad.sub) {
            throw new HttpError(403, 'GOOGLE_ACCOUNT_MISMATCH', 'Este correo ya está vinculado a otra cuenta de Google. Pide a un administrador que lo desvincule.')
        }
        return
    }
    const data = { googleSub: identidad.sub, googleVinculadoEn: new Date() }
    try {
        if (tabla === 'administrador') await prisma.administrador.update({ where: { id: registro.id }, data })
        else await prisma.participante.update({ where: { id: registro.id }, data })
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw conflict('GOOGLE_ACCOUNT_IN_USE', 'Esta cuenta de Google ya está vinculada a otro registro.')
        }
        throw error
    }
}

/**
 * Inicio de sesión con Google (panel): un administrador activo con ese correo entra como
 * administrador (cualquier dominio, también Gmail); si no, un participante inscrito entra al
 * portal "Mis inscripciones".
 */
export async function iniciarSesionConGoogle(idToken: string, nonce: string) {
    const identidad = await verificarIdTokenGoogle(idToken, { nonce })

    const admin = await prisma.administrador.findUnique({ where: { correo: identidad.correo }, include: { rol: true } })
    if (admin?.activo) {
        await vincular('administrador', admin, identidad)
        const usuario = aUsuarioSesion(admin)
        const sesion = firmarSesionAdmin(usuario, 'GOOGLE')
        return { jwt: sesion.jwt, tipo: 'ADMIN' as const, usuario, expiraEn: sesion.expiraEn }
    }

    const participante = await prisma.participante.findUnique({ where: { correo: identidad.correo } })
    if (participante) {
        await vincular('participante', participante, identidad)
        const datos = { id: participante.id, nombres: participante.nombres, apellidos: participante.apellidos, correo: participante.correo }
        const sesion = firmarSesionParticipante(datos)
        return { jwt: sesion.jwt, tipo: 'PARTICIPANTE' as const, participante: datos, expiraEn: sesion.expiraEn }
    }

    if (admin) throw new HttpError(403, 'ACCOUNT_DISABLED', 'Tu cuenta de administrador está desactivada.')
    throw new HttpError(403, 'GOOGLE_ACCOUNT_NOT_REGISTERED', 'Tu cuenta de Google no está registrada como administrador ni como inscrito en un evento.')
}

/**
 * Verificación opcional del correo en la landing (spec 010): prueba que la persona controla la
 * cuenta y devuelve un token firmado que la inscripción guarda como evidencia. No cambia precios.
 */
export async function verificarCorreoConGoogle(evento: Evento, idToken: string) {
    const identidad = await verificarIdTokenGoogle(idToken)
    const tipoCuenta = tipoCuentaUndc(identidad.correo)
    const verificacionCorreoToken = firmarVerificacionCorreo({
        eventoId: evento.id,
        correo: identidad.correo,
        tipoCuenta,
        hd: identidad.hd,
        metodo: 'GOOGLE',
        verificadoEn: new Date().toISOString(),
    })
    return {
        correo: identidad.correo,
        nombres: identidad.nombres,
        apellidos: identidad.apellidos,
        tipoCuenta,
        esInstitucional: tipoCuenta !== 'EXTERNO',
        verificacionCorreoToken,
    }
}

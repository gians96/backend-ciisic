import bcrypt from 'bcryptjs'
import type { Administrador, Prisma, Rol } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound } from '../../../core/http-error'
import type { CodigoRol } from '../../../core/catalogos'
import { firmarSesionAdmin, SESION_SEGUNDOS, type MetodoSesion } from '../../../core/sesiones'
import type { UserData } from '../../../middlewares/auth'
import type { CreateAdminInput, UpdateAdminInput } from '../validation'

const COSTO_BCRYPT = 12

type AdminConRol = Administrador & { rol: Rol }

export function aUsuarioSesion(admin: AdminConRol): UserData {
    return {
        id: admin.id,
        nombres: admin.nombres,
        apellidos: admin.apellidos,
        correo: admin.correo,
        rolId: admin.rolId,
        rolCodigo: admin.rol.codigo as CodigoRol,
        rolNombre: admin.rol.nombre,
    }
}

export function aAdminPublico(admin: AdminConRol) {
    return {
        id: admin.id,
        nombres: admin.nombres,
        apellidos: admin.apellidos,
        correo: admin.correo,
        rolId: admin.rolId,
        rolCodigo: admin.rol.codigo,
        rolNombre: admin.rol.nombre,
        activo: admin.activo,
        googleVinculado: Boolean(admin.googleSub),
        googleVinculadoEn: admin.googleVinculadoEn,
        creadoEn: admin.creadoEn,
        actualizadoEn: admin.actualizadoEn,
    }
}

/** JWT de sesión administrativa (audiencia `ciisic-admin`, 1 h). */
export function generateToken(admin: AdminConRol, metodo: MetodoSesion = 'PASSWORD'): string {
    return firmarSesionAdmin(aUsuarioSesion(admin), metodo).jwt
}

let hashFicticio: string | null = null

export async function loginAdmin(correo: string, contrasena: string) {
    const admin = await prisma.administrador.findUnique({ where: { correo }, include: { rol: true } })
    // Se compara siempre para no revelar por tiempo de respuesta si el correo existe
    hashFicticio ??= await bcrypt.hash('contrasena-ficticia-para-comparar', COSTO_BCRYPT)
    const valida = await bcrypt.compare(contrasena, admin?.contrasenaHash ?? hashFicticio)
    if (!admin || !valida || !admin.activo) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales incorrectas')
    return { jwt: generateToken(admin), usuario: aUsuarioSesion(admin), expiraEn: SESION_SEGUNDOS }
}

async function rolPorCodigo(codigo: string) {
    const rol = await prisma.rol.findUnique({ where: { codigo } })
    if (!rol) throw notFound('ROLE_NOT_FOUND', `El rol ${codigo} no existe.`)
    return rol
}

async function obtener(id: number): Promise<AdminConRol> {
    const admin = await prisma.administrador.findUnique({ where: { id }, include: { rol: true } })
    if (!admin) throw notFound('ADMIN_NOT_FOUND', `Administrador con id ${id} no encontrado`)
    return admin
}

export async function getAdmins() {
    const admins = await prisma.administrador.findMany({ include: { rol: true }, orderBy: { id: 'asc' } })
    return admins.map(aAdminPublico)
}

export async function getAdminById(id: number) {
    return aAdminPublico(await obtener(id))
}

export async function createAdmin(input: CreateAdminInput) {
    if (await prisma.administrador.findUnique({ where: { correo: input.correo } })) throw conflict('EMAIL_IN_USE', 'Ya existe un administrador con ese correo.')
    const rol = await rolPorCodigo(input.rolCodigo ?? 'ADMIN')
    const admin = await prisma.administrador.create({
        data: {
            nombres: input.nombres,
            apellidos: input.apellidos,
            correo: input.correo,
            contrasenaHash: await bcrypt.hash(input.contrasena, COSTO_BCRYPT),
            rolId: rol.id,
            activo: input.activo ?? true,
        },
        include: { rol: true },
    })
    return aAdminPublico(admin)
}

export async function updateAdmin(id: number, input: UpdateAdminInput, actorId?: number) {
    const actual = await obtener(id)
    if (actorId === id && (input.activo === false || (input.rolCodigo && input.rolCodigo !== 'SUPERADMIN'))) {
        throw conflict('SELF_UPDATE_FORBIDDEN', 'No puede desactivarse ni quitarse el rol de SuperAdmin a sí mismo.')
    }
    if (input.correo) {
        const otro = await prisma.administrador.findUnique({ where: { correo: input.correo } })
        if (otro && otro.id !== id) throw conflict('EMAIL_IN_USE', 'Ya existe un administrador con ese correo.')
    }
    const data: Prisma.AdministradorUncheckedUpdateInput = {}
    if (input.nombres !== undefined) data.nombres = input.nombres
    if (input.apellidos !== undefined) data.apellidos = input.apellidos
    if (input.correo !== undefined) data.correo = input.correo
    if (input.contrasena !== undefined) data.contrasenaHash = await bcrypt.hash(input.contrasena, COSTO_BCRYPT)
    if (input.rolCodigo !== undefined) data.rolId = (await rolPorCodigo(input.rolCodigo)).id
    if (input.activo !== undefined) data.activo = input.activo
    // Si cambia el correo o se pide explícitamente, se deshace el vínculo con la cuenta Google
    if ((input.correo !== undefined && input.correo !== actual.correo) || input.desvincularGoogle) {
        data.googleSub = null
        data.googleVinculadoEn = null
    }
    const admin = await prisma.administrador.update({ where: { id }, data, include: { rol: true } })
    return aAdminPublico(admin)
}

export async function deleteAdmin(id: number, actorId?: number) {
    if (actorId === id) throw conflict('SELF_DELETE_FORBIDDEN', 'No puede eliminarse a sí mismo.')
    await obtener(id)
    const revisiones = await prisma.inscripcion.count({ where: { revisadoPorId: id } })
    if (revisiones) {
        // Conserva el historial de revisiones: se desactiva en lugar de borrar
        await prisma.administrador.update({ where: { id }, data: { activo: false } })
        return { desactivado: true }
    }
    await prisma.administrador.delete({ where: { id } })
    return { desactivado: false }
}

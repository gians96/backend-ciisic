import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { esCodigoRol, ROL, type CodigoRol } from '../../../core/catalogos'
import { accesoPublico, actorDesdeFila, usuarioDeActor, type AccesoPublico, type Actor } from '../../../core/actor'
import { alcanceDeRol, cierre, PERMISOS_ELEGIBLES_COMISION, rolesGestionables, type Permiso } from '../../../core/permisos'
import { firmarSesionAdmin, huellaCredenciales, inicioDeSesion, SESION_MAXIMA_SEGUNDOS, SESION_SEGUNDOS, type CargaSesion, type UsuarioSesion } from '../../../core/sesiones'
import type { CreateAdminInput, UpdateAdminInput } from '../validation'

const COSTO_BCRYPT = 12

/** Relaciones que decide el acceso de una cuenta (las mismas que carga `consultarActor`). */
export const INCLUIR_ACTOR = {
    rol: true,
    asignacionesEvento: { select: { eventoId: true } },
    permisos: { select: { permiso: true } },
} satisfies Prisma.AdministradorInclude

/** La cuenta como la ve la gestión del equipo: además, el nombre corto de sus eventos. */
const INCLUIR_CUENTA = {
    rol: true,
    asignacionesEvento: { select: { eventoId: true, evento: { select: { id: true, nombreCorto: true } } }, orderBy: { eventoId: 'asc' } },
    permisos: { select: { permiso: true }, orderBy: { permiso: 'asc' } },
} satisfies Prisma.AdministradorInclude

type Cuenta = Prisma.AdministradorGetPayload<{ include: typeof INCLUIR_CUENTA }>

/** Acceso de la sesión del panel: el del actor y si la persona también es inscrita (portal). */
export interface AccesoSesion extends AccesoPublico {
    perfilParticipante: boolean
}

export type UsuarioConAcceso = UsuarioSesion & { acceso: AccesoSesion }

export async function accesoDeSesion(actor: Actor): Promise<AccesoSesion> {
    const participante = await prisma.participante.findUnique({ where: { correo: actor.correo.toLowerCase() }, select: { id: true } })
    return { ...accesoPublico(actor), perfilParticipante: Boolean(participante) }
}

/** Datos del usuario de la sesión con su acceso (login, Google, sesión y renovación). */
export async function usuarioConAcceso(actor: Actor): Promise<UsuarioConAcceso> {
    return { ...usuarioDeActor(actor), acceso: await accesoDeSesion(actor) }
}

export function aAdminPublico(admin: Cuenta) {
    const rolCodigo = admin.rol.codigo
    return {
        id: admin.id,
        nombres: admin.nombres,
        apellidos: admin.apellidos,
        correo: admin.correo,
        rolId: admin.rolId,
        rolCodigo,
        rolNombre: admin.rol.nombre,
        activo: admin.activo,
        tieneContrasena: Boolean(admin.contrasenaHash),
        googleVinculado: Boolean(admin.googleSub),
        googleVinculadoEn: admin.googleVinculadoEn,
        creadoEn: admin.creadoEn,
        actualizadoEn: admin.actualizadoEn,
        // Spec 013
        alcance: esCodigoRol(rolCodigo) ? alcanceDeRol(rolCodigo) : null,
        eventos: admin.asignacionesEvento.map(({ evento }) => ({ id: evento.id, nombreCorto: evento.nombreCorto })),
        permisos: admin.permisos.map(({ permiso }) => permiso),
    }
}

let hashFicticio: string | null = null

export async function loginAdmin(correo: string, contrasena: string) {
    const admin = await prisma.administrador.findUnique({ where: { correo }, include: INCLUIR_ACTOR })
    // Se compara siempre (también sin cuenta o sin contraseña) para no revelar por tiempo de
    // respuesta si el correo existe. El hash ficticio es de un valor aleatorio que nadie conoce.
    hashFicticio ??= await bcrypt.hash(randomBytes(32).toString('hex'), COSTO_BCRYPT)
    const valida = await bcrypt.compare(contrasena, admin?.contrasenaHash ?? hashFicticio)
    // Sin contraseña el administrador entra solo con Google. Una cuenta inactiva o con un rol
    // desconocido tampoco entra: su sesión no pasaría ninguna guarda.
    const actor = admin?.contrasenaHash && valida ? actorDesdeFila(admin) : null
    if (!admin || !actor) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Credenciales incorrectas')
    const usuario = await usuarioConAcceso(actor)
    const sesion = firmarSesionAdmin(usuarioDeActor(actor), { metodo: 'PASSWORD', huella: huellaCredenciales(admin) })
    return { jwt: sesion.jwt, usuario, expiraEn: SESION_SEGUNDOS }
}

/**
 * Renueva la sesión del staff con los datos actuales de la cuenta (la guarda ya la leyó de la BD y
 * comprobó la huella). Conserva el método y el inicio de la sesión: pasadas `SESION_MAXIMA_SEGUNDOS`
 * desde que se ingresó, hay que volver a ingresar (401 `SESSION_EXPIRED`).
 */
export async function renovarSesion(actor: Actor, sesion: CargaSesion) {
    const inicio = inicioDeSesion(sesion)
    if (Math.floor(Date.now() / 1000) - inicio > SESION_MAXIMA_SEGUNDOS) {
        throw new HttpError(401, 'SESSION_EXPIRED', 'Tu sesión llegó a su duración máxima. Ingresa nuevamente.')
    }
    if (!sesion.huella) throw new HttpError(401, 'SESSION_INVALIDATED', 'Tu sesión ya no es válida. Ingresa nuevamente.')
    const nueva = firmarSesionAdmin(usuarioDeActor(actor), { metodo: sesion.metodo ?? 'PASSWORD', huella: sesion.huella, authTime: inicio })
    return { jwt: nueva.jwt, expiraEn: nueva.expiraEn, usuario: await usuarioConAcceso(actor) }
}

// ─── Gestión del equipo (delegación, spec 013) ─────────────────────────────────

const noGestionable = () => new HttpError(403, 'ADMIN_NOT_MANAGEABLE', 'No puedes ver ni gestionar esta cuenta.')
const rolNoAsignable = (codigo: string) => new HttpError(403, 'ROLE_NOT_ASSIGNABLE', `No puedes asignar el rol ${codigo}.`)

/** El Owner gestiona todas las cuentas; el Administrador del sistema, las de Tesorero y Comisión. */
function gestionaCuenta(actor: Actor, rolCodigo: string): boolean {
    return actor.rolCodigo === ROL.OWNER || (rolesGestionables(actor.rolCodigo) as string[]).includes(rolCodigo)
}

function asignaRol(actor: Actor, rolCodigo: CodigoRol): boolean {
    return rolesGestionables(actor.rolCodigo).includes(rolCodigo)
}

/** Roles que un Administrador del sistema puede gestionar (Tesorero y Comisión). */
function delegable(rolCodigo: string): boolean {
    return (rolesGestionables(ROL.ADMINISTRADOR) as string[]).includes(rolCodigo)
}

/** Cuentas visibles: las gestionables y la propia. */
function filtroVisibles(actor: Actor): Prisma.AdministradorWhereInput {
    if (actor.rolCodigo === ROL.OWNER) return {}
    return { OR: [{ rol: { codigo: { in: rolesGestionables(actor.rolCodigo) } } }, { id: actor.id }] }
}

async function rolPorCodigo(codigo: string) {
    const rol = await prisma.rol.findUnique({ where: { codigo } })
    if (!rol) throw notFound('ROLE_NOT_FOUND', `El rol ${codigo} no existe.`)
    return rol
}

async function obtener(id: number): Promise<Cuenta> {
    const admin = await prisma.administrador.findUnique({ where: { id }, include: INCLUIR_CUENTA })
    if (!admin) throw notFound('ADMIN_NOT_FOUND', `Administrador con id ${id} no encontrado`)
    return admin
}

function mismoConjunto<T>(a: readonly T[], b: readonly T[]): boolean {
    const sa = new Set(a)
    const sb = new Set(b)
    return sa.size === sb.size && [...sa].every((valor) => sb.has(valor))
}

async function validarEventos(eventoIds: readonly number[]): Promise<number[]> {
    const unicos = [...new Set(eventoIds)].sort((a, b) => a - b)
    if (!unicos.length) throw unprocessable('EVENTS_REQUIRED', 'Asigna al menos un evento a esta cuenta.', { eventoIds: 'Elige al menos un evento.' })
    const existentes = await prisma.evento.count({ where: { id: { in: unicos } } })
    if (existentes !== unicos.length) throw unprocessable('EVENT_NOT_FOUND', 'Alguno de los eventos elegidos no existe.', { eventoIds: 'Hay eventos que no existen.' })
    return unicos
}

/** Permisos elegidos para la Comisión, con sus dependencias y siempre dentro de los elegibles. */
function validarPermisos(permisos: readonly string[]): Permiso[] {
    if (!permisos.length) throw unprocessable('PERMISSIONS_REQUIRED', 'Elige al menos un permiso para la cuenta de la Comisión.', { permisos: 'Elige al menos un permiso.' })
    const elegibles = new Set<string>(PERMISOS_ELEGIBLES_COMISION)
    const noElegible = permisos.find((p) => !elegibles.has(p))
    if (noElegible) throw unprocessable('PERMISSION_NOT_ELIGIBLE', `El permiso ${noElegible} no se puede asignar a la Comisión.`, { permisos: `${noElegible} no es elegible.` })
    return [...cierre(permisos)].filter((p) => elegibles.has(p)).sort()
}

/** Conjuntos a guardar; `undefined` deja el actual y `[]` lo borra. */
interface Conjuntos {
    eventoIds?: number[]
    permisos?: Permiso[]
}

/**
 * Valida los eventos y permisos según el rol final de la cuenta. Los roles por evento exigen
 * eventos (y la Comisión, permisos) al crear la cuenta o al pasar a ese rol, si no vienen y la
 * cuenta no los tenía. Editar o desactivar una cuenta que se quedó sin eventos (p. ej. porque se
 * borró su único evento) no los exige; si se envían, nunca pueden ir vacíos. Los demás roles no
 * guardan filas y se borran las que hubiera.
 */
async function conjuntosPara(
    rolCodigo: string,
    input: { eventoIds?: number[], permisos?: string[], activo?: boolean },
    actual: Cuenta | null,
): Promise<Conjuntos> {
    if (!esCodigoRol(rolCodigo)) return {}
    const eventosActuales = actual?.asignacionesEvento.map((a) => a.eventoId) ?? []
    const permisosActuales = actual?.permisos.map((p) => p.permiso) ?? []
    const exigir = !actual || (rolCodigo !== actual.rol.codigo && input.activo !== false)
    const conjuntos: Conjuntos = {}

    if (alcanceDeRol(rolCodigo) === 'EVENTO') {
        if (input.eventoIds !== undefined) conjuntos.eventoIds = await validarEventos(input.eventoIds)
        else if (exigir && !eventosActuales.length) throw unprocessable('EVENTS_REQUIRED', 'Asigna al menos un evento a esta cuenta.', { eventoIds: 'Elige al menos un evento.' })
    } else if (eventosActuales.length) conjuntos.eventoIds = []

    if (rolCodigo === ROL.COMISION) {
        if (input.permisos !== undefined) conjuntos.permisos = validarPermisos(input.permisos)
        else if (exigir && !permisosActuales.length) throw unprocessable('PERMISSIONS_REQUIRED', 'Elige al menos un permiso para la cuenta de la Comisión.', { permisos: 'Elige al menos un permiso.' })
    } else if (permisosActuales.length) conjuntos.permisos = []

    // Sin cambios reales no se reescriben las filas
    if (conjuntos.eventoIds && actual && mismoConjunto(conjuntos.eventoIds, eventosActuales)) delete conjuntos.eventoIds
    if (conjuntos.permisos && actual && mismoConjunto<string>(conjuntos.permisos, permisosActuales)) delete conjuntos.permisos
    return conjuntos
}

/**
 * Impide dejar el sistema sin Owner activo. Bloquea las filas de los Owners activos (`FOR UPDATE`)
 * para que dos cambios simultáneos no pasen ambos la comprobación.
 */
async function exigirOtroOwner(tx: Prisma.TransactionClient, id: number) {
    const owners = await tx.$queryRaw<{ id: number }[]>`
        SELECT a.id FROM administradores a JOIN roles r ON r.id = a.rol_id
        WHERE r.codigo = ${ROL.OWNER} AND a.activo = 1
        FOR UPDATE`
    if (!owners.some((owner) => Number(owner.id) !== id)) throw conflict('LAST_OWNER', 'Debe quedar al menos un Owner activo.')
}

/**
 * Relee el rol de la cuenta bloqueando su fila (`FOR UPDATE`) antes de escribir. La delegación se
 * comprobó con una lectura previa: si entre tanto el rol cambió (p. ej. el Owner promovió la cuenta
 * mientras un Administrador le cambiaba la contraseña), la escritura no se aplica.
 */
async function exigirMismoRol(tx: Prisma.TransactionClient, id: number, rolId: number) {
    const filas = await tx.$queryRaw<{ rolId: number }[]>`
        SELECT a.rol_id AS rolId FROM administradores a WHERE a.id = ${id} FOR UPDATE`
    if (!filas.length) throw notFound('ADMIN_NOT_FOUND', `Administrador con id ${id} no encontrado`)
    if (Number(filas[0].rolId) !== rolId) throw conflict('ADMIN_CHANGED', 'La cuenta cambió mientras la editabas. Vuelve a cargarla e inténtalo de nuevo.')
}

export async function getAdmins(actor: Actor) {
    const admins = await prisma.administrador.findMany({ where: filtroVisibles(actor), include: INCLUIR_CUENTA, orderBy: { id: 'asc' } })
    return admins.map(aAdminPublico)
}

export async function getAdminById(id: number, actor: Actor) {
    const admin = await obtener(id)
    if (admin.id !== actor.id && !gestionaCuenta(actor, admin.rol.codigo)) throw noGestionable()
    return aAdminPublico(admin)
}

export async function createAdmin(input: CreateAdminInput, actor: Actor) {
    if (!asignaRol(actor, input.rolCodigo)) throw rolNoAsignable(input.rolCodigo)
    if (await prisma.administrador.findUnique({ where: { correo: input.correo } })) throw conflict('EMAIL_IN_USE', 'Ya existe un administrador con ese correo.')
    const rol = await rolPorCodigo(input.rolCodigo)
    const conjuntos = await conjuntosPara(rol.codigo, input, null)
    // Escritura anidada: Prisma crea la cuenta, sus eventos y sus permisos en una sola transacción
    const admin = await prisma.administrador.create({
        data: {
            nombres: input.nombres,
            apellidos: input.apellidos,
            correo: input.correo,
            contrasenaHash: input.contrasena ? await bcrypt.hash(input.contrasena, COSTO_BCRYPT) : null,
            rolId: rol.id,
            activo: input.activo ?? true,
            asignacionesEvento: { create: (conjuntos.eventoIds ?? []).map((eventoId) => ({ eventoId })) },
            permisos: { create: (conjuntos.permisos ?? []).map((permiso) => ({ permiso })) },
        },
        include: INCLUIR_CUENTA,
    })
    return aAdminPublico(admin)
}

export async function updateAdmin(id: number, input: UpdateAdminInput, actor: Actor) {
    const actual = await obtener(id)
    const propia = actor.id === id
    if (!propia && !gestionaCuenta(actor, actual.rol.codigo)) throw noGestionable()
    // Enviar el mismo rol o el mismo correo no es un cambio (el panel siempre los manda)
    const cambiaRol = input.rolCodigo !== undefined && input.rolCodigo !== actual.rol.codigo
    const cambiaCorreo = input.correo !== undefined && input.correo.toLowerCase() !== actual.correo.toLowerCase()
    if (propia) {
        const eventosActuales = actual.asignacionesEvento.map((a) => a.eventoId)
        const permisosActuales = actual.permisos.map((p) => p.permiso)
        if (input.activo === false || cambiaRol
            || (input.eventoIds !== undefined && !mismoConjunto(input.eventoIds, eventosActuales))
            || (input.permisos !== undefined && !mismoConjunto(input.permisos, permisosActuales))) {
            throw conflict('SELF_UPDATE_FORBIDDEN', 'No puedes desactivarte ni cambiar tu propio rol, eventos o permisos.')
        }
        // Salvo el Owner, en la propia cuenta solo se editan el nombre y la contraseña: el correo y la
        // cuenta Google deciden quién entra con ella (desactivar su cuenta de Workspace debe cortarle el acceso)
        if (actor.rolCodigo !== ROL.OWNER && (cambiaCorreo || input.desvincularGoogle)) {
            throw conflict('SELF_UPDATE_FORBIDDEN', 'Solo un Owner puede cambiar tu correo o desvincular tu cuenta de Google.')
        }
    }
    if (cambiaRol && input.rolCodigo && !asignaRol(actor, input.rolCodigo)) throw rolNoAsignable(input.rolCodigo)
    // Quitar la propia contraseña solo si Google ya funciona para esa cuenta: si no, quedaría sin acceso
    if (propia && input.quitarContrasena && (!actual.googleSub || cambiaCorreo || input.desvincularGoogle)) {
        throw conflict('SELF_UPDATE_FORBIDDEN', 'Para quitar tu propia contraseña, primero entra una vez con Google usando este correo.')
    }
    if (input.correo) {
        const otro = await prisma.administrador.findUnique({ where: { correo: input.correo } })
        if (otro && otro.id !== id) throw conflict('EMAIL_IN_USE', 'Ya existe un administrador con ese correo.')
    }
    const rol = cambiaRol && input.rolCodigo ? await rolPorCodigo(input.rolCodigo) : actual.rol
    const conjuntos = await conjuntosPara(rol.codigo, input, actual)
    // Una cuenta que sale de lo que gestiona el Administrador (un Tesorero o Comisión que pasa a un rol
    // global) pierde la contraseña y el vínculo con Google: un Administrador pudo dejarlos puestos antes
    // de la promoción. Quien la promueve puede enviar una contraseña nueva en la misma petición; si no,
    // la persona entra con Google usando su correo.
    const saleDeDelegacion = cambiaRol && delegable(actual.rol.codigo) && !delegable(rol.codigo)

    const data: Prisma.AdministradorUncheckedUpdateInput = {}
    if (input.nombres !== undefined) data.nombres = input.nombres
    if (input.apellidos !== undefined) data.apellidos = input.apellidos
    if (input.correo !== undefined) data.correo = input.correo
    if (input.contrasena !== undefined) data.contrasenaHash = await bcrypt.hash(input.contrasena, COSTO_BCRYPT)
    else if (input.quitarContrasena || saleDeDelegacion) data.contrasenaHash = null
    if (cambiaRol) data.rolId = rol.id
    if (input.activo !== undefined) data.activo = input.activo
    // Si cambia el correo, se pide explícitamente o sale de la delegación, se deshace el vínculo con
    // la cuenta Google. Todo cambio de correo, contraseña o Google cierra las sesiones abiertas de la
    // cuenta (cambia su huella, ver `huellaCredenciales`).
    if (cambiaCorreo || input.desvincularGoogle || saleDeDelegacion) {
        data.googleSub = null
        data.googleVinculadoEn = null
    }
    // Los conjuntos se reemplazan completos
    if (conjuntos.eventoIds) data.asignacionesEvento = { deleteMany: {}, create: conjuntos.eventoIds.map((eventoId) => ({ eventoId })) }
    if (conjuntos.permisos) data.permisos = { deleteMany: {}, create: conjuntos.permisos.map((permiso) => ({ permiso })) }

    const dejaDeSerOwner = actual.rol.codigo === ROL.OWNER && actual.activo && (rol.codigo !== ROL.OWNER || input.activo === false)
    const admin = await prisma.$transaction(async (tx) => {
        // El Owner gestiona cualquier rol; los demás, solo si la cuenta sigue en su delegación
        if (actor.rolCodigo !== ROL.OWNER) await exigirMismoRol(tx, id, actual.rolId)
        if (dejaDeSerOwner) await exigirOtroOwner(tx, id)
        return tx.administrador.update({ where: { id }, data, include: INCLUIR_CUENTA })
    })
    return aAdminPublico(admin)
}

export async function deleteAdmin(id: number, actor: Actor) {
    if (actor.id === id) throw conflict('SELF_DELETE_FORBIDDEN', 'No puede eliminarse a sí mismo.')
    const actual = await obtener(id)
    if (!gestionaCuenta(actor, actual.rol.codigo)) throw noGestionable()
    const [revisiones, asistencias] = await Promise.all([
        prisma.inscripcion.count({ where: { revisadoPorId: id } }),
        prisma.asistencia.count({ where: { OR: [{ registradoPorId: id }, { anuladoPorId: id }] } }),
    ])
    return prisma.$transaction(async (tx) => {
        if (actor.rolCodigo !== ROL.OWNER) await exigirMismoRol(tx, id, actual.rolId)
        if (actual.rol.codigo === ROL.OWNER && actual.activo) await exigirOtroOwner(tx, id)
        if (revisiones || asistencias) {
            // Conserva el historial de revisiones y asistencias: se desactiva en lugar de borrar
            await tx.administrador.update({ where: { id }, data: { activo: false } })
            return { desactivado: true }
        }
        await tx.administrador.delete({ where: { id } })
        return { desactivado: false }
    })
}

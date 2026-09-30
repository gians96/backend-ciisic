import { prisma } from '../../src/database/prisma'
import { ROL } from '../../src/core/catalogos'
import { PERMISOS } from '../../src/core/permisos'
import { huellaCredenciales } from '../../src/core/sesiones'
import { INCLUIR_ACTOR } from '../../src/api/admin/services/admin'
import { accesoPublico, actorDeSesion, actorDesdeFila, cargarActor, puedeEnEvento, tienePermiso, usuarioDeActor } from '../../src/core/actor'
import { filaActor, olvidarActor, registrarActor } from '../helpers/actores'

// Solo para la consulta real de `actor-consulta` (el resto del archivo usa el registro simulado)
jest.mock('../../src/database/prisma', () => ({ prisma: { administrador: { findUnique: jest.fn() } } }))

// `consultarActor` está simulado con el registro de `tests/helpers/actores.ts` (tests/setup-actor.ts)
describe('actorDesdeFila (spec 013)', () => {
    it('sin fila, cuenta inactiva o rol desconocido: null (la sesión deja de valer)', () => {
        expect(actorDesdeFila(null)).toBeNull()
        expect(actorDesdeFila(filaActor(5, ROL.OWNER, { activo: false }))).toBeNull()
        expect(actorDesdeFila(filaActor(6, ROL.COMISION, { activo: false, eventoIds: [2], permisos: ['asistencia.marcar'] }))).toBeNull()
        for (const codigo of ['OWNER', 'SUPERVISOR', 'admin', '']) {
            const fila = filaActor(7, ROL.ADMINISTRADOR)
            expect(actorDesdeFila({ ...fila, rol: { ...fila.rol, codigo } })).toBeNull()
        }
    })

    it('una cuenta global ve todos los eventos: eventoIds vacío y accesoPublico.eventoIds null', () => {
        // Asignaciones que quedaron de cuando la cuenta era por evento: no restringen a una global
        const actor = actorDesdeFila(filaActor(2, ROL.ADMINISTRADOR, { eventoIds: [2, 3] }))
        expect(actor).toMatchObject({ id: 2, rolCodigo: ROL.ADMINISTRADOR, rolNombre: 'Administrador del sistema', alcance: 'GLOBAL', eventoIds: [] })
        const acceso = accesoPublico(actor!)
        expect(acceso.alcance).toBe('GLOBAL')
        expect(acceso.eventoIds).toBeNull()
        expect(acceso.permisos).not.toContain('sistema.configurar')
        expect(puedeEnEvento(actor!, 99)).toBe(true)

        const owner = actorDesdeFila(filaActor(1, ROL.OWNER))!
        expect(accesoPublico(owner)).toEqual({ alcance: 'GLOBAL', eventoIds: null, permisos: [...PERMISOS].sort() })
    })

    it('una cuenta por evento conserva sus eventos; accesoPublico los ordena', () => {
        const actor = actorDesdeFila(filaActor(30, ROL.TESORERO, { eventoIds: [3, 2] }))!
        expect(actor).toMatchObject({ alcance: 'EVENTO', eventoIds: [3, 2] })
        expect(accesoPublico(actor)).toMatchObject({ alcance: 'EVENTO', eventoIds: [2, 3] })
        expect(puedeEnEvento(actor, 2)).toBe(true)
        expect(puedeEnEvento(actor, 4)).toBe(false)
        expect(tienePermiso(actor, 'pagos.ver')).toBe(true)
        expect(tienePermiso(actor, 'eventos.configurar')).toBe(false)
    })

    it('una cuenta por evento sin eventos asignados no opera en ninguno', () => {
        const actor = actorDesdeFila(filaActor(31, ROL.TESORERO))!
        expect(accesoPublico(actor).eventoIds).toEqual([])
        expect(puedeEnEvento(actor, 2)).toBe(false)
    })

    it('la Comisión recibe sus permisos elegidos con dependencias, sin los no elegibles', () => {
        const actor = actorDesdeFila(filaActor(40, ROL.COMISION, { eventoIds: [2], permisos: ['asistencia.marcar', 'pagos.ver', 'sistema.configurar'] }))!
        expect(accesoPublico(actor)).toEqual({ alcance: 'EVENTO', eventoIds: [2], permisos: ['asistencia.marcar', 'asistencia.ver'] })
        expect(tienePermiso(actor, 'pagos.ver')).toBe(false)
    })

    it('usuarioDeActor devuelve solo los datos de la sesión (sin permisos ni eventos)', () => {
        const actor = actorDesdeFila(filaActor(30, ROL.TESORERO, { eventoIds: [2], correo: 'tesoreria@undc.edu.pe' }))!
        expect(usuarioDeActor(actor)).toEqual({
            id: 30, nombres: 'Test', apellidos: 'Tesorero', correo: 'tesoreria@undc.edu.pe', rolId: 3, rolCodigo: ROL.TESORERO, rolNombre: 'Tesorero',
        })
    })
})

describe('cargarActor', () => {
    it('lee la cuenta actual; una cuenta borrada devuelve null', async () => {
        registrarActor(41, ROL.COMISION, { eventoIds: [2], permisos: ['ponencias.ver'] })
        expect(await cargarActor(41)).toMatchObject({ id: 41, alcance: 'EVENTO', eventoIds: [2] })

        registrarActor(41, ROL.COMISION, { eventoIds: [3], permisos: ['ponencias.ver'], activo: false })
        expect(await cargarActor(41)).toBeNull()

        olvidarActor(41)
        expect(await cargarActor(41)).toBeNull()
    })
})

describe('actorDeSesion: huella de las credenciales', () => {
    it('vale mientras el correo, la contraseña y la cuenta Google sigan iguales', async () => {
        const fila = registrarActor(47, ROL.TESORERO, { eventoIds: [2], contrasenaHash: '$2a$12$hash', googleSub: 'sub-1' })
        const huella = huellaCredenciales(fila)
        expect(await actorDeSesion(47, huella)).toMatchObject({ id: 47, alcance: 'EVENTO' })
        // Los eventos o permisos pueden cambiar sin cerrar la sesión
        registrarActor(47, ROL.TESORERO, { eventoIds: [2, 3], contrasenaHash: '$2a$12$hash', googleSub: 'sub-1' })
        expect(await actorDeSesion(47, huella)).toMatchObject({ eventoIds: [2, 3] })
        // Mayúsculas del correo: la misma huella
        expect(huellaCredenciales({ ...fila, correo: fila.correo.toUpperCase() })).toBe(huella)

        for (const cambio of [{ correo: 'otra@undc.edu.pe' }, { contrasenaHash: '$2a$12$otro' }, { contrasenaHash: null }, { googleSub: null }, { googleSub: 'sub-2' }]) {
            registrarActor(47, ROL.TESORERO, { eventoIds: [2], contrasenaHash: '$2a$12$hash', googleSub: 'sub-1', ...cambio })
            expect(await actorDeSesion(47, huella)).toBeNull()
        }
    })

    it('sin huella (JWT anterior a la spec 013) o con una cuenta inactiva: null', async () => {
        const fila = registrarActor(48, ROL.ADMINISTRADOR)
        expect(await actorDeSesion(48, undefined)).toBeNull()
        registrarActor(48, ROL.ADMINISTRADOR, { activo: false })
        expect(await actorDeSesion(48, huellaCredenciales(fila))).toBeNull()
    })

    it('la huella no expone el hash de la contraseña', () => {
        const huella = huellaCredenciales({ correo: 'a@undc.edu.pe', contrasenaHash: '$2a$12$abcdefghijklmnopqrstuv', googleSub: 'sub-1' })
        expect(huella).toMatch(/^[\w-]{22}$/)
        expect(huella).not.toContain('abcdefghij')
    })
})

describe('consultarActor (consulta real, sin el registro simulado)', () => {
    const { consultarActor } = jest.requireActual('../../src/core/actor-consulta') as typeof import('../../src/core/actor-consulta')
    const findUnique = (prisma as unknown as { administrador: { findUnique: jest.Mock } }).administrador.findUnique

    it('lee la cuenta por id con su rol, eventos y permisos (y las credenciales de la huella)', async () => {
        const fila = filaActor(30, ROL.TESORERO, { eventoIds: [2], contrasenaHash: '$2a$12$hash', googleSub: 'sub-1' })
        findUnique.mockResolvedValueOnce(fila)
        expect(await consultarActor(30)).toBe(fila)
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: 30 },
            include: { rol: true, asignacionesEvento: { select: { eventoId: true } }, permisos: { select: { permiso: true } } },
        })
        // Sin `select` de la cuenta: vienen correo, contraseña y googleSub. Login y Google usan las mismas relaciones
        expect(findUnique.mock.calls[0][0]).not.toHaveProperty('select')
        expect(findUnique.mock.calls[0][0].include).toEqual(INCLUIR_ACTOR)
    })

    it('una cuenta inexistente devuelve null', async () => {
        findUnique.mockResolvedValueOnce(null)
        expect(await consultarActor(999)).toBeNull()
    })
})

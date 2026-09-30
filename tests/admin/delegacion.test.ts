import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { ROL, ROLES, type CodigoRol } from '../../src/core/catalogos'
import { olvidarActor } from '../helpers/actores'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Delegación del equipo (spec 013). Las guardas leen la cuenta del registro de `tokenDeRol`; el
 * servicio, de esta «BD» en memoria. `sesion()` mantiene ambos coherentes.
 */
jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        administrador: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        rol: { findUnique: jest.fn() },
        evento: { count: jest.fn() },
        inscripcion: { count: jest.fn() },
        asistencia: { count: jest.fn() },
        participante: { findUnique: jest.fn() },
        $queryRaw: jest.fn(),
    }
    mock.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mock))
    return { prisma: mock }
})

type Mock = jest.Mock
const m = prisma as unknown as {
    administrador: Record<'findUnique' | 'findMany' | 'create' | 'update' | 'delete', Mock>
    rol: { findUnique: Mock }
    evento: { count: Mock }
    inscripcion: { count: Mock }
    asistencia: { count: Mock }
    participante: { findUnique: Mock }
    $queryRaw: Mock
    $transaction: Mock
}

const NOMBRES: Record<CodigoRol, string> = { SUPERADMIN: 'Owner', ADMIN: 'Administrador del sistema', TESORERO: 'Tesorero', COMISION: 'Comisión tecnológica' }
const rolDe = (codigo: CodigoRol) => ({ id: ROLES.indexOf(codigo) + 1, codigo, nombre: NOMBRES[codigo] })
const rolPorId = (id: number) => rolDe(ROLES[id - 1])
const EVENTOS: Record<number, string> = { 2: 'VIII CIISIC', 3: 'Semana Sistémica' }
const FECHA = new Date('2026-09-30T14:00:00Z')

interface Opciones { eventoIds?: number[], permisos?: string[], activo?: boolean, correo?: string }
type Fila = ReturnType<typeof filaDe>

function filaDe(id: number, codigo: CodigoRol, opciones: Opciones = {}) {
    return {
        id, nombres: 'Test', apellidos: NOMBRES[codigo], correo: opciones.correo ?? `staff${id}@example.com`, contrasenaHash: null as string | null,
        rolId: rolDe(codigo).id, rol: rolDe(codigo), activo: opciones.activo ?? true, googleSub: null as string | null, googleVinculadoEn: null as Date | null,
        creadoEn: FECHA, actualizadoEn: FECHA,
        asignacionesEvento: (opciones.eventoIds ?? []).map((eventoId) => ({ eventoId, evento: { id: eventoId, nombreCorto: EVENTOS[eventoId] } })),
        permisos: (opciones.permisos ?? []).map((permiso) => ({ permiso })),
    }
}

const bd = new Map<number, Fila>()
let siguienteId = 100

/** Cuenta que solo existe en la BD (la gestionada). */
function cuenta(id: number, codigo: CodigoRol, opciones: Opciones = {}): Fila {
    const fila = filaDe(id, codigo, opciones)
    bd.set(id, fila)
    return fila
}

/** Cuenta que además inicia sesión: la guarda la lee del registro y el servicio de la BD. */
function sesion(id: number, codigo: CodigoRol, opciones: Opciones = {}): string {
    cuenta(id, codigo, opciones)
    return `Bearer ${tokenDeRol(codigo, id, opciones)}`
}

type Anidado = { deleteMany?: object, create?: Array<Record<string, unknown>> }

/** Aplica las escrituras anidadas (`create`, `deleteMany` + `create`) como lo haría Prisma. */
function aplicar(fila: Fila, data: Record<string, unknown>): Fila {
    const { asignacionesEvento, permisos, rolId, ...resto } = data as { asignacionesEvento?: Anidado, permisos?: Anidado, rolId?: number }
    const nueva = { ...fila, ...resto, actualizadoEn: FECHA }
    if (rolId !== undefined) Object.assign(nueva, { rolId, rol: rolPorId(rolId) })
    if (asignacionesEvento) {
        nueva.asignacionesEvento = (asignacionesEvento.create ?? []).map(({ eventoId }) => ({ eventoId: eventoId as number, evento: { id: eventoId as number, nombreCorto: EVENTOS[eventoId as number] } }))
    }
    if (permisos) nueva.permisos = (permisos.create ?? []).map(({ permiso }) => ({ permiso: permiso as string }))
    return nueva
}

type Donde = { id?: number, correo?: string, OR?: Array<{ id?: number, rol?: { codigo: { in: string[] } } }> }
const cumple = (fila: Fila, where: Donde = {}) => !where.OR || where.OR.some((c) => (c.id !== undefined ? c.id === fila.id : c.rol?.codigo.in.includes(fila.rol.codigo)))
const ownersActivos = () => [...bd.values()].filter((f) => f.rol.codigo === ROL.OWNER && f.activo).map((f) => ({ id: f.id }))

beforeEach(() => {
    jest.clearAllMocks()
    bd.clear()
    siguienteId = 100
    m.administrador.findUnique.mockImplementation(async ({ where }: { where: Donde }) => (
        [...bd.values()].find((f) => (where.id !== undefined ? f.id === where.id : f.correo === where.correo)) ?? null
    ))
    m.administrador.findMany.mockImplementation(async ({ where }: { where: Donde }) => [...bd.values()].filter((f) => cumple(f, where)).sort((a, b) => a.id - b.id))
    m.administrador.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const id = siguienteId++
        const fila = aplicar(filaDe(id, ROLES[(data.rolId as number) - 1]), { ...data, rolId: data.rolId })
        bd.set(id, fila)
        return fila
    })
    m.administrador.update.mockImplementation(async ({ where, data }: { where: { id: number }, data: Record<string, unknown> }) => {
        const fila = aplicar(bd.get(where.id) as Fila, data)
        bd.set(where.id, fila)
        return fila
    })
    m.administrador.delete.mockImplementation(async ({ where }: { where: { id: number } }) => bd.delete(where.id))
    m.rol.findUnique.mockImplementation(async ({ where }: { where: { codigo: CodigoRol } }) => rolDe(where.codigo))
    m.evento.count.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) => where.id.in.filter((id) => EVENTOS[id]).length)
    m.inscripcion.count.mockResolvedValue(0)
    m.asistencia.count.mockResolvedValue(0)
    m.participante.findUnique.mockResolvedValue(null)
    // `FOR UPDATE` sobre la cuenta que se edita (delegación) o sobre los Owners activos (LAST_OWNER)
    m.$queryRaw.mockImplementation(async (sql: TemplateStringsArray, ...valores: unknown[]) => (
        sql.join('?').includes('a.id = ?')
            ? [...bd.values()].filter((f) => f.id === valores[0]).map((f) => ({ rolId: f.rolId }))
            : ownersActivos()
    ))
})

const datos = (extra: Record<string, unknown>) => ({ nombres: 'Rosa', apellidos: 'Quispe', correo: 'rosa@undc.edu.pe', ...extra })

describe('guarda: solo quien gestiona el equipo', () => {
    it.each([
        ['get', '/api/v1/admin'],
        ['post', '/api/v1/admin'],
        ['get', '/api/v1/admin/1'],
        ['put', '/api/v1/admin/1'],
        ['delete', '/api/v1/admin/1'],
    ])('%s %s responde 403 a Tesorero y Comisión y 401 sin token', async (method, path) => {
        const llamar = (auth?: string) => {
            const r = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
            return auth ? r.set('Authorization', auth) : r
        }
        for (const auth of [sesion(30, 'TESORERO', { eventoIds: [2] }), sesion(40, 'COMISION', { eventoIds: [2], permisos: ['asistencia.marcar'] })]) {
            const r = await llamar(auth).send(datos({ rolCodigo: 'TESORERO', eventoIds: [2] }))
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        expect((await llamar()).status).toBe(401)
        expect(m.administrador.findMany).not.toHaveBeenCalled()
        expect(m.administrador.create).not.toHaveBeenCalled()
        expect(m.administrador.update).not.toHaveBeenCalled()
        expect(m.administrador.delete).not.toHaveBeenCalled()
    })

    it('una cuenta borrada pierde la sesión al instante', async () => {
        const owner = sesion(1, 'SUPERADMIN')
        olvidarActor(1)
        const r = await request(app).get('/api/v1/admin').set('Authorization', owner)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })
})

describe('lista y detalle', () => {
    beforeEach(() => {
        cuenta(5, 'SUPERADMIN')
        cuenta(6, 'ADMIN')
        cuenta(7, 'TESORERO', { eventoIds: [2, 3] })
        cuenta(8, 'COMISION', { eventoIds: [2], permisos: ['asistencia.marcar', 'asistencia.ver'] })
    })

    it('el Owner ve todas las cuentas con alcance, eventos y permisos', async () => {
        const r = await request(app).get('/api/v1/admin').set('Authorization', sesion(1, 'SUPERADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.data.map((c: { id: number }) => c.id)).toEqual([1, 5, 6, 7, 8])
        expect(m.administrador.findMany.mock.calls[0][0].where).toEqual({})
        expect(r.body.data.find((c: { id: number }) => c.id === 7)).toMatchObject({
            rolCodigo: 'TESORERO', rolNombre: 'Tesorero', alcance: 'EVENTO', activo: true, tieneContrasena: false, googleVinculado: false,
            eventos: [{ id: 2, nombreCorto: 'VIII CIISIC' }, { id: 3, nombreCorto: 'Semana Sistémica' }], permisos: [],
        })
        expect(r.body.data.find((c: { id: number }) => c.id === 8)).toMatchObject({ alcance: 'EVENTO', permisos: ['asistencia.marcar', 'asistencia.ver'] })
        expect(r.body.data.find((c: { id: number }) => c.id === 5)).toMatchObject({ alcance: 'GLOBAL', eventos: [], permisos: [] })
    })

    it('el Administrador ve solo Tesorero, Comisión y su propia cuenta', async () => {
        const r = await request(app).get('/api/v1/admin').set('Authorization', sesion(2, 'ADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.data.map((c: { id: number }) => c.id)).toEqual([2, 7, 8])
        expect(m.administrador.findMany.mock.calls[0][0].where).toEqual({ OR: [{ rol: { codigo: { in: ['TESORERO', 'COMISION'] } } }, { id: 2 }] })
    })

    it('el Administrador ve su cuenta y las gestionables, pero no un Owner ni otro Administrador', async () => {
        const auth = sesion(2, 'ADMIN')
        expect((await request(app).get('/api/v1/admin/2').set('Authorization', auth)).status).toBe(200)
        expect((await request(app).get('/api/v1/admin/7').set('Authorization', auth)).body.data).toMatchObject({ id: 7, alcance: 'EVENTO' })
        for (const id of [5, 6]) {
            const r = await request(app).get(`/api/v1/admin/${id}`).set('Authorization', auth)
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('ADMIN_NOT_MANAGEABLE')
        }
        expect((await request(app).get('/api/v1/admin/99').set('Authorization', auth)).status).toBe(404)
    })
})

describe('alta con delegación', () => {
    it('el Owner crea un Owner y un Administrador; en los roles globales no se guardan eventos ni permisos', async () => {
        const owner = sesion(1, 'SUPERADMIN')
        const nuevoOwner = await request(app).post('/api/v1/admin').set('Authorization', owner)
            .send(datos({ rolCodigo: 'SUPERADMIN', eventoIds: [2], permisos: ['asistencia.marcar'] }))
        expect(nuevoOwner.status).toBe(201)
        expect(nuevoOwner.body.data).toMatchObject({ rolCodigo: 'SUPERADMIN', rolNombre: 'Owner', alcance: 'GLOBAL', eventos: [], permisos: [] })
        expect(m.administrador.create.mock.calls[0][0].data).toMatchObject({ rolId: 1, asignacionesEvento: { create: [] }, permisos: { create: [] } })

        const admin = await request(app).post('/api/v1/admin').set('Authorization', owner).send(datos({ correo: 'otro@undc.edu.pe', rolCodigo: 'ADMIN' }))
        expect(admin.status).toBe(201)
        expect(admin.body.data).toMatchObject({ rolCodigo: 'ADMIN', alcance: 'GLOBAL' })
    })

    it('el Administrador crea un Tesorero con sus eventos', async () => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(2, 'ADMIN'))
            .send(datos({ rolCodigo: 'TESORERO', eventoIds: [3, 2, 3], permisos: ['asistencia.marcar'] }))
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({
            rolCodigo: 'TESORERO', alcance: 'EVENTO', eventos: [{ id: 2, nombreCorto: 'VIII CIISIC' }, { id: 3, nombreCorto: 'Semana Sistémica' }], permisos: [],
        })
        // Eventos sin duplicados; el Tesorero no guarda permisos propios
        expect(m.administrador.create.mock.calls[0][0].data).toMatchObject({ asignacionesEvento: { create: [{ eventoId: 2 }, { eventoId: 3 }] }, permisos: { create: [] } })
    })

    it('la Comisión guarda los permisos elegidos con sus dependencias', async () => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(2, 'ADMIN'))
            .send(datos({ rolCodigo: 'COMISION', eventoIds: [2], permisos: ['asistencia.fuera_horario'] }))
        expect(r.status).toBe(201)
        expect(r.body.data.permisos).toEqual(['asistencia.fuera_horario', 'asistencia.marcar', 'asistencia.ver'])
    })

    it.each(['ADMIN', 'SUPERADMIN'])('el Administrador no puede crear una cuenta %s', async (rolCodigo) => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(2, 'ADMIN')).send(datos({ rolCodigo }))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('ROLE_NOT_ASSIGNABLE')
        expect(m.administrador.create).not.toHaveBeenCalled()
    })

    it.each([
        ['sin eventos (Tesorero)', { rolCodigo: 'TESORERO' }, 'EVENTS_REQUIRED'],
        ['con la lista de eventos vacía', { rolCodigo: 'TESORERO', eventoIds: [] }, 'EVENTS_REQUIRED'],
        ['con un evento inexistente', { rolCodigo: 'TESORERO', eventoIds: [2, 9] }, 'EVENT_NOT_FOUND'],
        ['sin permisos (Comisión)', { rolCodigo: 'COMISION', eventoIds: [2] }, 'PERMISSIONS_REQUIRED'],
        ['con pagos.ver (Comisión)', { rolCodigo: 'COMISION', eventoIds: [2], permisos: ['asistencia.marcar', 'pagos.ver'] }, 'PERMISSION_NOT_ELIGIBLE'],
        ['con un permiso global (Comisión)', { rolCodigo: 'COMISION', eventoIds: [2], permisos: ['eventos.configurar'] }, 'PERMISSION_NOT_ELIGIBLE'],
    ])('422 %s', async (_caso, extra, code) => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(2, 'ADMIN')).send(datos(extra))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe(code)
        expect(m.administrador.create).not.toHaveBeenCalled()
    })

    it('el rol es obligatorio al crear (sin valor por defecto)', async () => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(1, 'SUPERADMIN')).send(datos({}))
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { rolCodigo: expect.any(String) } })
        expect(m.administrador.create).not.toHaveBeenCalled()
    })

    it('valida la forma de eventoIds y permisos', async () => {
        const r = await request(app).post('/api/v1/admin').set('Authorization', sesion(1, 'SUPERADMIN'))
            .send(datos({ rolCodigo: 'TESORERO', eventoIds: [0, 'x'], permisos: Array.from({ length: 31 }, () => 'asistencia.ver') }))
        expect(r.status).toBe(422)
        expect(Object.keys(r.body.fields)).toEqual(expect.arrayContaining(['eventoIds[0]', 'eventoIds[1]', 'permisos']))
    })
})

describe('edición con delegación', () => {
    it('el Administrador no edita ni borra a un Owner ni a otro Administrador', async () => {
        cuenta(5, 'SUPERADMIN')
        cuenta(6, 'ADMIN')
        const auth = sesion(2, 'ADMIN')
        for (const id of [5, 6]) {
            const put = await request(app).put(`/api/v1/admin/${id}`).set('Authorization', auth).send({ nombres: 'Otro' })
            expect(put.status).toBe(403)
            expect(put.body.code).toBe('ADMIN_NOT_MANAGEABLE')
            const del = await request(app).delete(`/api/v1/admin/${id}`).set('Authorization', auth)
            expect(del.status).toBe(403)
            expect(del.body.code).toBe('ADMIN_NOT_MANAGEABLE')
        }
        expect(m.administrador.update).not.toHaveBeenCalled()
        expect(m.administrador.delete).not.toHaveBeenCalled()
    })

    it('el Administrador no puede subir a un Tesorero a Administrador u Owner', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        for (const rolCodigo of ['ADMIN', 'SUPERADMIN']) {
            const r = await request(app).put('/api/v1/admin/7').set('Authorization', sesion(2, 'ADMIN')).send({ rolCodigo })
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('ROLE_NOT_ASSIGNABLE')
        }
        expect(m.administrador.update).not.toHaveBeenCalled()
    })

    it('el Administrador cambia los eventos de un Tesorero (reemplazan el conjunto completo)', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        const r = await request(app).put('/api/v1/admin/7').set('Authorization', sesion(2, 'ADMIN')).send({ rolCodigo: 'TESORERO', eventoIds: [3] })
        expect(r.status).toBe(200)
        expect(m.administrador.update.mock.calls[0][0].data.asignacionesEvento).toEqual({ deleteMany: {}, create: [{ eventoId: 3 }] })
        expect(r.body.data.eventos).toEqual([{ id: 3, nombreCorto: 'Semana Sistémica' }])
    })

    it('pasar de Tesorero a Comisión exige permisos; con ellos conserva los eventos', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        const auth = sesion(2, 'ADMIN')
        const sin = await request(app).put('/api/v1/admin/7').set('Authorization', auth).send({ rolCodigo: 'COMISION' })
        expect(sin.status).toBe(422)
        expect(sin.body.code).toBe('PERMISSIONS_REQUIRED')
        const con = await request(app).put('/api/v1/admin/7').set('Authorization', auth).send({ rolCodigo: 'COMISION', permisos: ['asistencia.marcar'] })
        expect(con.status).toBe(200)
        expect(con.body.data).toMatchObject({ rolCodigo: 'COMISION', eventos: [{ id: 2, nombreCorto: 'VIII CIISIC' }], permisos: ['asistencia.marcar', 'asistencia.ver'] })
        expect(m.administrador.update.mock.calls[0][0].data).not.toHaveProperty('asignacionesEvento')
    })

    it('al pasar a un rol global se borran los eventos y los permisos en la misma escritura', async () => {
        cuenta(8, 'COMISION', { eventoIds: [2], permisos: ['asistencia.marcar', 'asistencia.ver'] })
        const r = await request(app).put('/api/v1/admin/8').set('Authorization', sesion(1, 'SUPERADMIN')).send({ rolCodigo: 'ADMIN' })
        expect(r.status).toBe(200)
        expect(m.$transaction).toHaveBeenCalled()
        expect(m.administrador.update.mock.calls[0][0].data).toMatchObject({
            rolId: 2, asignacionesEvento: { deleteMany: {}, create: [] }, permisos: { deleteMany: {}, create: [] },
        })
        expect(r.body.data).toMatchObject({ rolCodigo: 'ADMIN', alcance: 'GLOBAL', eventos: [], permisos: [] })
    })

    it('pasar de un rol global a uno por evento exige eventos', async () => {
        cuenta(6, 'ADMIN')
        const r = await request(app).put('/api/v1/admin/6').set('Authorization', sesion(1, 'SUPERADMIN')).send({ rolCodigo: 'TESORERO' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('EVENTS_REQUIRED')
    })

    it('una cuenta que se quedó sin eventos (p. ej. se borró su evento) se puede editar y desactivar', async () => {
        cuenta(7, 'TESORERO')
        cuenta(8, 'COMISION')
        const auth = sesion(2, 'ADMIN')
        for (const [id, rolCodigo] of [[7, 'TESORERO'], [8, 'COMISION']] as const) {
            for (const cambios of [{ nombres: 'Otro', rolCodigo }, { desvincularGoogle: true }, { activo: false, rolCodigo }]) {
                const r = await request(app).put(`/api/v1/admin/${id}`).set('Authorization', auth).send(cambios)
                expect(r.status).toBe(200)
            }
        }
        expect(bd.get(7)).toMatchObject({ nombres: 'Otro', activo: false })
        // Si se envían, los eventos nunca van vacíos
        const vacios = await request(app).put('/api/v1/admin/7').set('Authorization', auth).send({ eventoIds: [] })
        expect(vacios.status).toBe(422)
        expect(vacios.body.code).toBe('EVENTS_REQUIRED')
    })
})

describe('promoción fuera de la delegación', () => {
    const conCredenciales = (id: number, codigo: CodigoRol, opciones: Opciones = {}) => Object.assign(cuenta(id, codigo, opciones), {
        contrasenaHash: '$2a$12$puestaPorElAdministrador', googleSub: 'google-sub-x', googleVinculadoEn: FECHA,
    })

    it('un Tesorero que pasa a un rol global pierde la contraseña y el vínculo con Google', async () => {
        conCredenciales(7, 'TESORERO', { eventoIds: [2] })
        const r = await request(app).put('/api/v1/admin/7').set('Authorization', sesion(1, 'SUPERADMIN')).send({ rolCodigo: 'SUPERADMIN' })
        expect(r.status).toBe(200)
        expect(m.administrador.update.mock.calls[0][0].data).toMatchObject({ rolId: 1, contrasenaHash: null, googleSub: null, googleVinculadoEn: null })
        expect(r.body.data).toMatchObject({ rolCodigo: 'SUPERADMIN', tieneContrasena: false, googleVinculado: false })
    })

    it('el Owner puede poner una contraseña nueva en la misma petición', async () => {
        conCredenciales(8, 'COMISION', { eventoIds: [2], permisos: ['asistencia.marcar'] })
        const r = await request(app).put('/api/v1/admin/8').set('Authorization', sesion(1, 'SUPERADMIN')).send({ rolCodigo: 'ADMIN', contrasena: 'una-contrasena-nueva' })
        expect(r.status).toBe(200)
        const { data } = m.administrador.update.mock.calls[0][0]
        expect(data.contrasenaHash).toEqual(expect.stringMatching(/^\$2[aby]\$12\$/))
        expect(data.contrasenaHash).not.toBe('$2a$12$puestaPorElAdministrador')
        expect(data).toMatchObject({ googleSub: null, googleVinculadoEn: null })
    })

    it.each([
        ['de Administrador a Owner', 6, 'ADMIN', 'SUPERADMIN'],
        ['de Tesorero a Comisión', 7, 'TESORERO', 'COMISION'],
    ] as const)('%s conserva las credenciales', async (_caso, id, desde, hacia) => {
        conCredenciales(id, desde, desde === 'TESORERO' ? { eventoIds: [2] } : {})
        const cuerpo = hacia === 'COMISION' ? { rolCodigo: hacia, permisos: ['asistencia.marcar'] } : { rolCodigo: hacia }
        const r = await request(app).put(`/api/v1/admin/${id}`).set('Authorization', sesion(1, 'SUPERADMIN')).send(cuerpo)
        expect(r.status).toBe(200)
        const { data } = m.administrador.update.mock.calls[0][0]
        expect(data).not.toHaveProperty('contrasenaHash')
        expect(data).not.toHaveProperty('googleSub')
    })
})

describe('cambios simultáneos', () => {
    // El Owner promovió la cuenta entre la lectura y la escritura del Administrador
    function promovidaEntreTanto(id: number) {
        m.$queryRaw.mockImplementation(async (sql: TemplateStringsArray, ...valores: unknown[]) => (
            sql.join('?').includes('a.id = ?') && valores[0] === id ? [{ rolId: rolDe('ADMIN').id }] : ownersActivos()
        ))
    }

    it.each(['put', 'delete'] as const)('%s del Administrador no se aplica si el rol cambió: 409 ADMIN_CHANGED', async (metodo) => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        promovidaEntreTanto(7)
        const auth = sesion(2, 'ADMIN')
        const r = metodo === 'put'
            ? await request(app).put('/api/v1/admin/7').set('Authorization', auth).send({ contrasena: 'contrasena-del-admin' })
            : await request(app).delete('/api/v1/admin/7').set('Authorization', auth)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ADMIN_CHANGED')
        expect(m.administrador.update).not.toHaveBeenCalled()
        expect(m.administrador.delete).not.toHaveBeenCalled()
        // La relectura bloquea la fila de la cuenta dentro de la transacción
        const [sql, ...valores] = m.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
        expect(sql.join('?')).toMatch(/WHERE a\.id = \?[\s\S]*FOR UPDATE/)
        expect(valores).toEqual([7])
    })

    it('con el mismo rol la escritura se aplica', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        const r = await request(app).put('/api/v1/admin/7').set('Authorization', sesion(2, 'ADMIN')).send({ nombres: 'Otro' })
        expect(r.status).toBe(200)
        expect(m.$queryRaw).toHaveBeenCalledTimes(1)
    })
})

describe('la propia cuenta', () => {
    it.each([
        ['un Administrador', 2, 'ADMIN'],
        ['un Owner', 1, 'SUPERADMIN'],
    ] as const)('%s edita su nombre enviando su mismo rolCodigo (como hace el panel)', async (_caso, id, rolCodigo) => {
        const r = await request(app).put(`/api/v1/admin/${id}`).set('Authorization', sesion(id, rolCodigo))
            .send({ nombres: 'Nuevo', apellidos: 'Nombre', correo: `staff${id}@example.com`, rolCodigo, activo: true, eventoIds: [], permisos: [] })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ nombres: 'Nuevo', rolCodigo })
        expect(m.administrador.update.mock.calls[0][0].data).not.toHaveProperty('rolId')
    })

    it.each([
        ['cambiarse el rol', { rolCodigo: 'TESORERO', eventoIds: [2] }],
        ['desactivarse', { activo: false }],
        ['asignarse eventos', { eventoIds: [2] }],
        ['asignarse permisos', { permisos: ['asistencia.marcar'] }],
    ])('409 al %s', async (_caso, cambios) => {
        const r = await request(app).put('/api/v1/admin/2').set('Authorization', sesion(2, 'ADMIN')).send(cambios)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('SELF_UPDATE_FORBIDDEN')
        expect(m.administrador.update).not.toHaveBeenCalled()
    })

    it('el Administrador no cambia su propio correo ni desvincula su Google (409)', async () => {
        for (const cambios of [{ correo: 'personal@gmail.com' }, { desvincularGoogle: true }]) {
            const r = await request(app).put('/api/v1/admin/2').set('Authorization', sesion(2, 'ADMIN')).send({ nombres: 'Nuevo', ...cambios })
            expect(r.status).toBe(409)
            expect(r.body.code).toBe('SELF_UPDATE_FORBIDDEN')
        }
        expect(m.administrador.update).not.toHaveBeenCalled()
        // El mismo correo (con otras mayúsculas) no es un cambio
        const mismo = await request(app).put('/api/v1/admin/2').set('Authorization', sesion(2, 'ADMIN')).send({ correo: 'Staff2@Example.com', contrasena: 'una-contrasena-nueva' })
        expect(mismo.status).toBe(200)
        expect(m.administrador.update.mock.calls[0][0].data).not.toHaveProperty('googleSub')
    })

    it('el Owner sí cambia su propio correo (y se deshace su vínculo con Google)', async () => {
        const r = await request(app).put('/api/v1/admin/1').set('Authorization', sesion(1, 'SUPERADMIN')).send({ correo: 'owner@undc.edu.pe' })
        expect(r.status).toBe(200)
        expect(m.administrador.update.mock.calls[0][0].data).toMatchObject({ correo: 'owner@undc.edu.pe', googleSub: null })
    })

    it('no puede borrarse a sí misma', async () => {
        const r = await request(app).delete('/api/v1/admin/1').set('Authorization', sesion(1, 'SUPERADMIN'))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('SELF_DELETE_FORBIDDEN')
    })
})

describe('último Owner activo', () => {
    // Otro cambio simultáneo ya desactivó a quien hace la petición: la consulta bloqueante solo ve
    // al Owner afectado
    function otroOwnerSeFue() {
        (bd.get(1) as Fila).activo = false
    }

    it.each([
        ['degradarlo', 'put', { rolCodigo: 'ADMIN' }],
        ['desactivarlo', 'put', { activo: false }],
        ['borrarlo', 'delete', undefined],
    ] as const)('409 LAST_OWNER al %s', async (_caso, metodo, cuerpo) => {
        const auth = sesion(1, 'SUPERADMIN')
        cuenta(5, 'SUPERADMIN')
        otroOwnerSeFue()
        const r = metodo === 'put'
            ? await request(app).put('/api/v1/admin/5').set('Authorization', auth).send(cuerpo)
            : await request(app).delete('/api/v1/admin/5').set('Authorization', auth)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('LAST_OWNER')
        expect(m.administrador.update).not.toHaveBeenCalled()
        expect(m.administrador.delete).not.toHaveBeenCalled()
        // La comprobación bloquea las filas de los Owners activos dentro de la transacción
        const [sql, ...valores] = m.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
        expect(sql.join('?')).toMatch(/JOIN roles[\s\S]*activo = 1[\s\S]*FOR UPDATE/)
        expect(valores).toEqual([ROL.OWNER])
    })

    it('con otro Owner activo sí se puede degradar', async () => {
        const auth = sesion(1, 'SUPERADMIN')
        cuenta(5, 'SUPERADMIN')
        const r = await request(app).put('/api/v1/admin/5').set('Authorization', auth).send({ rolCodigo: 'ADMIN' })
        expect(r.status).toBe(200)
        expect(r.body.data.rolCodigo).toBe('ADMIN')
    })

    it('no consulta los Owners si la cuenta no deja de ser Owner activo', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        cuenta(5, 'SUPERADMIN', { activo: false })
        const auth = sesion(1, 'SUPERADMIN')
        expect((await request(app).put('/api/v1/admin/7').set('Authorization', auth).send({ activo: false })).status).toBe(200)
        expect((await request(app).delete('/api/v1/admin/5').set('Authorization', auth)).status).toBe(200)
        expect(m.$queryRaw).not.toHaveBeenCalled()
    })
})

describe('baja', () => {
    it('una cuenta con asistencias registradas o anuladas se desactiva en lugar de borrarse', async () => {
        cuenta(8, 'COMISION', { eventoIds: [2], permisos: ['asistencia.marcar'] })
        m.asistencia.count.mockResolvedValue(3)
        const r = await request(app).delete('/api/v1/admin/8').set('Authorization', sesion(2, 'ADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ desactivado: true })
        expect(m.asistencia.count).toHaveBeenCalledWith({ where: { OR: [{ registradoPorId: 8 }, { anuladoPorId: 8 }] } })
        expect(m.administrador.update).toHaveBeenCalledWith({ where: { id: 8 }, data: { activo: false } })
        expect(m.administrador.delete).not.toHaveBeenCalled()
    })

    it('una cuenta con revisiones de inscripciones también se desactiva', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        m.inscripcion.count.mockResolvedValue(1)
        const r = await request(app).delete('/api/v1/admin/7').set('Authorization', sesion(2, 'ADMIN'))
        expect(r.body.data).toEqual({ desactivado: true })
    })

    it('sin historial se borra', async () => {
        cuenta(7, 'TESORERO', { eventoIds: [2] })
        const r = await request(app).delete('/api/v1/admin/7').set('Authorization', sesion(2, 'ADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ desactivado: false })
        expect(m.administrador.delete).toHaveBeenCalledWith({ where: { id: 7 } })
    })
})

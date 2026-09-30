import bcrypt from 'bcryptjs'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        administrador: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        rol: { findUnique: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    administrador: { findUnique: Mock, create: Mock, update: Mock }
    rol: { findUnique: Mock }
}

const ROL_ADMIN = { id: 2, codigo: 'ADMIN', nombre: 'Admin' }
const ROL_SUPERADMIN = { id: 1, codigo: 'SUPERADMIN', nombre: 'SuperAdmin' }
const SUPERADMIN = `Bearer ${tokenDeRol('SUPERADMIN', 1)}`

function admin(extra: Record<string, unknown> = {}) {
    return {
        id: 7, nombres: 'Ana', apellidos: 'Ríos', correo: 'ana@undc.edu.pe', contrasenaHash: null as string | null,
        rolId: 2, rol: ROL_ADMIN, activo: true, googleSub: null as string | null, googleVinculadoEn: null as Date | null,
        creadoEn: new Date('2026-09-30T14:00:00Z'), actualizadoEn: new Date('2026-09-30T14:00:00Z'), ...extra,
    }
}

/** El registro actual que devuelve `findUnique` y el resultado del `update` con sus cambios. */
function existente(actual: ReturnType<typeof admin>) {
    m.administrador.findUnique.mockImplementation(async ({ where }) => (where.id === actual.id || where.correo === actual.correo ? actual : null))
    m.administrador.update.mockImplementation(async ({ data }) => ({ ...actual, ...data }))
}

beforeEach(() => {
    jest.clearAllMocks()
    m.rol.findUnique.mockResolvedValue(ROL_ADMIN)
    m.administrador.findUnique.mockResolvedValue(null)
    m.administrador.create.mockImplementation(async ({ data }) => admin(data))
})

describe('alta de administradores', () => {
    const datos = { nombres: 'Ana', apellidos: 'Ríos', correo: 'ana@undc.edu.pe' }

    it('crea un administrador sin contraseña (entra solo con Google)', async () => {
        const res = await request(app).post('/api/v1/admin').set('Authorization', SUPERADMIN).send(datos)
        expect(res.status).toBe(201)
        expect(m.administrador.create.mock.calls[0][0].data.contrasenaHash).toBeNull()
        expect(res.body.data).toMatchObject({ correo: 'ana@undc.edu.pe', tieneContrasena: false })
        expect(res.body.data).not.toHaveProperty('contrasenaHash')
    })

    it('con contraseña guarda solo el hash', async () => {
        const res = await request(app).post('/api/v1/admin').set('Authorization', SUPERADMIN).send({ ...datos, contrasena: 'una-clave-segura-2026' })
        expect(res.status).toBe(201)
        const hash = m.administrador.create.mock.calls[0][0].data.contrasenaHash as string
        expect(hash).toMatch(/^\$2[aby]\$12\$/)
        await expect(bcrypt.compare('una-clave-segura-2026', hash)).resolves.toBe(true)
        expect(res.body.data.tieneContrasena).toBe(true)
    })

    it('si se envía contraseña, exige 12 caracteres', async () => {
        const res = await request(app).post('/api/v1/admin').set('Authorization', SUPERADMIN).send({ ...datos, contrasena: 'corta' })
        expect(res.status).toBe(422)
        expect(res.body.fields).toHaveProperty('contrasena')
        expect(m.administrador.create).not.toHaveBeenCalled()
    })
})

describe('inicio de sesión con contraseña', () => {
    it.each([
        ['una contraseña cualquiera', 'una-clave-segura-2026'],
        ['el texto del hash ficticio anterior', 'contrasena-ficticia-para-comparar'],
    ])('un administrador sin contraseña no entra con %s', async (_caso, contrasena) => {
        existente(admin())
        const res = await request(app).post('/api/v1/auth/login').send({ correo: 'ana@undc.edu.pe', contrasena })
        expect(res.status).toBe(401)
        expect(res.body).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' })
    })

    it('con contraseña entra como siempre', async () => {
        existente(admin({ contrasenaHash: await bcrypt.hash('una-clave-segura-2026', 4) }))
        const res = await request(app).post('/api/v1/auth/login').send({ correo: 'ana@undc.edu.pe', contrasena: 'una-clave-segura-2026' })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({ tipo: 'ADMIN', usuario: { correo: 'ana@undc.edu.pe' } })
    })
})

describe('quitar la contraseña', () => {
    it('deja la cuenta de otro administrador solo con Google', async () => {
        existente(admin({ contrasenaHash: 'hash-anterior' }))
        const res = await request(app).put('/api/v1/admin/7').set('Authorization', SUPERADMIN).send({ quitarContrasena: true })
        expect(res.status).toBe(200)
        expect(m.administrador.update.mock.calls[0][0].data.contrasenaHash).toBeNull()
        expect(res.body.data.tieneContrasena).toBe(false)
    })

    it('no acepta quitarla y enviar una nueva a la vez', async () => {
        existente(admin({ contrasenaHash: 'hash-anterior' }))
        const res = await request(app).put('/api/v1/admin/7').set('Authorization', SUPERADMIN).send({ quitarContrasena: true, contrasena: 'una-clave-segura-2026' })
        expect(res.status).toBe(422)
        expect(res.body.fields).toHaveProperty('quitarContrasena')
    })

    it('no deja quitarse la propia contraseña sin haber entrado con Google', async () => {
        existente(admin({ rolId: 1, rol: ROL_SUPERADMIN, contrasenaHash: 'hash-anterior' }))
        const res = await request(app).put('/api/v1/admin/7').set('Authorization', `Bearer ${tokenDeRol('SUPERADMIN', 7)}`).send({ quitarContrasena: true })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('SELF_UPDATE_FORBIDDEN')
        expect(m.administrador.update).not.toHaveBeenCalled()
    })

    it('sí deja quitarse la propia contraseña con Google vinculado', async () => {
        existente(admin({ rolId: 1, rol: ROL_SUPERADMIN, contrasenaHash: 'hash-anterior', googleSub: 'sub-123', googleVinculadoEn: new Date() }))
        const res = await request(app).put('/api/v1/admin/7').set('Authorization', `Bearer ${tokenDeRol('SUPERADMIN', 7)}`).send({ quitarContrasena: true })
        expect(res.status).toBe(200)
        expect(res.body.data).toMatchObject({ tieneContrasena: false, googleVinculado: true })
    })

    it('al asignar una contraseña a una cuenta solo con Google la vuelve mixta', async () => {
        existente(admin())
        const res = await request(app).put('/api/v1/admin/7').set('Authorization', SUPERADMIN).send({ contrasena: 'una-clave-segura-2026' })
        expect(res.status).toBe(200)
        expect(res.body.data.tieneContrasena).toBe(true)
    })
})

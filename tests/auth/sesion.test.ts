import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../src/app'
import { env } from '../../config/env'
import { AUDIENCIA_ADMIN, EMISOR } from '../../src/core/sesiones'
import { prisma } from '../../src/database/prisma'
import { consultarActor } from '../../src/core/actor-consulta'
import { filaActor, olvidarActor, registrarActor } from '../helpers/actores'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

// GET /v1/auth/session (spec 013): el staff recibe sus datos frescos de la BD y su acceso.
jest.mock('../../src/database/prisma', () => ({
    prisma: { participante: { findUnique: jest.fn() } },
}))

const m = prisma as unknown as { participante: { findUnique: jest.Mock } }
const sesion = (auth?: string) => {
    const r = request(app).get('/api/v1/auth/session')
    return auth ? r.set('Authorization', `Bearer ${auth}`) : r
}

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue(null)
})

describe('GET /v1/auth/session', () => {
    it('el Owner recibe la forma anterior más su acceso (todos los permisos y eventos)', async () => {
        const r = await sesion(tokenDeRol('SUPERADMIN'))
        expect(r.status).toBe(200)
        expect(r.body).toMatchObject({
            success: true, tipo: 'ADMIN',
            user: { id: 1, nombres: 'Test', apellidos: 'Owner', correo: 'staff1@example.com', rolId: 1, rolCodigo: 'SUPERADMIN', rolNombre: 'Owner' },
        })
        expect(r.body.user.acceso).toMatchObject({ alcance: 'GLOBAL', eventoIds: null, perfilParticipante: false })
        expect(r.body.user.acceso.permisos).toEqual(expect.arrayContaining(['sistema.configurar', 'administradores.gestionar']))
        expect(r.body.user).not.toHaveProperty('contrasenaHash')
    })

    it('el Administrador del sistema no tiene la página Sistema', async () => {
        const r = await sesion(tokenDeRol('ADMIN'))
        expect(r.body.user).toMatchObject({ rolCodigo: 'ADMIN', acceso: { alcance: 'GLOBAL', eventoIds: null } })
        expect(r.body.user.acceso.permisos).toContain('correo.configurar')
        expect(r.body.user.acceso.permisos).not.toContain('sistema.configurar')
    })

    it('usa los datos actuales de la BD, no los del JWT', async () => {
        const token = tokenDeRol('COMISION', 42, { eventoIds: [2], permisos: ['asistencia.marcar'] })
        registrarActor(42, 'COMISION', { eventoIds: [2, 3], permisos: ['asistencia.marcar', 'ponencias.ver'] })
        const r = await sesion(token)
        expect(r.status).toBe(200)
        expect(r.body.user).toMatchObject({ id: 42, correo: 'staff42@example.com', rolCodigo: 'COMISION', rolNombre: 'Comisión tecnológica' })
        expect(r.body.user.acceso).toEqual({
            alcance: 'EVENTO', eventoIds: [2, 3], permisos: ['asistencia.marcar', 'asistencia.ver', 'ponencias.ver'], perfilParticipante: false,
        })
    })

    it.each([
        ['el correo', { correo: 'otra.persona@undc.edu.pe' }],
        ['la contraseña', { contrasenaHash: '$2a$12$otroHash' }],
        ['la cuenta Google vinculada', { googleSub: 'google-sub-otro' }],
    ])('si cambió %s desde que se firmó el JWT, la sesión deja de valer (401)', async (_caso, cambio) => {
        const token = tokenDeRol('TESORERO', 45, { eventoIds: [2], contrasenaHash: '$2a$12$hashOriginal', googleSub: 'google-sub-1' })
        registrarActor(45, 'TESORERO', { eventoIds: [2], contrasenaHash: '$2a$12$hashOriginal', googleSub: 'google-sub-1', ...cambio })
        const r = await sesion(token)
        expect(r.status).toBe(401)
        expect(r.body).toMatchObject({ success: false, code: 'SESSION_INVALIDATED' })
        // La misma huella en cualquier guarda del staff
        expect((await request(app).get('/api/v1/events').set('Authorization', `Bearer ${token}`)).body.code).toBe('SESSION_INVALIDATED')
    })

    it('un JWT de staff sin huella (emitido antes de la spec 013) ya no vale', async () => {
        const fila = registrarActor(46, 'SUPERADMIN')
        const viejo = jwt.sign(
            { user: { id: 46, nombres: fila.nombres, apellidos: fila.apellidos, correo: fila.correo, rolId: 1, rolCodigo: 'SUPERADMIN', rolNombre: 'Owner' }, metodo: 'PASSWORD' },
            env.JWT_SECRET,
            { algorithm: 'HS256', expiresIn: 3600, issuer: EMISOR, audience: AUDIENCIA_ADMIN, subject: '46' },
        )
        const r = await sesion(viejo)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })

    it('perfilParticipante indica si hay un inscrito con el mismo correo', async () => {
        m.participante.findUnique.mockResolvedValue({ id: 50 })
        const r = await sesion(tokenDeRol('TESORERO', 34, { eventoIds: [2], correo: 'Ana@Gmail.com' }))
        expect(r.body.user.acceso.perfilParticipante).toBe(true)
        expect(m.participante.findUnique).toHaveBeenCalledWith({ where: { correo: 'ana@gmail.com' }, select: { id: true } })
    })

    it('una cuenta desactivada, borrada o con un rol desconocido responde 401 SESSION_INVALIDATED', async () => {
        const desactivada = await sesion(tokenDeRol('ADMIN', 35, { activo: false }))
        expect(desactivada.status).toBe(401)
        expect(desactivada.body).toMatchObject({ success: false, code: 'SESSION_INVALIDATED' })

        const borrada = tokenDeRol('ADMIN', 36)
        olvidarActor(36)
        expect((await sesion(borrada)).body.code).toBe('SESSION_INVALIDATED')

        // Un código de rol que el backend no conoce (p. ej. escrito a mano en la BD)
        const token = tokenDeRol('ADMIN', 37)
        const fila = filaActor(37, 'ADMIN')
        jest.mocked(consultarActor).mockResolvedValueOnce({ ...fila, rol: { id: 9, codigo: 'OWNER', nombre: 'Owner' } })
        const desconocido = await sesion(token)
        expect(desconocido.status).toBe(401)
        expect(desconocido.body.code).toBe('SESSION_INVALIDATED')
    })

    it('el participante recibe la misma respuesta de siempre', async () => {
        const r = await sesion(tokenDeParticipante(50, 'ana@gmail.com'))
        expect(r.status).toBe(200)
        expect(r.body).toEqual({ success: true, tipo: 'PARTICIPANTE', participante: { id: 50, nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com' } })
        expect(m.participante.findUnique).not.toHaveBeenCalled()
    })

    it('sin token responde 401', async () => {
        const r = await sesion()
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('MISSING_TOKEN')
    })
})

import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { AUDIENCIA_ADMIN, SESION_MAXIMA_SEGUNDOS } from '../../src/core/sesiones'
import { olvidarActor, registrarActor } from '../helpers/actores'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

// Renovación de la sesión del staff (spec 013). La guarda lee la cuenta del registro de `tokenDeRol`.
jest.mock('../../src/database/prisma', () => ({
    prisma: { participante: { findUnique: jest.fn() } },
}))

const m = prisma as unknown as { participante: { findUnique: jest.Mock } }
const renovar = (auth?: string) => {
    const r = request(app).post('/api/v1/auth/refresh')
    return auth ? r.set('Authorization', `Bearer ${auth}`) : r
}

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue(null)
})

describe('POST /v1/auth/refresh', () => {
    it('re-emite el JWT con los datos actuales de la cuenta y conserva el método de ingreso', async () => {
        const anterior = tokenDeRol('TESORERO', 31, { eventoIds: [2], metodo: 'GOOGLE', correo: 'tesorero@undc.edu.pe' })
        // Después de iniciar sesión cambiaron sus eventos (sus credenciales siguen iguales)
        registrarActor(31, 'TESORERO', { eventoIds: [3, 2], correo: 'tesorero@undc.edu.pe' })

        const r = await renovar(anterior)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body).toMatchObject({
            success: true,
            data: {
                jwt: expect.any(String),
                expiraEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                usuario: {
                    id: 31, correo: 'tesorero@undc.edu.pe', rolCodigo: 'TESORERO', rolNombre: 'Tesorero',
                    acceso: { alcance: 'EVENTO', eventoIds: [2, 3], perfilParticipante: false },
                },
            },
        })
        expect(r.body.data.usuario.acceso.permisos).toEqual(expect.arrayContaining(['inscripciones.validar', 'pagos.ver']))
        expect(new Date(r.body.data.expiraEn).getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000)

        const carga = jwt.decode(r.body.data.jwt) as jwt.JwtPayload
        expect(carga).toMatchObject({ aud: AUDIENCIA_ADMIN, sub: '31', metodo: 'GOOGLE', user: { id: 31, correo: 'tesorero@undc.edu.pe', rolCodigo: 'TESORERO' } })
        // El acceso no viaja en el JWT: las guardas lo leen de la BD
        expect(carga.user).not.toHaveProperty('acceso')
        // La huella y el inicio de la sesión se conservan
        const previa = jwt.decode(anterior) as jwt.JwtPayload
        expect(carga).toMatchObject({ huella: previa.huella, authTime: previa.authTime })

        // El token renovado sirve para consultar la sesión
        const sesion = await request(app).get('/api/v1/auth/session').set('Authorization', `Bearer ${r.body.data.jwt}`)
        expect(sesion.status).toBe(200)
        expect(sesion.body.user).toMatchObject({ id: 31, correo: 'tesorero@undc.edu.pe' })
    })

    it('un token con contraseña sigue siendo de contraseña', async () => {
        const r = await renovar(tokenDeRol('SUPERADMIN'))
        expect(r.status).toBe(200)
        expect((jwt.decode(r.body.data.jwt) as jwt.JwtPayload).metodo).toBe('PASSWORD')
        expect(r.body.data.usuario.acceso).toMatchObject({ alcance: 'GLOBAL', eventoIds: null })
    })

    it('informa si la persona también es inscrita', async () => {
        m.participante.findUnique.mockResolvedValue({ id: 50 })
        const r = await renovar(tokenDeRol('COMISION', 41, { eventoIds: [2], permisos: ['asistencia.marcar'], correo: 'Ana@Gmail.com' }))
        expect(r.status).toBe(200)
        expect(r.body.data.usuario.acceso).toEqual({ alcance: 'EVENTO', eventoIds: [2], permisos: ['asistencia.marcar', 'asistencia.ver'], perfilParticipante: true })
        expect(m.participante.findUnique).toHaveBeenCalledWith({ where: { correo: 'ana@gmail.com' }, select: { id: true } })
    })

    it('una cuenta desactivada o borrada no renueva: 401 SESSION_INVALIDATED', async () => {
        const desactivada = await renovar(tokenDeRol('ADMIN', 32, { activo: false }))
        expect(desactivada.status).toBe(401)
        expect(desactivada.body).toMatchObject({ success: false, code: 'SESSION_INVALIDATED' })

        const borrada = tokenDeRol('ADMIN', 33)
        olvidarActor(33)
        const r = await renovar(borrada)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })

    it('conserva el inicio de la sesión y no la renueva pasadas 12 horas (401 SESSION_EXPIRED)', async () => {
        const ahora = Math.floor(Date.now() / 1000)
        const casiDoce = await renovar(tokenDeRol('ADMIN', 34, { authTime: ahora - SESION_MAXIMA_SEGUNDOS + 60 }))
        expect(casiDoce.status).toBe(200)
        const renovado = jwt.decode(casiDoce.body.data.jwt) as jwt.JwtPayload
        expect(renovado.authTime).toBe(ahora - SESION_MAXIMA_SEGUNDOS + 60)

        const vencida = await renovar(tokenDeRol('ADMIN', 34, { authTime: ahora - SESION_MAXIMA_SEGUNDOS - 1 }))
        expect(vencida.status).toBe(401)
        expect(vencida.body).toMatchObject({ success: false, code: 'SESSION_EXPIRED' })
    })

    it('si cambiaron la contraseña, el correo o la cuenta Google no renueva (401 SESSION_INVALIDATED)', async () => {
        const token = tokenDeRol('TESORERO', 35, { eventoIds: [2], contrasenaHash: '$2a$12$hashOriginal' })
        registrarActor(35, 'TESORERO', { eventoIds: [2], contrasenaHash: '$2a$12$hashNuevo' })
        const r = await renovar(token)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })

    it('un token de participante no renueva una sesión de staff', async () => {
        const r = await renovar(tokenDeParticipante())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
    })

    it('sin token o con uno inválido responde 401', async () => {
        expect((await renovar()).body.code).toBe('MISSING_TOKEN')
        const r = await renovar(tokenDeRol('SUPERADMIN').replace(/\.[^.]+$/, '.firma-invalida'))
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('INVALID_TOKEN')
    })
})

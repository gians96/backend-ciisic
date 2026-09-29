import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { AUDIENCIA_ADMIN, AUDIENCIA_PARTICIPANTE } from '../../src/core/sesiones'
import { googleEsAutoritativo } from '../../src/api/google-auth/services/google-verifier'
import { leerVerificacionCorreo } from '../../src/api/google-auth/services/verificacion-correo'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('google-auth-library', () => {
    const verifyIdToken = jest.fn()
    return { OAuth2Client: jest.fn(() => ({ verifyIdToken })), __verifyIdToken: verifyIdToken }
})

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        configuracionSistema: { findUnique: jest.fn() },
        administrador: { findUnique: jest.fn(), update: jest.fn() },
        participante: { findUnique: jest.fn(), update: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

const verifyIdToken = (jest.requireMock('google-auth-library') as { __verifyIdToken: jest.Mock }).__verifyIdToken
const m = prisma as unknown as Record<'configuracionSistema' | 'administrador' | 'participante' | 'tokenAcceso', Record<string, jest.Mock>>
const CLIENT_ID = '1234567890-abc123.apps.googleusercontent.com'
const NONCE = 'nonce-de-prueba-0123456789'
const ID_TOKEN = 'aaa.bbb.ccc'

function ticket(payload: Record<string, unknown>) {
    return { getPayload: () => ({ sub: 'google-sub-1', email_verified: true, nonce: NONCE, given_name: 'Ana', family_name: 'Pérez', ...payload }) }
}
const admin = (cambios: Record<string, unknown> = {}) => ({
    id: 4, nombres: 'Gabriel', apellidos: 'Arias', correo: 'garias@undc.edu.pe', rolId: 1, activo: true, googleSub: null,
    rol: { id: 1, codigo: 'SUPERADMIN', nombre: 'SuperAdmin' }, ...cambios,
})
const participante = (cambios: Record<string, unknown> = {}) => ({ id: 50, nombres: 'ANA', apellidos: 'PEREZ', correo: 'ana@gmail.com', googleSub: null, ...cambios })
const login = (body: Record<string, unknown> = {}) => request(app).post('/api/v1/auth/google').send({ idToken: ID_TOKEN, nonce: NONCE, ...body })

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, googleClientId: CLIENT_ID, rutasLegacyActivas: true, undcApiTimeoutMs: 8000 })
    m.administrador.findUnique.mockResolvedValue(null)
    m.participante.findUnique.mockResolvedValue(null)
    m.administrador.update.mockResolvedValue({})
    m.participante.update.mockResolvedValue({})
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('cuentas en las que Google es autoritativo', () => {
    it('Gmail o el dominio de Workspace (hd); no correos de terceros', () => {
        expect(googleEsAutoritativo('ana@gmail.com', undefined)).toBe(true)
        expect(googleEsAutoritativo('2021003668@undc.edu.pe', 'undc.edu.pe')).toBe(true)
        expect(googleEsAutoritativo('ana@hotmail.com', undefined)).toBe(false)
        expect(googleEsAutoritativo('ana@undc.edu.pe', 'otra.edu.pe')).toBe(false)
    })
})

describe('POST /v1/auth/google (panel)', () => {
    it('503 si Google no está configurado en Sistema', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, googleClientId: null, rutasLegacyActivas: true, undcApiTimeoutMs: 8000 })
        const r = await login()
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('GOOGLE_NOT_CONFIGURED')
    })

    it('valida con la audiencia guardada y distingue token inválido de Google caído', async () => {
        verifyIdToken.mockRejectedValueOnce(new Error('Wrong recipient, payload audience != requiredAudience'))
        expect((await login()).body.code).toBe('INVALID_GOOGLE_TOKEN')
        expect(verifyIdToken).toHaveBeenCalledWith({ idToken: ID_TOKEN, audience: CLIENT_ID })
        verifyIdToken.mockRejectedValueOnce(Object.assign(new Error('request failed'), { name: 'GaxiosError' }))
        const caido = await login()
        expect(caido.status).toBe(503)
        expect(caido.body.code).toBe('GOOGLE_UNAVAILABLE')
    })

    it('exige el nonce del panel, correo verificado y cuenta autoritativa', async () => {
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'ana@gmail.com', nonce: 'otro-nonce-0123456789' }))
        expect((await login()).body.code).toBe('INVALID_GOOGLE_TOKEN')
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'ana@gmail.com', email_verified: false }))
        expect((await login()).body.code).toBe('GOOGLE_EMAIL_NOT_VERIFIED')
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'ana@hotmail.com' }))
        expect((await login()).body.code).toBe('GOOGLE_NOT_AUTHORITATIVE')
    })

    it('un administrador activo entra (también con Gmail) y se vincula su cuenta Google', async () => {
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'Admin.Ciisic@gmail.com' }))
        m.administrador.findUnique.mockResolvedValue(admin({ correo: 'admin.ciisic@gmail.com' }))
        const r = await login()
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ tipo: 'ADMIN', usuario: { id: 4, rolCodigo: 'SUPERADMIN' }, expiraEn: expect.any(String) })
        expect(m.administrador.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { correo: 'admin.ciisic@gmail.com' } }))
        expect(m.administrador.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { googleSub: 'google-sub-1', googleVinculadoEn: expect.any(Date) } })
        expect((jwt.decode(r.body.data.jwt) as jwt.JwtPayload).aud).toBe(AUDIENCIA_ADMIN)
    })

    it('rechaza otra cuenta Google para un correo ya vinculado', async () => {
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'garias@undc.edu.pe', hd: 'undc.edu.pe', sub: 'google-sub-2' }))
        m.administrador.findUnique.mockResolvedValue(admin({ googleSub: 'google-sub-1' }))
        const r = await login()
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('GOOGLE_ACCOUNT_MISMATCH')
    })

    it('un inscrito entra al portal; un admin desactivado que también se inscribió entra como participante', async () => {
        verifyIdToken.mockResolvedValue(ticket({ email: 'ana@gmail.com' }))
        m.administrador.findUnique.mockResolvedValue(admin({ correo: 'ana@gmail.com', activo: false }))
        m.participante.findUnique.mockResolvedValue(participante())
        const r = await login()
        expect(r.body.data).toMatchObject({ tipo: 'PARTICIPANTE', participante: { id: 50, correo: 'ana@gmail.com' } })
        const carga = jwt.decode(r.body.data.jwt) as jwt.JwtPayload
        expect(carga.aud).toBe(AUDIENCIA_PARTICIPANTE)
        expect(carga).not.toHaveProperty('user')

        // Con esa sesión, /v1/auth/session informa el perfil y las rutas de admin quedan cerradas
        m.participante.findUnique.mockResolvedValue({ correo: 'ana@gmail.com' })
        const sesion = await request(app).get('/api/v1/auth/session').set('Authorization', `Bearer ${r.body.data.jwt}`)
        expect(sesion.body).toMatchObject({ tipo: 'PARTICIPANTE', participante: { id: 50 } })
        expect((await request(app).get('/api/v1/events').set('Authorization', `Bearer ${r.body.data.jwt}`)).status).toBe(403)
    })

    it('una cuenta que no es admin ni inscrita recibe un mensaje claro', async () => {
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'nadie@gmail.com' }))
        const r = await login()
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('GOOGLE_ACCOUNT_NOT_REGISTERED')
    })

    it('valida el cuerpo', async () => {
        expect((await login({ nonce: 'corto' })).status).toBe(422)
        expect((await login({ idToken: 'no-es-jwt' })).status).toBe(422)
    })
})

describe('POST /v1/site/google-verification (landing)', () => {
    it('devuelve el tipo de cuenta y un token atado al evento y al correo', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, estado: 'PUBLICADO' }))
        verifyIdToken.mockResolvedValueOnce(ticket({ email: 'garias@undc.edu.pe', hd: 'undc.edu.pe', nonce: undefined }))
        const r = await request(app).post('/api/v1/site/google-verification').set('X-Api-Key', TOKEN_SITIO).send({ idToken: ID_TOKEN })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ correo: 'garias@undc.edu.pe', tipoCuenta: 'PERSONAL', esInstitucional: true, nombres: 'Ana' })
        const token = r.body.data.verificacionCorreoToken
        expect(leerVerificacionCorreo(token, { eventoId: 2, correo: 'GARIAS@undc.edu.pe' })).toMatchObject({ tipoCuenta: 'PERSONAL', hd: 'undc.edu.pe', metodo: 'GOOGLE' })
        expect(leerVerificacionCorreo(token, { eventoId: 3, correo: 'garias@undc.edu.pe' })).toBeNull()
        expect(leerVerificacionCorreo(token, { eventoId: 2, correo: 'otro@undc.edu.pe' })).toBeNull()
    })

    it('exige el token del evento', async () => {
        const r = await request(app).post('/api/v1/site/google-verification').send({ idToken: ID_TOKEN })
        expect(r.status).toBe(401)
        expect(verifyIdToken).not.toHaveBeenCalled()
    })
})

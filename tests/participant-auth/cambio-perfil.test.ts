import jwt from 'jsonwebtoken'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { AUDIENCIA_PARTICIPANTE, SESION_PARTICIPANTE_SEGUNDOS, type CargaSesion } from '../../src/core/sesiones'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn(), updateMany: jest.fn() },
    },
}))

const m = prisma as unknown as { participante: Record<string, jest.Mock> }
const CORREO = 'garias@undc.edu.pe'
const SUB = 'google-sub-staff'

const participante = (cambios: Record<string, unknown> = {}) => ({ id: 60, nombres: 'Gabriel', apellidos: 'Arias', correo: CORREO, googleSub: null as string | null, ...cambios })
const tokenGoogle = (opciones: { googleSub?: string | null, correo?: string } = {}) =>
    tokenDeRol('ADMIN', 2, { metodo: 'GOOGLE', googleSub: SUB, correo: CORREO, ...opciones })
const cambiar = (token?: string) => {
    const r = request(app).post('/api/v1/auth/participant/switch')
    return token ? r.set('Authorization', `Bearer ${token}`) : r
}

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue(participante())
    m.participante.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /v1/auth/participant/switch', () => {
    it('staff con sesión de Google → sesión de participante de 12 h (metodo GOOGLE) y vincula su cuenta Google', async () => {
        const r = await cambiar(tokenGoogle())
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data).toEqual({
            jwt: expect.any(String),
            tipo: 'PARTICIPANTE',
            participante: { id: 60, nombres: 'Gabriel', apellidos: 'Arias', correo: CORREO },
            expiraEn: expect.any(String),
        })
        const carga = jwt.decode(r.body.data.jwt) as CargaSesion
        expect(carga.aud).toBe(AUDIENCIA_PARTICIPANTE)
        expect(carga.metodo).toBe('GOOGLE')
        expect(carga.user).toBeUndefined()
        expect(Number(carga.exp) - Number(carga.iat)).toBe(SESION_PARTICIPANTE_SEGUNDOS)
        expect(m.participante.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { correo: CORREO } }))
        expect(m.participante.updateMany).toHaveBeenCalledWith({
            where: { id: 60, googleSub: null },
            data: { googleSub: SUB, googleVinculadoEn: expect.any(Date) },
        })
    })

    it('con la misma cuenta Google ya vinculada no toca el participante', async () => {
        m.participante.findUnique.mockResolvedValue(participante({ googleSub: SUB }))
        expect((await cambiar(tokenGoogle())).status).toBe(200)
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('cualquier rol de staff puede pasar a su portal (incluida la Comisión)', async () => {
        const token = tokenDeRol('COMISION', 41, { metodo: 'GOOGLE', googleSub: SUB, correo: CORREO, eventoIds: [1] })
        expect((await cambiar(token)).status).toBe(200)
    })

    it('409 CODE_REQUIRED si la sesión de staff es con contraseña', async () => {
        const r = await cambiar(tokenDeRol('ADMIN', 2, { metodo: 'PASSWORD', correo: CORREO, contrasenaHash: 'hash' }))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('CODE_REQUIRED')
        expect(m.participante.findUnique).not.toHaveBeenCalled()
    })

    it('404 PARTICIPANT_NOT_FOUND si no hay un participante con el correo de la cuenta', async () => {
        m.participante.findUnique.mockResolvedValue(null)
        const r = await cambiar(tokenGoogle())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('PARTICIPANT_NOT_FOUND')
    })

    it('403 GOOGLE_ACCOUNT_MISMATCH si el participante está vinculado a otra cuenta Google', async () => {
        m.participante.findUnique.mockResolvedValue(participante({ googleSub: 'otra-cuenta' }))
        const r = await cambiar(tokenGoogle())
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('GOOGLE_ACCOUNT_MISMATCH')
        expect(r.body.data).toBeUndefined()
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('403 GOOGLE_ACCOUNT_MISMATCH si otra petición lo vinculó en paralelo con otra cuenta', async () => {
        m.participante.updateMany.mockResolvedValue({ count: 0 })
        m.participante.findUnique.mockResolvedValueOnce(participante()).mockResolvedValueOnce({ googleSub: 'otra-cuenta' })
        const r = await cambiar(tokenGoogle())
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('GOOGLE_ACCOUNT_MISMATCH')
    })

    it('409 GOOGLE_ACCOUNT_IN_USE si su cuenta Google ya está vinculada a otro participante', async () => {
        m.participante.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }))
        const r = await cambiar(tokenGoogle())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('GOOGLE_ACCOUNT_IN_USE')
    })

    it('un token de participante no sirve (403) y sin token 401', async () => {
        const r = await cambiar(tokenDeParticipante(60, CORREO))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect((await cambiar()).status).toBe(401)
        expect(m.participante.findUnique).not.toHaveBeenCalled()
    })

    it('una cuenta de staff desactivada ya no pasa (401 SESSION_INVALIDATED)', async () => {
        const token = tokenGoogle()
        tokenDeRol('ADMIN', 2, { metodo: 'GOOGLE', googleSub: SUB, correo: CORREO, activo: false })
        const r = await cambiar(token)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })
})

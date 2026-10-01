import jwt from 'jsonwebtoken'
import {
    AUDIENCIA_ADMIN, AUDIENCIA_PARTICIPANTE, firmarSesionAdmin, firmarSesionParticipante, huellaCredenciales, SESION_PARTICIPANTE_SEGUNDOS,
    SESION_SEGUNDOS, verificarSesion,
} from '../../src/core/sesiones'

const participante = { id: 50, nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com' }
const vida = (token: string) => {
    const carga = jwt.decode(token) as jwt.JwtPayload
    return (carga.exp ?? 0) - (carga.iat ?? 0)
}

describe('duración y método de las sesiones (spec 014)', () => {
    it('la del participante dura 12 h y por defecto es de Google', () => {
        const { jwt: token, expiraEn } = firmarSesionParticipante(participante)
        const carga = verificarSesion(token)
        expect(carga).toMatchObject({ aud: AUDIENCIA_PARTICIPANTE, sub: '50', metodo: 'GOOGLE', participante })
        expect(vida(token)).toBe(SESION_PARTICIPANTE_SEGUNDOS)
        expect(SESION_PARTICIPANTE_SEGUNDOS).toBe(12 * 60 * 60)
        expect(new Date(expiraEn).getTime()).toBeGreaterThan(Date.now() + 11.9 * 60 * 60 * 1000)
    })

    it('con el código por correo lleva metodo CODIGO', () => {
        const { jwt: token } = firmarSesionParticipante(participante, 'CODIGO')
        expect(verificarSesion(token)).toMatchObject({ aud: AUDIENCIA_PARTICIPANTE, metodo: 'CODIGO' })
        expect(vida(token)).toBe(SESION_PARTICIPANTE_SEGUNDOS)
    })

    it('la del staff sigue durando 1 h', () => {
        const usuario = { id: 7, nombres: 'Eva', apellidos: 'Ruiz', correo: 'eva@undc.edu.pe', rolId: 2, rolCodigo: 'ADMIN' as const, rolNombre: 'Administrador del sistema' }
        const { jwt: token, expiraEn } = firmarSesionAdmin(usuario, { metodo: 'GOOGLE', huella: huellaCredenciales({ correo: usuario.correo }) })
        expect(verificarSesion(token)).toMatchObject({ aud: AUDIENCIA_ADMIN, metodo: 'GOOGLE' })
        expect(vida(token)).toBe(SESION_SEGUNDOS)
        expect(new Date(expiraEn).getTime()).toBeLessThanOrEqual(Date.now() + SESION_SEGUNDOS * 1000)
    })
})

import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { olvidarActor } from '../helpers/actores'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/**
 * Casos transversales de la spec 013 por HTTP: alcance por evento, sesión revalidada contra la BD y
 * permisos por rol. Las cuentas por evento de este archivo tienen asignado solo el evento 2.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn() },
        credencialCorreo: { findMany: jest.fn() },
    },
}))

const m = prisma as unknown as {
    inscripcion: { findUnique: jest.Mock, findMany: jest.Mock, count: jest.Mock }
    evento: { findUnique: jest.Mock }
    credencialCorreo: { findMany: jest.Mock }
}

const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comisionSoloMarca = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] })

function pedir(metodo: 'get' | 'post', ruta: string, token?: string) {
    const r = request(app)[metodo](`/api${ruta}`)
    return token ? r.set('Authorization', `Bearer ${token}`) : r
}

/** Una guarda que rechaza no llega a la BD. */
function sinConsultas() {
    for (const modelo of Object.values(m)) for (const fn of Object.values(modelo)) expect(fn).not.toHaveBeenCalled()
}

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => ({ id: where.id, codigo: `evento-${where.id}` }))
    m.inscripcion.findMany.mockResolvedValue([])
    m.inscripcion.count.mockResolvedValue(0)
    m.credencialCorreo.findMany.mockResolvedValue([])
})

describe('alcance por evento (cuenta asignada al evento 2)', () => {
    it('un evento que no es suyo responde 403 EVENT_NOT_ASSIGNED', async () => {
        const r = await pedir('get', '/v1/events/3/inscriptions', tesorero())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ success: false, code: 'EVENT_NOT_ASSIGNED' })
        sinConsultas()
    })

    // `idParam` convierte con Number(): «0x3», «3.0» y «03» son el 3, así que la guarda y el
    // controlador leen el mismo evento y responden 403. Lo que nunca puede pasar es un 200.
    it.each(['0x3', '3.0', '03'])('el evento 3 escrito como «%s» no da acceso', async (id) => {
        const r = await pedir('get', `/v1/events/${id}/inscriptions`, tesorero())
        expect(r.status).not.toBe(200)
        expect([[400, 'INVALID_ID'], [403, 'EVENT_NOT_ASSIGNED']]).toContainEqual([r.status, r.body.code])
        sinConsultas()
    })

    it.each(['abc', '0', '-2', '2abc', '1e400'])('un id de evento inválido («%s») responde 400', async (id) => {
        const r = await pedir('get', `/v1/events/${id}/inscriptions`, tesorero())
        expect(r.status).toBe(400)
        expect(r.body).toMatchObject({ success: false, code: 'INVALID_ID' })
        sinConsultas()
    })

    it('su propio evento escrito de otra forma («0x2») solo consulta el evento 2', async () => {
        const r = await pedir('get', '/v1/events/0x2/inscriptions', tesorero())
        expect([200, 400]).toContain(r.status)
        for (const [consulta] of m.inscripcion.findMany.mock.calls) expect(consulta.where.eventoId).toBe(2)
    })

    it('una inscripción de otro evento responde 403 y una inexistente, 404', async () => {
        m.inscripcion.findUnique.mockResolvedValueOnce({ eventoId: 3 })
        const ajena = await pedir('get', '/v1/inscriptions/7', tesorero())
        expect(ajena.status).toBe(403)
        expect(ajena.body).toMatchObject({ code: 'EVENT_NOT_ASSIGNED' })

        m.inscripcion.findUnique.mockResolvedValueOnce(null)
        const inexistente = await pedir('get', '/v1/inscriptions/999', tesorero())
        expect(inexistente.status).toBe(404)
        expect(inexistente.body).toMatchObject({ success: false, code: 'NOT_FOUND' })
        // Solo el resolutor consultó (con `select`); el controlador no se ejecutó
        expect(m.inscripcion.findUnique).toHaveBeenCalledTimes(2)
        for (const [consulta] of m.inscripcion.findUnique.mock.calls) expect(consulta).toMatchObject({ select: { eventoId: true } })
    })

    it('en su evento, con el permiso, pasa la guarda', async () => {
        const r = await pedir('get', '/v1/events/2/inscriptions', tesorero())
        expect(r.status).toBe(200)
        expect(m.inscripcion.findMany.mock.calls[0][0].where.eventoId).toBe(2)
    })
})

describe('la cuenta se revalida en cada petición', () => {
    it('una cuenta desactivada responde 401 SESSION_INVALIDATED', async () => {
        const token = tokenDeRol('TESORERO', 31, { eventoIds: [2], activo: false })
        const r = await pedir('get', '/v1/events/2/inscriptions', token)
        expect(r.status).toBe(401)
        expect(r.body).toMatchObject({ success: false, code: 'SESSION_INVALIDATED' })
        sinConsultas()
    })

    it('una cuenta borrada responde 401 SESSION_INVALIDATED aunque su token siga vigente', async () => {
        const token = tokenDeRol('TESORERO', 32, { eventoIds: [2] })
        olvidarActor(32)
        const r = await pedir('get', '/v1/events/2/inscriptions', token)
        expect(r.status).toBe(401)
        expect(r.body).toMatchObject({ success: false, code: 'SESSION_INVALIDATED' })
        sinConsultas()
    })

    it.each(['/v1/events/2/inscriptions', '/v1/admin', '/v1/events', '/v1/settings'])('un token de participante en %s responde 403', async (ruta) => {
        const r = await pedir('get', ruta, tokenDeParticipante())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        sinConsultas()
    })
})

describe('permisos por rol', () => {
    it('el Administrador del sistema no entra a Sistema pero sí a las credenciales de correo', async () => {
        const token = tokenDeRol('ADMIN')
        const sistema = await pedir('get', '/v1/settings', token)
        expect(sistema.status).toBe(403)
        expect(sistema.body).toMatchObject({ success: false, code: 'FORBIDDEN' })

        const correo = await pedir('get', '/v1/email-credentials', token)
        expect(correo.status).toBe(200)
        expect(correo.body).toEqual({ success: true, data: [] })
    })

    it.each([
        ['get', '/v1/admin'],
        ['get', '/v1/email-credentials'],
        ['get', '/v1/events/1/access-tokens'],
        ['post', '/v1/events/1/access-tokens'],
    ] as const)('el Tesorero recibe 403 en %s %s', async (metodo, ruta) => {
        const r = await pedir(metodo, ruta, tokenDeRol('TESORERO', 30, { eventoIds: [1, 2] }))
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        sinConsultas()
    })

    it.each(['/v1/events/2/inscriptions', '/v1/events/2/summary'])('la Comisión con solo «asistencia.marcar» recibe 403 en %s de su evento', async (ruta) => {
        const r = await pedir('get', ruta, comisionSoloMarca())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        sinConsultas()
    })
})

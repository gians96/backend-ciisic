import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        inscripcion: { aggregate: jest.fn(), count: jest.fn() },
        integracionEvento: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    inscripcion: { aggregate: jest.Mock, count: jest.Mock }
    integracionEvento: { findMany: jest.Mock, create: jest.Mock, update: jest.Mock, delete: jest.Mock }
}

const resumenDeportes = {
    event: { id: 3, name: 'Juegos', startDate: '2026-10-19', endDate: '2026-10-24' },
    currency: 'PEN',
    teams: { total: 10, pending: 2, approved: 7, rejected: 1, cancelled: 0 },
    participants: { total: 80 },
    payments: { validated: { count: 7, amount: 350 }, pending: { count: 2, amount: 100 }, rejected: { count: 1, amount: 50 } },
    byDiscipline: [{
        disciplineId: 1, name: 'Fútbol', participantType: 'EQUIPO', isPaid: true, cost: 50,
        teams: { total: 8, approved: 6, pending: 2 }, validatedAmount: 300, pendingAmount: 100,
    }],
    byParticipantType: [{ participantType: 'EQUIPO', teams: 8, validatedAmount: 300, pendingAmount: 100 }],
    generatedAt: '2026-10-20T00:00:00Z',
}

const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = (permisos: string[] = ['resumen.ver']) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

let fetchMock: jest.SpyInstance
beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify(resumenDeportes), { status: 200 })))
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}`, nombreCorto: 'VIII CIISIC 2026' }))
    m.inscripcion.aggregate.mockImplementation(({ _count }: { _count?: unknown }) => Promise.resolve(_count
        ? { _sum: { monto: new Prisma.Decimal(1460) }, _count: { _all: 12 } }
        : { _sum: { monto: new Prisma.Decimal(420) } }))
    m.inscripcion.count.mockResolvedValue(28)
    m.integracionEvento.findMany.mockResolvedValue([{ id: 7, nombre: 'Deportes FI', urlBase: 'https://api.deportes.test/api/v1', tokenCifrado: cifrar('dfi_token'), tipo: 'DEPORTES_FI', activo: true }])
})
afterEach(() => fetchMock.mockRestore())

describe('resumen Semana Sistémica según «pagos.ver»', () => {
    it('el Tesorero ve lo recaudado', async () => {
        const r = await request(app).get('/api/v1/events/2/integrations/sports-summary').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data.totales).toEqual({ recaudadoCongreso: 1460, recaudadoDeportes: 350, recaudadoTotal: 1810, pendienteDeportes: 100 })
        expect(r.body.data.congreso).toMatchObject({ montoAprobado: 1460, montoPendiente: 420 })
    })

    it('la Comisión con «resumen.ver» recibe los conteos y los importes en null (mismas claves)', async () => {
        const r = await request(app).get('/api/v1/events/2/integrations/sports-summary').set(con(comision()))
        expect(r.status).toBe(200)
        const { congreso, totales, deportes } = r.body.data
        expect(congreso).toEqual({ inscripcionesTotales: 28, inscripcionesAprobadas: 12, montoAprobado: null, montoPendiente: null })
        expect(totales).toEqual({ recaudadoCongreso: null, recaudadoDeportes: null, recaudadoTotal: null, pendienteDeportes: null })
        const { resumen } = deportes[0]
        expect(resumen.teams).toEqual(resumenDeportes.teams)
        expect(resumen.payments).toEqual({ validated: { count: 7, amount: null }, pending: { count: 2, amount: null }, rejected: { count: 1, amount: null } })
        expect(resumen.byDiscipline[0]).toMatchObject({ name: 'Fútbol', cost: null, validatedAmount: null, pendingAmount: null, teams: { total: 8 } })
        expect(resumen.byParticipantType[0]).toMatchObject({ teams: 8, validatedAmount: null, pendingAmount: null })
    })

    it('un campo nuevo de deportes-fi (quizá un importe) no llega a la Comisión: lista blanca', async () => {
        const conExtras = {
            ...resumenDeportes,
            totalRevenue: 999,
            payments: { ...resumenDeportes.payments, validated: { count: 7, amount: 350, fee: 5 } },
            byDiscipline: [{ ...resumenDeportes.byDiscipline[0], refundAmount: 20 }],
            byParticipantType: [{ ...resumenDeportes.byParticipantType[0], feeAmount: 3 }],
        }
        fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(conExtras), { status: 200 })))
        // Otra integración: la caché de 60 s es por integración
        m.integracionEvento.findMany.mockResolvedValue([{ id: 8, nombre: 'Deportes FI', urlBase: 'https://api.deportes.test/api/v1', tokenCifrado: cifrar('dfi_token'), tipo: 'DEPORTES_FI', activo: true }])
        const r = await request(app).get('/api/v1/events/2/integrations/sports-summary').set(con(comision()))
        expect(r.status).toBe(200)
        expect(r.body.data.deportes[0].resumen).toEqual({
            event: resumenDeportes.event,
            currency: 'PEN',
            teams: resumenDeportes.teams,
            participants: { total: 80 },
            payments: { validated: { count: 7, amount: null }, pending: { count: 2, amount: null }, rejected: { count: 1, amount: null } },
            byDiscipline: [{
                disciplineId: 1, name: 'Fútbol', participantType: 'EQUIPO', isPaid: true, cost: null,
                teams: { total: 8, approved: 6, pending: 2 }, validatedAmount: null, pendingAmount: null,
            }],
            byParticipantType: [{ participantType: 'EQUIPO', teams: 8, validatedAmount: null, pendingAmount: null }],
            generatedAt: '2026-10-20T00:00:00Z',
        })
    })

    it('otro evento o sin «resumen.ver» responde 403', async () => {
        const otro = await request(app).get('/api/v1/events/3/integrations/sports-summary').set(con(tesorero()))
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        const sinPermiso = await request(app).get('/api/v1/events/2/integrations/sports-summary').set(con(comision(['asistencia.marcar'])))
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body.code).toBe('FORBIDDEN')
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('configuración de integraciones', () => {
    it.each([
        ['get', '/api/v1/events/2/integrations'],
        ['post', '/api/v1/events/2/integrations'],
        ['put', '/api/v1/integrations/7'],
        ['delete', '/api/v1/integrations/7'],
        ['post', '/api/v1/integrations/7/test'],
    ])('%s %s responde 403 al Tesorero de ese evento', async (method, ruta) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(con(tesorero())).send({})
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.integracionEvento.create).not.toHaveBeenCalled()
        expect(m.integracionEvento.delete).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('el Administrador del sistema las lista', async () => {
        const r = await request(app).get('/api/v1/events/2/integrations').set(con(tokenDeRol('ADMIN')))
        expect(r.status).toBe(200)
        expect(r.body.data).toHaveLength(1)
    })
})

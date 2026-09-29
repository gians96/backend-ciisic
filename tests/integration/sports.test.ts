import { Prisma } from '@prisma/client'
import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { resumenSemanaSistemica } from '../../src/api/integration/services/integration'
import { validarUrlBase } from '../../src/api/integration/services/sports-client'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        inscripcion: { aggregate: jest.fn(), count: jest.fn() },
        integracionEvento: { findMany: jest.fn(), update: jest.fn() },
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }, inscripcion: { aggregate: jest.Mock, count: jest.Mock }, integracionEvento: { findMany: jest.Mock, update: jest.Mock }
}

const resumen = {
    event: { id: 3, name: 'Juegos', startDate: '2026-10-19', endDate: '2026-10-24' },
    currency: 'PEN',
    teams: { total: 10, pending: 2, approved: 7, rejected: 1, cancelled: 0 },
    participants: { total: 80 },
    payments: { validated: { count: 7, amount: 350 }, pending: { count: 2, amount: 100 }, rejected: { count: 1, amount: 50 } },
    byDiscipline: [],
    byParticipantType: [],
    generatedAt: '2026-10-20T00:00:00Z',
}

let fetchMock: jest.SpyInstance
beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch')
    m.evento.findUnique.mockResolvedValue({ id: 1, codigo: 'ciisic-viii-2026', nombreCorto: 'VIII CIISIC 2026' })
    m.inscripcion.aggregate
        .mockResolvedValueOnce({ _sum: { monto: new Prisma.Decimal(1460) }, _count: { _all: 12 } })
        .mockResolvedValueOnce({ _sum: { monto: new Prisma.Decimal(420) } })
    m.inscripcion.count.mockResolvedValue(28)
})
afterEach(() => fetchMock.mockRestore())

describe('URL base de integraciones (anti-SSRF)', () => {
    it('exige https salvo localhost fuera de producción', () => {
        expect(validarUrlBase('https://api.deportes.test/api/v1/')).toBe('https://api.deportes.test/api/v1')
        expect(validarUrlBase('http://localhost:3030/api/v1')).toBe('http://localhost:3030/api/v1')
        expect(() => validarUrlBase('http://10.0.0.5/api')).toThrow()
        expect(() => validarUrlBase('file:///etc/passwd')).toThrow()
        expect(() => validarUrlBase('no-es-url')).toThrow()
    })
})

describe('resumen Semana Sistémica', () => {
    it('suma lo aprobado del congreso y lo validado en deportes', async () => {
        m.integracionEvento.findMany.mockResolvedValue([{ id: 7, nombre: 'Deportes FI', urlBase: 'https://api.deportes.test/api/v1', tokenCifrado: cifrar('dfi_token'), tipo: 'DEPORTES_FI', activo: true }])
        fetchMock.mockResolvedValue(new Response(JSON.stringify(resumen), { status: 200 }))
        const r = await resumenSemanaSistemica(1)
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.deportes.test/api/v1/integrations/event/summary')
        expect(fetchMock.mock.calls[0][1].headers['X-Api-Key']).toBe('dfi_token')
        expect(r.totales).toEqual({ recaudadoCongreso: 1460, recaudadoDeportes: 350, recaudadoTotal: 1810, pendienteDeportes: 100 })
        expect(r.deportes[0]).toMatchObject({ ok: true, integracionId: 7 })
    })

    it('reporta el error sin romper el resumen si deportes-fi falla', async () => {
        m.integracionEvento.findMany.mockResolvedValue([{ id: 8, nombre: 'Deportes FI', urlBase: 'https://api.deportes.test/api/v1', tokenCifrado: cifrar('dfi_token'), tipo: 'DEPORTES_FI', activo: true }])
        fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
        const r = await resumenSemanaSistemica(1)
        expect(r.deportes[0]).toMatchObject({ ok: false, error: expect.stringContaining('401') })
        expect(r.totales.recaudadoTotal).toBe(1460)
        expect(m.integracionEvento.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
    })
})

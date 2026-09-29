import type { Evento } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aEventoPublico, inscripcionesAbiertas } from '../../src/api/event/services/public-event'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: { evento: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn() },
}))

const m = prisma as unknown as { evento: { findUnique: jest.Mock, findFirst: jest.Mock }, $transaction: jest.Mock }

const evento = {
    id: 1, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', descripcion: null, sede: 'Cañete',
    fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'), inscripcionesInicio: null, inscripcionesFin: null,
    inscripcionesAbiertas: true, estado: 'PUBLICADO', esPrincipal: true, dominioInstitucional: 'undc.edu.pe', correoContacto: 'congreso@undc.edu.pe',
    telefonoContacto: '+51 949 026 908', remitenteNombre: null, asuntoAprobacion: null, logoArchivo: null,
    datosPago: { titular: 'X', bancos: [], billeteras: [] }, creadoEn: new Date(), actualizadoEn: new Date(),
} as unknown as Evento

beforeEach(() => jest.clearAllMocks())

describe('ventana de inscripciones', () => {
    it('solo está abierta si el evento está publicado y dentro de fechas', () => {
        expect(inscripcionesAbiertas(evento)).toBe(true)
        expect(inscripcionesAbiertas({ ...evento, estado: 'BORRADOR' })).toBe(false)
        expect(inscripcionesAbiertas({ ...evento, inscripcionesAbiertas: false })).toBe(false)
        expect(inscripcionesAbiertas({ ...evento, inscripcionesFin: new Date('2026-01-01') }, new Date('2026-02-01'))).toBe(false)
        expect(inscripcionesAbiertas({ ...evento, inscripcionesInicio: new Date('2026-12-01') }, new Date('2026-11-01'))).toBe(false)
    })
})

describe('API pública de eventos', () => {
    it('expone el evento publicado con fechas y datos de pago', async () => {
        m.evento.findUnique.mockResolvedValue(evento)
        const response = await request(app).get('/api/v1/public/events/CIISIC-VIII-2026')
        expect(response.status).toBe(200)
        expect(response.body.data).toEqual(aEventoPublico(evento) && expect.objectContaining({
            codigo: 'ciisic-viii-2026', fechaInicio: '2026-10-26', fechaFin: '2026-10-30', inscripciones: expect.objectContaining({ abiertas: true }),
        }))
        expect(m.evento.findUnique).toHaveBeenCalledWith({ where: { codigo: 'ciisic-viii-2026' } })
    })

    it('oculta eventos en borrador', async () => {
        m.evento.findUnique.mockResolvedValue({ ...evento, estado: 'BORRADOR' })
        const response = await request(app).get('/api/v1/public/events/ciisic-viii-2026')
        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({ code: 'EVENT_NOT_FOUND' })
    })
})

describe('administración de eventos', () => {
    it('valida el código y las fechas al crear', async () => {
        const response = await request(app)
            .post('/api/v1/events')
            .set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
            .send({ codigo: 'IX CIISIC', nombre: 'IX', nombreCorto: 'IX', fechaInicio: '2027-10-30', fechaFin: '2027-10-01' })
        expect(response.status).toBe(422)
        expect(response.body.code).toBe('VALIDATION_ERROR')
    })

    it('impide repetir el código de evento', async () => {
        m.evento.findUnique.mockResolvedValue(evento)
        const response = await request(app)
            .post('/api/v1/events')
            .set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
            .send({ codigo: 'ciisic-viii-2026', nombre: 'Duplicado', nombreCorto: 'Dup', fechaInicio: '2027-10-01', fechaFin: '2027-10-05' })
        expect(response.status).toBe(409)
        expect(response.body.code).toBe('EVENT_CODE_TAKEN')
    })
})

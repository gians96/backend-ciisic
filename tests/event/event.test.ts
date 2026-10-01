import type { Evento } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aEventoPublico, inscripcionesAbiertas } from '../../src/api/event/services/public-event'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        inscripcion: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
        estadoInscripcion: { findMany: jest.fn() },
        tipoInscripcion: { findMany: jest.fn() },
        ponencia: { count: jest.fn() },
        asistencia: { count: jest.fn() },
        // Borrar el evento revisa sus certificados (spec 015)
        certificado: { count: jest.fn() },
        $transaction: jest.fn(),
    },
}))

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock, findFirst: jest.Mock, findMany: jest.Mock, create: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock }
    inscripcion: { count: jest.Mock, groupBy: jest.Mock, findMany: jest.Mock }
    estadoInscripcion: { findMany: jest.Mock }
    tipoInscripcion: { findMany: jest.Mock }
    ponencia: { count: jest.Mock }
    asistencia: { count: jest.Mock }
    $transaction: jest.Mock
}

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

describe('API del sitio: evento', () => {
    it('expone el evento del token con fechas y datos de pago', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
        const response = await request(app).get('/api/v1/site/event').set('X-Api-Key', TOKEN_SITIO)
        expect(response.status).toBe(200)
        expect(response.body.data).toEqual(aEventoPublico(evento) && expect.objectContaining({
            codigo: 'ciisic-viii-2026', fechaInicio: '2026-10-26', fechaFin: '2026-10-30', inscripciones: expect.objectContaining({ abiertas: true }),
        }))
        // El evento sale del token: no se consulta por código
        expect(m.evento.findUnique).not.toHaveBeenCalled()
    })

    it('oculta los eventos archivados', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ ...evento, estado: 'ARCHIVADO' }))
        const response = await request(app).get('/api/v1/site/event').set('X-Api-Key', TOKEN_SITIO)
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

// ─── Roles y permisos (spec 013) ────────────────────────────────────────────

const credencialCorreo = { id: 9, nombre: 'Brevo congreso', remitenteCorreo: 'congreso@undc.edu.pe' }
const eventoDe = (id: number) => ({ ...evento, id, codigo: `evento-${id}`, esPrincipal: id === 2, credencialCorreoId: 9, credencialCorreo, _count: { inscripciones: 4 } })
const eventos = [eventoDe(3), eventoDe(2), eventoDe(1)]

/** Simula el filtro por ids de la BD para comprobar que la lista sale acotada a los eventos del actor. */
function simularEventos() {
    m.evento.findMany.mockImplementation(({ where }: { where?: { id?: { in: number[] } } }) =>
        Promise.resolve(eventos.filter((e) => !where?.id || where.id.in.includes(e.id))))
    m.evento.findUnique.mockImplementation(({ where }: { where: { id?: number } }) => Promise.resolve(eventos.find((e) => e.id === where.id) ?? null))
}

const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = (permisos: string[] = ['resumen.ver']) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })

describe('lista de eventos según el actor', () => {
    beforeEach(simularEventos)

    it('quien configura eventos recibe la vista completa de todos (sin cambios para el panel)', async () => {
        const r = await request(app).get('/api/v1/events').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(r.status).toBe(200)
        expect(r.body.data.map((e: { id: number }) => e.id)).toEqual([3, 2, 1])
        expect(r.body.data[0]).toMatchObject({ credencialCorreo, credencialCorreoId: 9, dominioInstitucional: 'undc.edu.pe', totalInscripciones: 4 })
    })

    it('el Tesorero solo ve su evento, sin configuración ni credencial de correo y con los datos de pago', async () => {
        const r = await request(app).get('/api/v1/events').set('Authorization', `Bearer ${tesorero()}`)
        expect(r.status).toBe(200)
        expect(m.evento.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [2] } }, orderBy: [{ fechaInicio: 'desc' }, { id: 'desc' }] }))
        expect(r.body.data).toHaveLength(1)
        const [visto] = r.body.data
        expect(Object.keys(visto)).toEqual([
            'id', 'codigo', 'nombre', 'nombreCorto', 'sede', 'fechaInicio', 'fechaFin', 'estado', 'esPrincipal',
            'inscripcionesAbiertas', 'inscripcionesInicio', 'inscripcionesFin', 'logoArchivo', 'datosPago',
        ])
        expect(visto).toMatchObject({ id: 2, nombreCorto: 'VIII CIISIC 2026', fechaInicio: '2026-10-26', esPrincipal: true, datosPago: evento.datosPago })
        for (const campo of ['credencialCorreo', 'credencialCorreoId', 'dominioInstitucional', 'remitenteNombre', 'asuntoAprobacion', 'totalInscripciones']) {
            expect(visto).not.toHaveProperty(campo)
        }
    })

    it('la Comisión sin «pagos.ver» no recibe los datos de pago', async () => {
        const r = await request(app).get('/api/v1/events').set('Authorization', `Bearer ${comision(['asistencia.marcar'])}`)
        expect(r.status).toBe(200)
        expect(r.body.data.map((e: { id: number }) => e.id)).toEqual([2])
        expect(r.body.data[0]).not.toHaveProperty('datosPago')
        expect(r.body.data[0]).not.toHaveProperty('credencialCorreo')
    })

    it('una cuenta por evento sin eventos asignados recibe una lista vacía', async () => {
        const r = await request(app).get('/api/v1/events').set('Authorization', `Bearer ${tokenDeRol('COMISION', 41, { permisos: ['asistencia.marcar'] })}`)
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual([])
    })
})

describe('resumen del evento', () => {
    beforeEach(() => {
        simularEventos()
        m.estadoInscripcion.findMany.mockResolvedValue([
            { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' },
            { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' },
        ])
        m.inscripcion.groupBy.mockImplementation(({ by }: { by: string[] }) => Promise.resolve(by.length === 1
            ? [{ estadoId: 1, _count: { _all: 2 }, _sum: { monto: 240 } }, { estadoId: 2, _count: { _all: 3 }, _sum: { monto: 360 } }]
            : [{ tipoInscripcionId: 7, estadoId: 2, _count: { _all: 3 }, _sum: { monto: 360 } }]))
        m.tipoInscripcion.findMany.mockResolvedValue([{ id: 7, nombre: 'General', etiqueta: null, categoria: { codigo: 'PUBLICO_GENERAL' } }])
        m.inscripcion.findMany.mockResolvedValue([{ creadoEn: new Date('2026-09-20T15:00:00Z') }])
        m.inscripcion.count.mockResolvedValue(1)
    })

    it('el Tesorero ve los montos', async () => {
        const r = await request(app).get('/api/v1/events/2/summary').set('Authorization', `Bearer ${tesorero()}`)
        expect(r.status).toBe(200)
        expect(r.body.data.totales).toMatchObject({ aprobadas: 3, pendientes: 2, montoAprobado: 360, montoPendiente: 240 })
        expect(r.body.data.porEstado).toContainEqual({ codigo: 'APROBADO', nombre: 'Aprobado', total: 3, monto: 360 })
        expect(r.body.data.porTipo[0]).toMatchObject({ aprobadas: 3, montoAprobado: 360 })
    })

    it('la Comisión con «resumen.ver» recibe los conteos y los montos en null (mismas claves)', async () => {
        const r = await request(app).get('/api/v1/events/2/summary').set('Authorization', `Bearer ${comision()}`)
        expect(r.status).toBe(200)
        expect(r.body.data.totales).toMatchObject({ aprobadas: 3, pendientes: 2, montoAprobado: null, montoPendiente: null })
        expect(r.body.data.porEstado).toContainEqual({ codigo: 'APROBADO', nombre: 'Aprobado', total: 3, monto: null })
        expect(r.body.data.porTipo[0]).toMatchObject({ aprobadas: 3, montoAprobado: null })
    })

    it('una cuenta por evento no ve el resumen de otro evento ni sin el permiso', async () => {
        const otro = await request(app).get('/api/v1/events/3/summary').set('Authorization', `Bearer ${tesorero()}`)
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        const sinPermiso = await request(app).get('/api/v1/events/2/summary').set('Authorization', `Bearer ${comision(['asistencia.marcar'])}`)
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body.code).toBe('FORBIDDEN')
    })
})

describe('configuración de eventos', () => {
    beforeEach(simularEventos)

    it.each([
        ['post', '/api/v1/events'],
        ['get', '/api/v1/events/2'],
        ['put', '/api/v1/events/2'],
        ['delete', '/api/v1/events/2'],
    ])('%s %s responde 403 al Tesorero de ese evento', async (method, path) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
            .set('Authorization', `Bearer ${tesorero()}`).send({})
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.evento.create).not.toHaveBeenCalled()
    })

    it('el Administrador del sistema puede eliminar eventos (pasa la guarda y aplica las reglas del borrado)', async () => {
        m.inscripcion.count.mockResolvedValue(4)
        m.ponencia.count.mockResolvedValue(0)
        m.asistencia.count.mockResolvedValue(0)
        const r = await request(app).delete('/api/v1/events/1').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EVENT_HAS_INSCRIPTIONS')
        expect(m.inscripcion.count).toHaveBeenCalledWith({ where: { eventoId: 1 } })
    })
})

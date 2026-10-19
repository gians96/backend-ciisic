import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const tx = {
        evento: { updateMany: jest.fn(), create: jest.fn() },
        categoriaInscripcion: { create: jest.fn() },
        tipoInscripcion: { createMany: jest.fn() },
    }
    return {
        prisma: {
            evento: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
            inscripcion: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
            estadoInscripcion: { findMany: jest.fn() },
            tipoInscripcion: { findMany: jest.fn() },
            $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
            tx,
        },
    }
})

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock, findUniqueOrThrow: jest.Mock }
    inscripcion: { count: jest.Mock, groupBy: jest.Mock, findMany: jest.Mock }
    estadoInscripcion: { findMany: jest.Mock }
    tipoInscripcion: { findMany: jest.Mock }
    tx: {
        evento: { updateMany: jest.Mock, create: jest.Mock }
        categoriaInscripcion: { create: jest.Mock }
        tipoInscripcion: { createMany: jest.Mock }
    }
}

const evento = (id: number, extra: Record<string, unknown> = {}) => ({
    id, codigo: `evento-${id}`, nombre: 'Congreso', nombreCorto: 'CIISIC', descripcion: null, sede: 'Cañete',
    fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'), inscripcionesInicio: null, inscripcionesFin: null,
    inscripcionesAbiertas: true, estado: 'PUBLICADO', esPrincipal: false, dominioInstitucional: 'undc.edu.pe', correoContacto: null,
    telefonoContacto: null, remitenteNombre: null, asuntoAprobacion: null, logoArchivo: null, datosPago: null, credencialCorreoId: null,
    creadoEn: new Date(), actualizadoEn: new Date(), ...extra,
})

const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const tesorero = () => ({ Authorization: `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}` })

beforeEach(() => jest.clearAllMocks())

describe('crear un evento copiando otro (spec 018)', () => {
    const tipo = (id: number, codigo: string, extra: Record<string, unknown> = {}) => ({
        id, categoriaId: 1, codigo, nombre: 'TIPO', etiqueta: null, descripcion: null, caracteristicas: null,
        precio: new Prisma.Decimal(50), precioInstitucional: new Prisma.Decimal(50), disponiblePara: 'TODOS', modalidad: 'PRESENCIAL', activo: true, orden: 1, ...extra,
    })
    const origen = evento(1, {
        categorias: [{
            id: 1, eventoId: 1, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', descripcion: null, caracteristicas: null, precioDesde: null, esEstudiantil: false, orden: 1,
            tipos: [
                tipo(10, 'general_sin_kit', { precio: new Prisma.Decimal(80), precioInstitucional: new Prisma.Decimal(60), disponiblePara: 'EXTERNOS' }),
                tipo(11, 'general_virtual', { etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', orden: 3 }),
            ],
        }],
    })

    beforeEach(() => {
        m.evento.findUnique.mockImplementation(({ where }: { where: { id?: number, codigo?: string } }) =>
            Promise.resolve(where.id === 1 ? origen : where.id === 5 ? evento(5, { _count: {} }) : null))
        m.evento.findUniqueOrThrow.mockResolvedValue(evento(5))
        m.inscripcion.count.mockResolvedValue(0)
        m.tx.evento.create.mockResolvedValue(evento(5))
        m.tx.categoriaInscripcion.create.mockResolvedValue({ id: 50 })
        m.tx.tipoInscripcion.createMany.mockResolvedValue({ count: 2 })
    })

    it('cada tipo copia su modalidad (y su disponibilidad): un virtual no vuelve a PRESENCIAL', async () => {
        const r = await request(app).post('/api/v1/events').set(admin())
            .send({ codigo: 'ciisic-ix-2027', nombre: 'IX Congreso', nombreCorto: 'IX CIISIC', fechaInicio: '2027-10-26', fechaFin: '2027-10-30', copiarDeEventoId: 1 })
        expect(r.status).toBe(201)
        expect(m.tx.categoriaInscripcion.create).toHaveBeenCalledTimes(1)
        const { data } = m.tx.tipoInscripcion.createMany.mock.calls[0][0]
        expect(data).toHaveLength(2)
        expect(data[0]).toMatchObject({ categoriaId: 50, codigo: 'general_sin_kit', modalidad: 'PRESENCIAL', disponiblePara: 'EXTERNOS' })
        expect(data[1]).toMatchObject({ categoriaId: 50, codigo: 'general_virtual', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', disponiblePara: 'TODOS', activo: true, orden: 3 })
        expect(Number(data[1].precio)).toBe(50)
        expect(Number(data[1].precioInstitucional)).toBe(50)
    })

    it('sin copiar no se crean categorías ni tipos', async () => {
        const r = await request(app).post('/api/v1/events').set(admin())
            .send({ codigo: 'ciisic-x-2028', nombre: 'X Congreso', nombreCorto: 'X CIISIC', fechaInicio: '2028-10-26', fechaFin: '2028-10-30' })
        expect(r.status).toBe(201)
        expect(m.tx.categoriaInscripcion.create).not.toHaveBeenCalled()
        expect(m.tx.tipoInscripcion.createMany).not.toHaveBeenCalled()
    })
})

describe('resumen del evento por modalidad de asistencia (spec 018)', () => {
    const tipos = [
        { id: 7, nombre: 'PROFESIONALES', etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL', categoria: { codigo: 'PUBLICO_GENERAL' } },
        { id: 8, nombre: 'ESTUDIANTES', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', categoria: { codigo: 'ESTUDIANTES' } },
        { id: 9, nombre: 'PROFESIONALES', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', categoria: { codigo: 'PUBLICO_GENERAL' } },
    ]
    // Por tipo y estado (1 PENDIENTE, 2 APROBADO). La última fila es una cortesía sin tipo, aprobada
    const porTipo = [
        { tipoInscripcionId: 7, estadoId: 2, _count: { _all: 10 }, _sum: { monto: 800 } },
        { tipoInscripcionId: 7, estadoId: 1, _count: { _all: 2 }, _sum: { monto: 160 } },
        { tipoInscripcionId: 8, estadoId: 2, _count: { _all: 4 }, _sum: { monto: 120 } },
        { tipoInscripcionId: 8, estadoId: 1, _count: { _all: 1 }, _sum: { monto: 30 } },
        { tipoInscripcionId: 9, estadoId: 2, _count: { _all: 2 }, _sum: { monto: 100 } },
        { tipoInscripcionId: null, estadoId: 2, _count: { _all: 3 }, _sum: { monto: 0 } },
    ]

    beforeEach(() => {
        m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(evento(where.id)))
        m.estadoInscripcion.findMany.mockResolvedValue([{ id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' }, { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' }])
        m.inscripcion.groupBy.mockImplementation(({ by }: { by: string[] }) => Promise.resolve(by.length === 1
            ? [{ estadoId: 1, _count: { _all: 3 }, _sum: { monto: 190 } }, { estadoId: 2, _count: { _all: 19 }, _sum: { monto: 1020 } }]
            : porTipo))
        m.tipoInscripcion.findMany.mockResolvedValue(tipos)
        m.inscripcion.findMany.mockResolvedValue(porTipo.flatMap((fila) => Array.from({ length: fila._count._all }, () => ({ creadoEn: new Date('2026-09-20T15:00:00Z') }))))
        m.inscripcion.count.mockResolvedValue(0)
    })

    it('porTipo[].modalidad y totales.porModalidad separan presencial y virtual; sin tipo cuenta como presencial', async () => {
        const r = await request(app).get('/api/v1/events/2/summary').set(admin())
        expect(r.status).toBe(200)
        expect(r.body.data.porTipo.map((t: { tipoInscripcionId: number, modalidad: string }) => [t.tipoInscripcionId, t.modalidad])).toEqual([[7, 'PRESENCIAL'], [8, 'VIRTUAL'], [9, 'VIRTUAL']])
        expect(r.body.data.totales.porModalidad).toEqual([
            { modalidad: 'PRESENCIAL', inscripciones: 15, aprobadas: 13, montoAprobado: 800 },
            { modalidad: 'VIRTUAL', inscripciones: 7, aprobadas: 6, montoAprobado: 220 },
        ])
        // Las dos modalidades suman el total de inscripciones del evento
        const { porModalidad, inscripciones } = r.body.data.totales
        expect(porModalidad.reduce((suma: number, fila: { inscripciones: number }) => suma + fila.inscripciones, 0)).toBe(inscripciones)
    })

    it('sin «pagos.ver» los montos de porModalidad van en null y los conteos se conservan', async () => {
        const comision = { Authorization: `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['resumen.ver'] })}` }
        const r = await request(app).get('/api/v1/events/2/summary').set(comision)
        expect(r.status).toBe(200)
        expect(r.body.data.totales.porModalidad).toEqual([
            { modalidad: 'PRESENCIAL', inscripciones: 15, aprobadas: 13, montoAprobado: null },
            { modalidad: 'VIRTUAL', inscripciones: 7, aprobadas: 6, montoAprobado: null },
        ])
        expect(JSON.stringify(r.body.data)).not.toMatch(/"montoAprobado":[1-9]/)
    })

    it('un evento sin tipos virtuales trae las dos modalidades (VIRTUAL en cero)', async () => {
        m.tipoInscripcion.findMany.mockResolvedValue([tipos[0]])
        m.inscripcion.groupBy.mockImplementation(({ by }: { by: string[] }) => Promise.resolve(by.length === 1 ? [] : [porTipo[0]]))
        m.inscripcion.findMany.mockResolvedValue([])
        const r = await request(app).get('/api/v1/events/2/summary').set(tesorero())
        expect(r.body.data.totales.porModalidad).toEqual([
            { modalidad: 'PRESENCIAL', inscripciones: 10, aprobadas: 10, montoAprobado: 800 },
            { modalidad: 'VIRTUAL', inscripciones: 0, aprobadas: 0, montoAprobado: 0 },
        ])
    })
})

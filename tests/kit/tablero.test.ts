import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { groupBy: jest.fn(), findMany: jest.fn() },
        tipoInscripcion: { findMany: jest.fn() },
        estadoInscripcion: { findMany: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    inscripcion: { groupBy: Mock, findMany: Mock }
    tipoInscripcion: { findMany: Mock }
    estadoInscripcion: { findMany: Mock }
    evento: { findUnique: Mock, findFirst: Mock }
}

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', esPrincipal: true, estado: 'PUBLICADO' }

const ESTADOS = [
    { id: 1, codigo: 'PENDIENTE' }, { id: 2, codigo: 'APROBADO' }, { id: 3, codigo: 'RECHAZADO' }, { id: 4, codigo: 'EN_REVISION' }, { id: 5, codigo: 'CANCELADO' },
]

const categoria = (codigo: string, nombre: string, orden: number, delegacionId: number | null = null) => ({ codigo, nombre, orden, delegacionId })
const ESTUDIANTES = categoria('ESTUDIANTES', 'ESTUDIANTES', 1)
const DELEGACION_UNAT = categoria('DELEGACION_2', 'UNAT · Ingeniería Industrial', 1002, 2)

/** Tipos del evento; el orden en que llegan no importa: el tablero los ordena por categoría y tipo. */
const TIPOS = [
    { id: 21, nombre: 'DELEGACION UNAT', etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL', incluyeKit: false, orden: 2, categoria: DELEGACION_UNAT },
    { id: 20, nombre: 'DELEGACION UNAT', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL', incluyeKit: true, orden: 1, categoria: DELEGACION_UNAT },
    { id: 11, nombre: 'ESTUDIANTES', etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL', incluyeKit: false, orden: 2, categoria: ESTUDIANTES },
    { id: 10, nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL', incluyeKit: true, orden: 1, categoria: ESTUDIANTES },
    // Un tipo virtual nunca entrega kit, aunque alguien le dejara la bandera encendida
    { id: 12, nombre: 'ESTUDIANTES', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', incluyeKit: true, orden: 3, categoria: ESTUDIANTES },
]

const grupo = (tipoInscripcionId: number | null, estadoId: number, total: number, entregados: number) => ({ tipoInscripcionId, estadoId, _count: { _all: total, kitEntregadoEn: entregados } })

const GRUPOS = [
    // ESTUDIANTES · CON KIT: 40 aprobados (30 con kit entregado), 5 pendientes y 3 en revisión de pago, 2 cancelados (a uno ya se le había entregado)
    grupo(10, 2, 40, 30), grupo(10, 1, 5, 0), grupo(10, 4, 3, 0), grupo(10, 5, 2, 1),
    // Un SIN KIT al que se le entregó el kit por error
    grupo(11, 2, 1, 1),
    // Un virtual con la bandera encendida: aprobado, sin entrega (no cuenta)
    grupo(12, 2, 7, 0),
    // Delegación: 10 aprobados con kit, 4 ya entregados
    grupo(20, 2, 10, 4),
    // Cortesía sin tipo con un kit entregado
    grupo(null, 2, 1, 1),
]

const ROSA = { id: 41, nombres: 'Rosa', apellidos: 'Quispe' }
const LUIS = { id: 42, nombres: 'Luis', apellidos: 'Mamani' }
const ENTREGAS = [
    // 09:05 y 09:50 en Lima (UTC-5)
    { kitEntregadoEn: new Date('2026-10-27T14:05:00.000Z'), kitEntregadoPor: ROSA },
    { kitEntregadoEn: new Date('2026-10-27T14:50:00.000Z'), kitEntregadoPor: ROSA },
    { kitEntregadoEn: new Date('2026-10-27T15:40:00.000Z'), kitEntregadoPor: ROSA },
    // 01:30 UTC del 28 = 20:30 del 27 en Lima: pertenece al día 27
    { kitEntregadoEn: new Date('2026-10-28T01:30:00.000Z'), kitEntregadoPor: LUIS },
    // Quien lo entregó ya no tiene cuenta
    { kitEntregadoEn: new Date('2026-10-28T14:00:00.000Z'), kitEntregadoPor: null },
]

const tesorero = () => ({ Authorization: `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}` })
const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN', 2)}` })
const comisionSoloVer = () => ({ Authorization: `Bearer ${tokenDeRol('COMISION', 45, { eventoIds: [2], permisos: ['asistencia.ver'] })}` })
const comisionOtroEvento = () => ({ Authorization: `Bearer ${tokenDeRol('COMISION', 46, { eventoIds: [3], permisos: ['asistencia.ver'] })}` })
const comisionSinVer = () => ({ Authorization: `Bearer ${tokenDeRol('COMISION', 47, { eventoIds: [2], permisos: ['mensajes.ver'] })}` })
const tablero = (eventoId: number, cabeceras: Record<string, string>) => request(app).get(`/api/v1/events/${eventoId}/kits/dashboard`).set(cabeceras)

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 ? evento : null))
    m.inscripcion.groupBy.mockResolvedValue(GRUPOS)
    m.inscripcion.findMany.mockResolvedValue(ENTREGAS)
    m.tipoInscripcion.findMany.mockResolvedValue(TIPOS)
    m.estadoInscripcion.findMany.mockResolvedValue(ESTADOS)
})

describe('tablero de kits del evento (spec 045)', () => {
    it('totales: las mismas reglas que el resumen de la puerta, más lo que viene y lo que hay que revisar', async () => {
        const r = await tablero(2, tesorero())
        expect(r.status).toBe(200)
        // A entregar: 40 (estudiantes) + 10 (delegación) aprobados con kit; entregados 30 + 4. El virtual y el sin kit no cuentan.
        // Por aprobar: 5 pendientes + 3 en revisión. A revisar: 1 cancelado con kit entregado + 1 sin kit + 1 cortesía sin tipo.
        expect(r.body.data.totales).toEqual({ conKit: 50, entregados: 34, pendientes: 16, porAprobar: 8, aRevisar: 3 })
    })

    it('por tipo: en el orden de la categoría y el tipo, con la delegación y la cortesía sin tipo al final', async () => {
        const r = await tablero(2, tesorero())
        expect(r.body.data.porTipo).toEqual([
            {
                tipoInscripcionId: 10, nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', categoria: { codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES' }, delegacionId: null,
                conKit: 40, entregados: 30, pendientes: 10, porAprobar: 8, aRevisar: 1,
            },
            {
                tipoInscripcionId: 11, nombre: 'ESTUDIANTES', etiqueta: 'SIN KIT', categoria: { codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES' }, delegacionId: null,
                conKit: 0, entregados: 0, pendientes: 0, porAprobar: 0, aRevisar: 1,
            },
            {
                tipoInscripcionId: 20, nombre: 'DELEGACION UNAT', etiqueta: 'CON KIT', categoria: { codigo: 'DELEGACION_2', nombre: 'UNAT · Ingeniería Industrial' }, delegacionId: 2,
                conKit: 10, entregados: 4, pendientes: 6, porAprobar: 0, aRevisar: 0,
            },
            {
                tipoInscripcionId: null, nombre: 'Sin tipo (cortesía)', etiqueta: null, categoria: null, delegacionId: null,
                conKit: 0, entregados: 0, pendientes: 0, porAprobar: 0, aRevisar: 1,
            },
        ])
        // El virtual aprobado sin entrega no tiene ninguna cifra: no sale
        expect(r.body.data.porTipo.map((fila: { tipoInscripcionId: number | null }) => fila.tipoInscripcionId)).not.toContain(12)
    })

    it('entregas por día y hora de Lima (el día cambia a medianoche de Lima, no de UTC)', async () => {
        const r = await tablero(2, tesorero())
        expect(r.body.data.entregas).toEqual([
            { fecha: '2026-10-27', hora: 9, total: 2 },
            { fecha: '2026-10-27', hora: 10, total: 1 },
            { fecha: '2026-10-27', hora: 20, total: 1 },
            { fecha: '2026-10-28', hora: 9, total: 1 },
        ])
    })

    it('quién entrega: el que más, primero; una cuenta eliminada sale sin nombre', async () => {
        const r = await tablero(2, tesorero())
        expect(r.body.data.porPersona).toEqual([
            { id: 41, nombres: 'Rosa', apellidos: 'Quispe', total: 3, ultimaEn: '2026-10-27T15:40:00.000Z' },
            { id: null, nombres: null, apellidos: null, total: 1, ultimaEn: '2026-10-28T14:00:00.000Z' },
            { id: 42, nombres: 'Luis', apellidos: 'Mamani', total: 1, ultimaEn: '2026-10-28T01:30:00.000Z' },
        ])
    })

    it('solo lleva cifras y nombres de quien entrega: ningún dato de los inscritos', async () => {
        const r = await tablero(2, tesorero())
        expect(Object.keys(r.body.data).sort()).toEqual(['entregas', 'porPersona', 'porTipo', 'totales'])
        const texto = JSON.stringify(r.body.data)
        for (const dato of ['numeroDocumento', 'correo', 'celular', 'participante']) expect(texto).not.toContain(dato)
    })

    it('agrupa por tipo y estado solo lo que corresponde al kit o ya se entregó, y lee solo las entregas del evento', async () => {
        await tablero(2, tesorero())
        expect(m.inscripcion.groupBy).toHaveBeenCalledWith({
            by: ['tipoInscripcionId', 'estadoId'],
            where: { eventoId: 2, OR: [{ tipoInscripcion: { incluyeKit: true, modalidad: 'PRESENCIAL' } }, { kitEntregadoEn: { not: null } }] },
            _count: { _all: true, kitEntregadoEn: true },
        })
        expect(m.inscripcion.findMany.mock.calls[0][0].where).toEqual({ eventoId: 2, kitEntregadoEn: { not: null } })
        expect(m.tipoInscripcion.findMany.mock.calls[0][0].where).toEqual({ categoria: { eventoId: 2 } })
    })

    it('un evento sin kits devuelve todo en cero y vacío', async () => {
        m.inscripcion.groupBy.mockResolvedValue([])
        m.inscripcion.findMany.mockResolvedValue([])
        const r = await tablero(2, tesorero())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ totales: { conKit: 0, entregados: 0, pendientes: 0, porAprobar: 0, aRevisar: 0 }, porTipo: [], entregas: [], porPersona: [] })
    })

    it('los pendientes nunca son negativos', async () => {
        // Más entregas que kits a entregar no puede pasar con las reglas actuales, pero el tablero no debe mostrar un negativo
        m.inscripcion.groupBy.mockResolvedValue([grupo(10, 2, 3, 5)])
        const r = await tablero(2, tesorero())
        expect(r.body.data.totales.pendientes).toBe(0)
        expect(r.body.data.porTipo[0].pendientes).toBe(0)
    })
})

describe('quién puede ver el tablero (spec 045)', () => {
    it('lo ve quien ve la asistencia (el Tesorero, la Comisión con asistencia.ver y las cuentas globales)', async () => {
        for (const cabeceras of [tesorero(), comisionSoloVer(), admin()]) expect((await tablero(2, cabeceras)).status).toBe(200)
    })

    it('sin asistencia.ver o de otro evento no; sin sesión, 401', async () => {
        expect((await tablero(2, comisionSinVer())).status).toBe(403)
        const otroEvento = await tablero(2, comisionOtroEvento())
        expect(otroEvento.status).toBe(403)
        expect(otroEvento.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect((await request(app).get('/api/v1/events/2/kits/dashboard')).status).toBe(401)
        expect(m.inscripcion.groupBy).not.toHaveBeenCalled()
    })

    it('un evento que no existe responde 404 para una cuenta global y un id inválido, 400', async () => {
        expect((await tablero(999, admin())).status).toBe(404)
        expect((await request(app).get('/api/v1/events/abc/kits/dashboard').set(admin())).status).toBe(400)
    })
})

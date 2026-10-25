import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { REGEX_TOKEN } from '../../src/api/advisory/services/enlaces'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO, registroDeToken } from '../helpers/sitio'
import { reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

/** Enlace público del aforo de las ponencias especializadas (spec 036). */
jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return {
        prisma: {
            ...cliente,
            __bd: bd,
            evento: { findUnique: jest.fn() },
            tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
            enlaceAforoPonencias: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
        },
    }
})

interface FilaEnlace { id: number, eventoId: number, token: string, creadoEn: Date, ultimoAcceso: Date | null }

const m = prisma as unknown as {
    __bd: EstadoBd
    evento: { findUnique: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock, update: jest.Mock }
    enlaceAforoPonencias: { findUnique: jest.Mock, upsert: jest.Mock, update: jest.Mock, deleteMany: jest.Mock }
}

const EVENTO = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC', estado: 'PUBLICADO', ponenciasAccesoLibre: false }
const owner = () => tokenDeRol('SUPERADMIN', 1)
const admin = () => tokenDeRol('ADMIN', 2)
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['especializadas.ver', 'especializadas.inscribir'] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const sitio = { 'X-Api-Key': TOKEN_SITIO }
const RUTA = '/api/v1/events/2/specialized-talks/occupancy-link'
const AFORO = '/api/v1/site/specialized-talk-occupancy'

const TOKEN = 'A'.repeat(43)
let enlaces: FilaEnlace[]

beforeEach(() => {
    reiniciar(m.__bd)
    jest.clearAllMocks()
    enlaces = []
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 || where.id === 3 ? { ...EVENTO, id: where.id } : null))
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(EVENTO))
    m.tokenAcceso.update.mockResolvedValue({})
    const buscar = (where: { eventoId?: number, token?: string, id?: number }) => enlaces.find((e) =>
        (where.eventoId === undefined || e.eventoId === where.eventoId) && (where.token === undefined || e.token === where.token) && (where.id === undefined || e.id === where.id))
    m.enlaceAforoPonencias.findUnique.mockImplementation(({ where }: { where: { eventoId?: number, token?: string } }) => Promise.resolve(buscar(where) ? { ...buscar(where) } : null))
    m.enlaceAforoPonencias.upsert.mockImplementation(({ where, create, update }: { where: { eventoId: number }, create: Partial<FilaEnlace>, update: Partial<FilaEnlace> }) => {
        const existente = buscar(where)
        if (existente) Object.assign(existente, update)
        else enlaces.push({ id: enlaces.length + 1, creadoEn: new Date(), ultimoAcceso: null, ...create } as FilaEnlace)
        return Promise.resolve({})
    })
    m.enlaceAforoPonencias.update.mockImplementation(({ where, data }: { where: { id: number }, data: Partial<FilaEnlace> }) => {
        Object.assign(buscar(where) ?? {}, data)
        return Promise.resolve({})
    })
    m.enlaceAforoPonencias.deleteMany.mockImplementation(({ where }: { where: { eventoId: number } }) => {
        const antes = enlaces.length
        enlaces = enlaces.filter((e) => e.eventoId !== where.eventoId)
        return Promise.resolve({ count: antes - enlaces.length })
    })
})

describe('administración del enlace (solo el Owner)', () => {
    it('el Owner lo crea, lo vuelve a pedir sin cambiarlo, lo renueva y lo desactiva', async () => {
        const vacio = await request(app).get(RUTA).set(con(owner()))
        expect(vacio.status).toBe(200)
        expect(vacio.body.data).toEqual({ token: null, creadoEn: null, ultimoAcceso: null })

        const creado = await request(app).post(RUTA).set(con(owner())).send({})
        expect(creado.status).toBe(201)
        expect(creado.headers['cache-control']).toBe('no-store')
        const token = creado.body.data.token as string
        expect(token).toMatch(REGEX_TOKEN)

        const otraVez = await request(app).post(RUTA).set(con(owner())).send({})
        expect(otraVez.body.data.token).toBe(token)

        const renovado = await request(app).post(RUTA).set(con(owner())).send({ regenerar: true })
        expect(renovado.status).toBe(201)
        expect(renovado.body.data.token).toMatch(REGEX_TOKEN)
        expect(renovado.body.data.token).not.toBe(token)
        expect((await request(app).get(AFORO).set({ ...sitio, 'X-Link-Token': token })).status).toBe(404)

        const quitado = await request(app).delete(RUTA).set(con(owner()))
        expect(quitado.status).toBe(200)
        expect(quitado.body.data.token).toBeNull()
        expect(enlaces).toHaveLength(0)
    })

    it.each([['el Administrador del sistema', admin], ['el Tesorero', tesorero], ['la Comisión', comision]])('%s no lo ve, ni lo crea, ni lo desactiva', async (_quien, token) => {
        expect((await request(app).get(RUTA).set(con(token()))).status).toBe(403)
        expect((await request(app).post(RUTA).set(con(token())).send({})).status).toBe(403)
        expect((await request(app).delete(RUTA).set(con(token()))).status).toBe(403)
        expect(m.enlaceAforoPonencias.upsert).not.toHaveBeenCalled()
    })

    it('un evento que no existe responde 404', async () => {
        expect((await request(app).post('/api/v1/events/99/specialized-talks/occupancy-link').set(con(owner())).send({})).status).toBe(404)
    })
})

describe('aforo con el enlace (API del sitio)', () => {
    beforeEach(() => {
        enlaces.push({ id: 1, eventoId: 2, token: TOKEN, creadoEn: new Date('2026-10-25T10:00:00.000Z'), ultimoAcceso: null })
    })

    it('muestra por tema el aforo, los inscritos presenciales, los cupos libres y la asistencia, sin datos de personas', async () => {
        const lab = sembrarPonencia(m.__bd, { tema: 'Big Data', ambiente: 'Laboratorio 6', cupo: 3, ponenteNombre: 'Mg. Claudio', ponenteBio: 'Biografía privada', ponenteFoto: '/images/ponentes/claudio.webp' })
        const aula = sembrarPonencia(m.__bd, { tema: 'Investigación', ambiente: 'Aula 2', cupo: 40, coponentes: [{ nombre: 'Dr. Javier', bio: 'Otra bio', foto: null, externo: true }] })
        sembrarPonencia(m.__bd, { tema: 'Borrador', publicada: false })
        sembrarPonencia(m.__bd, { tema: 'Otro evento', eventoId: 3 })
        const personas = [1, 2, 3, 4].map((n) => sembrarAsistente(m.__bd, { numeroDocumento: `4000000${n}`, nombres: `Persona${n}`, correo: `p${n}@gmail.com` }))
        sembrarInscripcion(m.__bd, { ponenciaId: lab.id, asistenteId: personas[0]!.id, asistioEn: new Date() })
        sembrarInscripcion(m.__bd, { ponenciaId: lab.id, asistenteId: personas[1]!.id })
        sembrarInscripcion(m.__bd, { ponenciaId: lab.id, asistenteId: personas[2]!.id, modoAsistencia: 'VIRTUAL' })
        sembrarInscripcion(m.__bd, { ponenciaId: lab.id, asistenteId: personas[3]!.id, estado: 'CANCELADO' })
        sembrarInscripcion(m.__bd, { ponenciaId: aula.id, asistenteId: personas[3]!.id })

        const r = await request(app).get(AFORO).set({ ...sitio, 'X-Link-Token': TOKEN })
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
        expect(r.body.data.evento).toEqual({ nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC' })
        expect(r.body.data.ponencias.map((p: { tema: string }) => p.tema).sort()).toEqual(['Big Data', 'Investigación'])
        const porTema = (tema: string) => r.body.data.ponencias.find((p: { tema: string }) => p.tema === tema)
        // Solo los presenciales vigentes ocupan aforo; el virtual y el cancelado no cuentan
        expect(porTema('Big Data')).toMatchObject({ ambiente: 'Laboratorio 6', cupo: 3, inscritos: 2, cuposDisponibles: 1, llena: false, asistentes: 1, ponente: { nombre: 'Mg. Claudio', foto: '/images/ponentes/claudio.webp', externo: false } })
        expect(porTema('Investigación')).toMatchObject({ cupo: 40, inscritos: 1, cuposDisponibles: 39, asistentes: 0, coponentes: [{ nombre: 'Dr. Javier', foto: null, externo: true }] })

        const texto = JSON.stringify(r.body)
        for (const privado of ['4000000', 'Persona', '@gmail.com', 'Biografía privada', 'Otra bio']) expect(texto).not.toContain(privado)
        for (const p of r.body.data.ponencias) {
            for (const campo of ['precio', 'esGratuita', 'inscripciones', 'asistentesLista', 'publicada']) expect(p).not.toHaveProperty(campo)
            expect(p.ponente).not.toHaveProperty('bio')
        }
        expect(m.enlaceAforoPonencias.update).toHaveBeenCalledTimes(1)
        expect(enlaces[0]!.ultimoAcceso).toBeInstanceOf(Date)
    })

    it('marca llena la ponencia con el aforo presencial completo', async () => {
        const p = sembrarPonencia(m.__bd, { tema: 'Lleno', cupo: 1 })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: sembrarAsistente(m.__bd).id })
        const r = await request(app).get(AFORO).set({ ...sitio, 'X-Link-Token': TOKEN })
        expect(r.body.data.ponencias[0]).toMatchObject({ cupo: 1, inscritos: 1, cuposDisponibles: 0, llena: true })
    })

    it('no anota el acceso en cada visita: como máximo cada 5 minutos', async () => {
        enlaces[0]!.ultimoAcceso = new Date(Date.now() - 60_000)
        expect((await request(app).get(AFORO).set({ ...sitio, 'X-Link-Token': TOKEN })).status).toBe(200)
        expect(m.enlaceAforoPonencias.update).not.toHaveBeenCalled()
    })

    it.each([
        ['sin token', {}],
        ['con un token mal formado', { 'X-Link-Token': 'corto' }],
        ['con un token desconocido', { 'X-Link-Token': 'B'.repeat(43) }],
    ])('responde el mismo 404 %s', async (_caso, encabezado) => {
        const r = await request(app).get(AFORO).set({ ...sitio, ...encabezado })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('LINK_NOT_FOUND')
    })

    it('el enlace de otro evento no abre el aforo de este sitio', async () => {
        enlaces[0]!.eventoId = 3
        const r = await request(app).get(AFORO).set({ ...sitio, 'X-Link-Token': TOKEN })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('LINK_NOT_FOUND')
    })

    it('exige el token del sitio', async () => {
        expect((await request(app).get(AFORO).set({ 'X-Link-Token': TOKEN })).status).toBe(401)
    })
})

import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'
import { desdeAhora, reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return { prisma: { ...cliente, __bd: bd, evento: { findUnique: jest.fn() } } }
})

const m = prisma as unknown as { __bd: EstadoBd, evento: { findUnique: jest.Mock } }

const admin = () => tokenDeRol('ADMIN', 2)
const comision = (permisos: string[]) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

const CUERPO = {
    tema: 'Bases de datos vectoriales',
    fecha: '2026-10-27',
    horaInicio: '12:00',
    horaFin: '12:45',
    ambiente: 'Laboratorio 2',
    cupo: 20,
    ponente: { nombre: 'Ph.D. Edwin Roque Tito', bio: 'Investigador RENACYT.', foto: '/images/ponentes/2026/especializados/edwin-roque.webp', externo: false },
}

beforeEach(() => {
    reiniciar(m.__bd)
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}`, estado: 'PUBLICADO' }))
})

describe('gestión de ponencias especializadas', () => {
    it('el Administrador crea una ponencia gratuita presencial y la ve en el listado con su duración', async () => {
        const creada = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send(CUERPO)
        expect(creada.status).toBe(201)
        expect(creada.body.data).toMatchObject({
            tema: 'Bases de datos vectoriales', fecha: '2026-10-27', horaInicio: '12:00', horaFin: '12:45', duracionMin: 45,
            ambiente: 'Laboratorio 2', modalidad: 'PRESENCIAL', precio: 0, esGratuita: true, cupo: 20, cuposDisponibles: 20, publicada: true,
            ponente: { nombre: 'Ph.D. Edwin Roque Tito', externo: false },
        })
        const lista = await request(app).get('/api/v1/events/2/specialized-talks').set(con(admin()))
        expect(lista.status).toBe(200)
        expect(lista.body.data).toHaveLength(1)
        expect(lista.body.data[0]).toMatchObject({ inscritos: 0, asistentes: 0 })
    })

    it('valida los datos: horas, fecha inexistente, foto, cupo y precio', async () => {
        const casos: Array<[Record<string, unknown>, string]> = [
            [{ horaFin: '11:00' }, 'body'],
            [{ fecha: '2026-02-31' }, 'fecha'],
            [{ ponente: { nombre: 'Ponente', foto: '../secreto.png' } }, 'ponente.foto'],
            [{ ponente: { nombre: 'Ponente', foto: 'http://sitio.com/x.png' } }, 'ponente.foto'],
            [{ cupo: 0 }, 'cupo'],
            [{ precio: 10.555 }, 'precio'],
            [{ modalidad: 'HIBRIDA' }, 'modalidad'],
        ]
        for (const [cambio, campo] of casos) {
            const r = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, ...cambio })
            expect({ cambio, status: r.status }).toEqual({ cambio, status: 422 })
            expect(Object.keys(r.body.fields)).toContain(campo)
        }
        expect(m.__bd.ponencias).toHaveLength(0)
    })

    it('acepta una URL https como foto del ponente', async () => {
        const r = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, ponente: { nombre: 'Ponente Externo', foto: 'https://cdn.ejemplo.pe/foto.webp', externo: true } })
        expect(r.status).toBe(201)
        expect(r.body.data.ponente).toMatchObject({ foto: 'https://cdn.ejemplo.pe/foto.webp', externo: true })
    })

    it('un tema compartido guarda a sus coponentes, completa lo que falte y los devuelve en el listado', async () => {
        const coponentes = [{ nombre: 'Dr. Javier Camilo Poma Palacios', bio: 'Ingeniero Electrónico.', foto: '/images/ponentes/2026/especializados/javier-poma.webp', externo: true }, { nombre: 'Dra. Karen Michel Alcos Flores' }]
        const creada = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, coponentes })
        expect(creada.status).toBe(201)
        expect(creada.body.data.ponente.nombre).toBe('Ph.D. Edwin Roque Tito')
        expect(creada.body.data.coponentes).toEqual([
            { nombre: 'Dr. Javier Camilo Poma Palacios', bio: 'Ingeniero Electrónico.', foto: '/images/ponentes/2026/especializados/javier-poma.webp', externo: true },
            { nombre: 'Dra. Karen Michel Alcos Flores', bio: null, foto: null, externo: false },
        ])
        const lista = await request(app).get('/api/v1/events/2/specialized-talks').set(con(admin()))
        expect(lista.body.data[0].coponentes.map((p: { nombre: string }) => p.nombre)).toEqual(['Dr. Javier Camilo Poma Palacios', 'Dra. Karen Michel Alcos Flores'])
    })

    it('sin coponentes el tema trae una lista vacía, también en una ponencia anterior sin la columna', async () => {
        const nueva = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send(CUERPO)
        expect(nueva.body.data.coponentes).toEqual([])
        const antigua = sembrarPonencia(m.__bd, { tema: 'Antigua', ambiente: 'Aula 4', coponentes: undefined })
        const lista = await request(app).get('/api/v1/events/2/specialized-talks').set(con(admin()))
        expect(lista.body.data.find((p: { id: number }) => p.id === antigua.id).coponentes).toEqual([])
    })

    it('valida los coponentes: nombre, foto y un máximo de tres', async () => {
        const otro = (n: number) => ({ nombre: `Coponente ${n}` })
        const casos: Array<[unknown[], string]> = [
            [[{ bio: 'sin nombre' }], 'coponentes[0].nombre'],
            [[{ nombre: 'Ponente', foto: '../secreto.png' }], 'coponentes[0].foto'],
            [[otro(1), otro(2), otro(3), otro(4)], 'coponentes'],
        ]
        for (const [coponentes, campo] of casos) {
            const r = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, coponentes })
            expect({ campo, status: r.status }).toEqual({ campo, status: 422 })
            expect(Object.keys(r.body.fields)).toContain(campo)
        }
        expect(m.__bd.ponencias).toHaveLength(0)
        const tres = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, coponentes: [otro(1), otro(2), otro(3)] })
        expect(tres.status).toBe(201)
    })

    it('al editar, enviar coponentes los reemplaza, omitirlos los conserva y [] los quita', async () => {
        const creada = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, coponentes: [{ nombre: 'Primero' }] })
        const id = creada.body.data.id
        const nombres = (r: { body: { data: { coponentes: Array<{ nombre: string }> } } }) => r.body.data.coponentes.map((p) => p.nombre)

        const soloTema = await request(app).put(`/api/v1/specialized-talks/${id}`).set(con(admin())).send({ tema: 'Tema corregido' })
        expect(nombres(soloTema)).toEqual(['Primero'])

        const reemplazo = await request(app).put(`/api/v1/specialized-talks/${id}`).set(con(admin())).send({ coponentes: [{ nombre: 'Segundo' }, { nombre: 'Tercero' }] })
        expect(nombres(reemplazo)).toEqual(['Segundo', 'Tercero'])

        const soloPonente = await request(app).put(`/api/v1/specialized-talks/${id}`).set(con(admin())).send({ ponente: { nombre: 'Principal nuevo' } })
        expect(soloPonente.body.data.ponente.nombre).toBe('Principal nuevo')
        expect(nombres(soloPonente)).toEqual(['Segundo', 'Tercero'])

        const vacio = await request(app).put(`/api/v1/specialized-talks/${id}`).set(con(admin())).send({ coponentes: [] })
        expect(vacio.status).toBe(200)
        expect(vacio.body.data.coponentes).toEqual([])
    })

    it('dos ponencias presenciales no comparten ambiente a la misma hora, pero una virtual sí', async () => {
        await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send(CUERPO)
        const choque = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, tema: 'Otro tema', horaInicio: '12:30', horaFin: '13:15' })
        expect(choque.status).toBe(409)
        expect(choque.body.code).toBe('ROOM_CONFLICT')
        const contiguo = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, tema: 'Siguiente', horaInicio: '12:45', horaFin: '13:30' })
        expect(contiguo.status).toBe(201)
        const virtual = await request(app).post('/api/v1/events/2/specialized-talks').set(con(admin())).send({ ...CUERPO, tema: 'En línea', modalidad: 'VIRTUAL' })
        expect(virtual.status).toBe(201)
    })

    it('editar una ponencia no la choca consigo misma y respeta los demás ambientes', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A', ambiente: 'Aula 1' })
        sembrarPonencia(m.__bd, { tema: 'B', ambiente: 'Aula 2' })
        const mismo = await request(app).put(`/api/v1/specialized-talks/${a.id}`).set(con(admin())).send({ tema: 'A (corregida)' })
        expect(mismo.status).toBe(200)
        expect(mismo.body.data.tema).toBe('A (corregida)')
        const mover = await request(app).put(`/api/v1/specialized-talks/${a.id}`).set(con(admin())).send({ ambiente: 'Aula 2' })
        expect(mover.status).toBe(409)
        expect(mover.body.code).toBe('ROOM_CONFLICT')
    })

    it('editar solo el ponente conserva el resto y permite quitar el cupo', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A', cupo: 20, ponenteNombre: 'Antes', ponenteBio: 'Bio' })
        const r = await request(app).put(`/api/v1/specialized-talks/${a.id}`).set(con(admin())).send({ ponente: { nombre: 'Después' }, cupo: null })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ tema: 'A', cupo: null, cuposDisponibles: null, ponente: { nombre: 'Después', bio: 'Bio' } })
    })

    it('el cupo no puede quedar por debajo de los inscritos vigentes', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 5 })
        for (const documento of ['11111111', '22222222', '33333333']) {
            const asistente = sembrarAsistente(m.__bd, { numeroDocumento: documento })
            sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: asistente.id })
        }
        const menor = await request(app).put(`/api/v1/specialized-talks/${p.id}`).set(con(admin())).send({ cupo: 2 })
        expect(menor.status).toBe(409)
        expect(menor.body.code).toBe('CAPACITY_BELOW_REGISTERED')
        const justo = await request(app).put(`/api/v1/specialized-talks/${p.id}`).set(con(admin())).send({ cupo: 3 })
        expect(justo.status).toBe(200)
        expect(justo.body.data).toMatchObject({ inscritos: 3, cuposDisponibles: 0 })
    })

    it('solo el Owner y el Administrador gestionan: la Comisión y el Tesorero reciben 403', async () => {
        const p = sembrarPonencia(m.__bd)
        for (const token of [comision(['especializadas.ver', 'especializadas.inscribir', 'especializadas.asistencia']), tesorero()]) {
            expect((await request(app).post('/api/v1/events/2/specialized-talks').set(con(token)).send(CUERPO)).status).toBe(403)
            expect((await request(app).put(`/api/v1/specialized-talks/${p.id}`).set(con(token)).send({ tema: 'X' })).status).toBe(403)
            expect((await request(app).delete(`/api/v1/specialized-talks/${p.id}`).set(con(token))).status).toBe(403)
        }
        expect(m.__bd.ponencias).toHaveLength(1)
    })

    it('la Comisión con «ver» lista las de su evento y no las de otro', async () => {
        sembrarPonencia(m.__bd, { tema: 'Mía' })
        const token = comision(['especializadas.ver'])
        const suyo = await request(app).get('/api/v1/events/2/specialized-talks').set(con(token))
        expect(suyo.status).toBe(200)
        expect(suyo.body.data.map((p: { tema: string }) => p.tema)).toEqual(['Mía'])
        const otro = await request(app).get('/api/v1/events/3/specialized-talks').set(con(token))
        expect(otro.status).toBe(403)
        expect(otro.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect((await request(app).get('/api/v1/events/2/specialized-talks').set(con(tesorero()))).status).toBe(403)
    })

    it('el listado se puede filtrar por día y modalidad y sale ordenado por horario', async () => {
        sembrarPonencia(m.__bd, { tema: 'Tarde', horaInicio: desdeAhora(300) })
        sembrarPonencia(m.__bd, { tema: 'Temprano', horaInicio: desdeAhora(60), modalidad: 'VIRTUAL' })
        const todas = await request(app).get('/api/v1/events/2/specialized-talks').set(con(admin()))
        expect(todas.body.data.map((p: { tema: string }) => p.tema)).toEqual(['Temprano', 'Tarde'])
        const virtuales = await request(app).get('/api/v1/events/2/specialized-talks?modalidad=VIRTUAL').set(con(admin()))
        expect(virtuales.body.data.map((p: { tema: string }) => p.tema)).toEqual(['Temprano'])
        expect((await request(app).get('/api/v1/events/2/specialized-talks?modalidad=X').set(con(admin()))).status).toBe(400)
        expect((await request(app).get('/api/v1/events/2/specialized-talks?fecha=hoy').set(con(admin()))).status).toBe(400)
    })

    it('no se elimina una ponencia con inscritos vigentes; sin ellos sí, junto con sus canceladas', async () => {
        const p = sembrarPonencia(m.__bd)
        const ana = sembrarAsistente(m.__bd)
        const luis = sembrarAsistente(m.__bd, { numeroDocumento: '87654321' })
        const vigente = sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: luis.id, estado: 'CANCELADO' })
        const bloqueada = await request(app).delete(`/api/v1/specialized-talks/${p.id}`).set(con(admin()))
        expect(bloqueada.status).toBe(409)
        expect(bloqueada.body.code).toBe('TALK_HAS_REGISTRATIONS')
        vigente.estado = 'CANCELADO'
        const ok = await request(app).delete(`/api/v1/specialized-talks/${p.id}`).set(con(admin()))
        expect(ok.status).toBe(200)
        expect(m.__bd.ponencias).toHaveLength(0)
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('una ponencia inexistente responde 404', async () => {
        const r = await request(app).put('/api/v1/specialized-talks/99').set(con(admin())).send({ tema: 'Tema válido' })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('TALK_NOT_FOUND')
    })
})

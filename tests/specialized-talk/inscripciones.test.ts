import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { HttpError } from '../../src/core/http-error'
import { consultarDni } from '../../src/api/document-lookup/services/lookup'
import { nombresOficiales } from '../../src/api/document-lookup/services/cache'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO, registroDeToken } from '../helpers/sitio'
import { desdeAhora, reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return { prisma: { ...cliente, __bd: bd, evento: { findUnique: jest.fn() }, tokenAcceso: { findUnique: jest.fn(), update: jest.fn() } } }
})
jest.mock('../../src/api/document-lookup/services/lookup', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/lookup'),
    consultarDni: jest.fn(),
}))
jest.mock('../../src/api/document-lookup/services/cache', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/cache'),
    nombresOficiales: jest.fn(),
}))

const m = prisma as unknown as { __bd: EstadoBd, evento: { findUnique: jest.Mock }, tokenAcceso: { findUnique: jest.Mock, update: jest.Mock } }
const dni = consultarDni as jest.Mock
const oficiales = nombresOficiales as jest.Mock

// Acceso libre encendido: estas pruebas cubren el comportamiento sin validar el congreso (spec 019); la validación está en validacion-congreso.test.ts
const EVENTO = { id: 2, codigo: 'ciisic-viii', estado: 'PUBLICADO', ponenciasAccesoLibre: true }
const comision = (permisos: string[], eventoIds = [2]) => tokenDeRol('COMISION', 40, { eventoIds, permisos })
const gestion = () => comision(['especializadas.ver', 'especializadas.inscribir'])
const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const sitio = { 'X-Api-Key': TOKEN_SITIO }

const ANA = { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez' }
const inscripcion = (ponenciaIds: number[], asistente: Record<string, unknown> = ANA) => ({ asistente, ponenciaIds })

beforeEach(() => {
    reiniciar(m.__bd)
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ ...EVENTO, id: where.id }))
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(EVENTO))
    m.tokenAcceso.update.mockResolvedValue({})
    oficiales.mockResolvedValue(null)
    dni.mockRejectedValue(new HttpError(503, 'LOOKUP_UNAVAILABLE', 'No disponible'))
})

// ─── Sitio ──────────────────────────────────────────────────────────────────

describe('API del sitio: ponencias publicadas', () => {
    it('lista solo las publicadas del evento del token, con cupos y sin datos personales', async () => {
        const p = sembrarPonencia(m.__bd, { tema: 'Visible', cupo: 20 })
        sembrarPonencia(m.__bd, { tema: 'Borrador', publicada: false })
        sembrarPonencia(m.__bd, { tema: 'Otro evento', eventoId: 3 })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, asistioEn: new Date() })
        const r = await request(app).get('/api/v1/site/specialized-talks').set(sitio)
        expect(r.status).toBe(200)
        expect(r.body.data).toHaveLength(1)
        expect(r.body.data[0]).toMatchObject({ tema: 'Visible', cupo: 20, cuposDisponibles: 19, llena: false, esGratuita: true })
        expect(r.body.data[0]).not.toHaveProperty('inscritos')
        expect(r.body.data[0]).not.toHaveProperty('asistentes')
        expect(JSON.stringify(r.body)).not.toContain('12345678')
    })

    it('exige el token del evento', async () => {
        expect((await request(app).get('/api/v1/site/specialized-talks')).status).toBe(401)
        expect((await request(app).post('/api/v1/site/specialized-talk-registrations').send(inscripcion([1]))).status).toBe(401)
    })
})

describe('API del sitio: inscripción', () => {
    it('inscribe a dos ponencias que no se cruzan y registra a la persona', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A', cupo: 20 })
        const b = sembrarPonencia(m.__bd, { tema: 'B', horaInicio: desdeAhora(240) })
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([a.id, b.id], { ...ANA, correo: 'Ana@Gmail.com', procedencia: 'EXTERNO' }))
        expect(r.status).toBe(201)
        expect(r.body.data.inscripciones.map((i: { yaInscrito: boolean }) => i.yaInscrito)).toEqual([false, false])
        expect(r.body.data.inscripciones[0].ponencia).toMatchObject({ tema: 'A', cuposDisponibles: 19 })
        expect(r.body.data.asistente).toMatchObject({ numeroDocumento: '****5678', nombres: 'Ana' })
        expect(m.__bd.inscripciones).toHaveLength(2)
        expect(m.__bd.inscripciones.every((i) => i.origen === 'LANDING' && i.estado === 'INSCRITO')).toBe(true)
        expect(m.__bd.asistentes[0]).toMatchObject({ correo: 'ana@gmail.com', procedencia: 'EXTERNO', celular: null })
    })

    it('usa los nombres oficiales del DNI si ya se consultaron y no los que envía el visitante', async () => {
        oficiales.mockResolvedValue({ numero: '12345678', nombres: 'ANA MARIA', apellidoPaterno: 'PEREZ', apellidoMaterno: 'RUIZ' })
        const p = sembrarPonencia(m.__bd)
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Otro', apellidos: 'Nombre' }))
        expect(r.status).toBe(201)
        expect(m.__bd.asistentes[0]).toMatchObject({ nombres: 'ANA MARIA', apellidos: 'PEREZ RUIZ' })
        expect(dni).not.toHaveBeenCalled()
    })

    it('sin nombres oficiales ni enviados responde 422 NAMES_REQUIRED', async () => {
        const p = sembrarPonencia(m.__bd)
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678' }))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('NAMES_REQUIRED')
        expect(Object.keys(r.body.fields)).toEqual(['nombres', 'apellidos'])
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('repetir la inscripción es idempotente y no ocupa otro cupo', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        const primera = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id]))
        const segunda = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id]))
        expect(primera.status).toBe(201)
        expect(segunda.status).toBe(201)
        expect(segunda.body.data.inscripciones[0]).toMatchObject({ yaInscrito: true, id: primera.body.data.inscripciones[0].id })
        expect(m.__bd.inscripciones).toHaveLength(1)
    })

    it('nunca modifica los datos de una persona que ya existe', async () => {
        const p = sembrarPonencia(m.__bd)
        sembrarAsistente(m.__bd, { correo: 'real@gmail.com', celular: '987654321', procedencia: 'INTERNO' })
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio)
            .send(inscripcion([p.id], { ...ANA, nombres: 'Suplantador', correo: 'otro@gmail.com', celular: '999999999', procedencia: 'EXTERNO' }))
        expect(r.status).toBe(201)
        expect(m.__bd.asistentes).toHaveLength(1)
        expect(m.__bd.asistentes[0]).toMatchObject({ nombres: 'Ana', correo: 'real@gmail.com', celular: '987654321', procedencia: 'INTERNO' })
    })

    it('rechaza dos ponencias que se cruzan en la misma petición, nombrando ambas', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'Ciberseguridad' })
        const b = sembrarPonencia(m.__bd, { tema: 'Big Data', ambiente: 'Laboratorio 2' })
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([a.id, b.id]))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('SCHEDULE_CONFLICT')
        expect(r.body.message).toContain('Ciberseguridad')
        expect(r.body.message).toContain('Big Data')
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('rechaza una ponencia que se cruza con otra en la que la persona ya está inscrita', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A' })
        const b = sembrarPonencia(m.__bd, { tema: 'B', ambiente: 'Laboratorio 2' })
        const ok = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([a.id]))
        expect(ok.status).toBe(201)
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([b.id]))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('SCHEDULE_CONFLICT')
        expect(m.__bd.inscripciones).toHaveLength(1)
    })

    it('una inscripción cancelada no impide inscribirse a otra del mismo horario', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A' })
        const b = sembrarPonencia(m.__bd, { tema: 'B', ambiente: 'Laboratorio 2' })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: a.id, asistenteId: ana.id, estado: 'CANCELADO' })
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([b.id]))
        expect(r.status).toBe(201)
    })

    it('con la ponencia llena responde 409 TALK_FULL y no deja inscripciones a medias (todo o nada)', async () => {
        // Libre va primero (id menor): se crea su inscripción antes de que falle la llena y debe deshacerse
        const libre = sembrarPonencia(m.__bd, { tema: 'Libre' })
        const llena = sembrarPonencia(m.__bd, { tema: 'Llena', cupo: 1, horaInicio: desdeAhora(240) })
        const otra = sembrarAsistente(m.__bd, { numeroDocumento: '87654321' })
        sembrarInscripcion(m.__bd, { ponenciaId: llena.id, asistenteId: otra.id })
        const r = await request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([libre.id, llena.id]))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('TALK_FULL')
        expect(m.__bd.inscripciones).toHaveLength(1)
    })

    it('el último cupo lo ocupa una sola de dos inscripciones simultáneas', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        const [x, y] = await Promise.all([
            request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id], { ...ANA, numeroDocumento: '11111111' })),
            request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion([p.id], { ...ANA, numeroDocumento: '22222222' })),
        ])
        expect([x.status, y.status].sort()).toEqual([201, 409])
        expect(m.__bd.inscripciones.filter((i) => i.estado === 'INSCRITO')).toHaveLength(1)
    })

    it('rechaza ponencias de pago, terminadas, no publicadas o de otro evento', async () => {
        const pago = sembrarPonencia(m.__bd, { tema: 'De pago', precio: 10 })
        const pasada = sembrarPonencia(m.__bd, { tema: 'Pasada', horaInicio: desdeAhora(-120), horaFin: desdeAhora(-75) })
        const borrador = sembrarPonencia(m.__bd, { publicada: false })
        const ajena = sembrarPonencia(m.__bd, { eventoId: 3 })
        const enviar = (ids: number[]) => request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(inscripcion(ids))
        expect(await enviar([pago.id]).then((r) => [r.status, r.body.code])).toEqual([422, 'PAID_TALK_UNAVAILABLE'])
        expect(await enviar([pasada.id]).then((r) => [r.status, r.body.code])).toEqual([409, 'TALK_ENDED'])
        expect(await enviar([borrador.id]).then((r) => [r.status, r.body.code])).toEqual([404, 'TALK_NOT_FOUND'])
        expect(await enviar([ajena.id]).then((r) => [r.status, r.body.code])).toEqual([404, 'TALK_NOT_FOUND'])
        expect(await enviar([999]).then((r) => [r.status, r.body.code])).toEqual([404, 'TALK_NOT_FOUND'])
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('valida el documento y la lista de ponencias', async () => {
        const p = sembrarPonencia(m.__bd)
        const enviar = (cuerpo: unknown) => request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(cuerpo as object)
        expect((await enviar(inscripcion([p.id], { ...ANA, numeroDocumento: '123' }))).status).toBe(422)
        expect((await enviar(inscripcion([p.id], { ...ANA, correo: 'no-es-correo' }))).status).toBe(422)
        expect((await enviar(inscripcion([p.id], { ...ANA, celular: 'abc' }))).status).toBe(422)
        expect((await enviar(inscripcion([p.id], { ...ANA, procedencia: 'OTRO' }))).status).toBe(422)
        expect((await enviar(inscripcion([]))).status).toBe(422)
        expect((await enviar(inscripcion([p.id, p.id]))).status).toBe(422)
        expect((await enviar(inscripcion([1, 2, 3, 4, 5]))).status).toBe(422)
        // Correo y celular vacíos equivalen a no enviarlos
        expect((await enviar(inscripcion([p.id], { ...ANA, correo: '', celular: '', procedencia: '' }))).status).toBe(201)
    })
})

// ─── Panel ──────────────────────────────────────────────────────────────────

describe('inscripción manual del staff', () => {
    it('inscribe con el DNI: los nombres salen de la consulta oficial', async () => {
        dni.mockResolvedValue({ numero: '12345678', nombres: 'JUAN CARLOS', apellidoPaterno: 'QUISPE', apellidoMaterno: 'MAMANI' })
        const p = sembrarPonencia(m.__bd, { cupo: 20 })
        const r = await request(app).post(`/api/v1/specialized-talks/${p.id}/registrations`).set(con(gestion())).send({ tipoDocumento: 'dni', numeroDocumento: '12345678', celular: '987654321', procedencia: 'INTERNO' })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ estado: 'INSCRITO', origen: 'STAFF', asistente: { nombres: 'JUAN CARLOS', apellidos: 'QUISPE MAMANI', numeroDocumento: '12345678', celular: '987654321', procedencia: 'INTERNO' } })
        expect(r.body.data.ponencia).toMatchObject({ id: p.id })
        expect(dni).toHaveBeenCalledWith('12345678', 'PANEL')
    })

    it('si la consulta falla usa los nombres escritos; sin ellos pide escribirlos', async () => {
        const p = sembrarPonencia(m.__bd)
        const sinNombres = await request(app).post(`/api/v1/specialized-talks/${p.id}/registrations`).set(con(gestion())).send({ tipoDocumento: 'dni', numeroDocumento: '12345678' })
        expect(sinNombres.status).toBe(422)
        expect(sinNombres.body.code).toBe('NAMES_REQUIRED')
        const conNombres = await request(app).post(`/api/v1/specialized-talks/${p.id}/registrations`).set(con(gestion())).send({ ...ANA })
        expect(conNombres.status).toBe(201)
        expect(conNombres.body.data.asistente).toMatchObject({ nombres: 'Ana', apellidos: 'Pérez' })
    })

    it('no repite la inscripción, respeta el cupo y sí permite ponencias que se cruzan', async () => {
        const a = sembrarPonencia(m.__bd, { tema: 'A', cupo: 1 })
        const b = sembrarPonencia(m.__bd, { tema: 'B', ambiente: 'Laboratorio 2' })
        const enviar = (id: number, doc = ANA) => request(app).post(`/api/v1/specialized-talks/${id}/registrations`).set(con(gestion())).send(doc)
        expect((await enviar(a.id)).status).toBe(201)
        const repetida = await enviar(a.id)
        expect([repetida.status, repetida.body.code]).toEqual([409, 'ALREADY_REGISTERED'])
        const llena = await enviar(a.id, { ...ANA, numeroDocumento: '87654321', nombres: 'Luis', apellidos: 'Gómez' })
        expect([llena.status, llena.body.code]).toEqual([409, 'TALK_FULL'])
        // El staff puede inscribir a la misma persona en otra ponencia del mismo horario
        expect((await enviar(b.id)).status).toBe(201)
    })

    it('completa el correo vacío de una persona que ya existe sin pisar lo que tenía', async () => {
        const p = sembrarPonencia(m.__bd)
        sembrarAsistente(m.__bd, { celular: '987654321' })
        const r = await request(app).post(`/api/v1/specialized-talks/${p.id}/registrations`).set(con(gestion())).send({ ...ANA, correo: 'ana@gmail.com', celular: '911111111' })
        expect(r.status).toBe(201)
        expect(m.__bd.asistentes).toHaveLength(1)
        expect(m.__bd.asistentes[0]).toMatchObject({ correo: 'ana@gmail.com', celular: '987654321' })
    })

    it('exige «inscribir»: con solo «ver» o en otro evento responde 403', async () => {
        const p = sembrarPonencia(m.__bd)
        const soloVer = await request(app).post(`/api/v1/specialized-talks/${p.id}/registrations`).set(con(comision(['especializadas.ver']))).send(ANA)
        expect([soloVer.status, soloVer.body.code]).toEqual([403, 'FORBIDDEN'])
        const ajena = sembrarPonencia(m.__bd, { eventoId: 3 })
        const otroEvento = await request(app).post(`/api/v1/specialized-talks/${ajena.id}/registrations`).set(con(gestion())).send(ANA)
        expect([otroEvento.status, otroEvento.body.code]).toEqual([403, 'EVENT_NOT_ASSIGNED'])
        expect(m.__bd.inscripciones).toHaveLength(0)
    })
})

describe('cancelar, reactivar y corregir', () => {
    const preparar = (datos: Record<string, unknown> = {}, ponencia: Record<string, unknown> = {}) => {
        const p = sembrarPonencia(m.__bd, ponencia)
        const ana = sembrarAsistente(m.__bd)
        const fila = sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, ...datos })
        return { p, ana, fila }
    }
    const patch = (id: number, cuerpo: object, token = gestion()) => request(app).patch(`/api/v1/specialized-talk-registrations/${id}`).set(con(token)).send(cuerpo)

    it('cancela y reactiva una inscripción', async () => {
        const { fila } = preparar()
        const cancelada = await patch(fila.id, { estado: 'CANCELADO' })
        expect(cancelada.status).toBe(200)
        expect(cancelada.body.data).toMatchObject({ estado: 'CANCELADO', motivoCancelacion: 'STAFF' })
        const reactivada = await patch(fila.id, { estado: 'INSCRITO' })
        expect(reactivada.body.data).toMatchObject({ estado: 'INSCRITO', motivoCancelacion: null, canceladoEn: null })
    })

    it('no cancela a quien ya asistió y no reactiva si no queda cupo', async () => {
        const asistida = preparar({ asistioEn: new Date() })
        const r = await patch(asistida.fila.id, { estado: 'CANCELADO' })
        expect([r.status, r.body.code]).toEqual([409, 'ALREADY_ATTENDED'])

        reiniciar(m.__bd)
        const { p, fila } = preparar({ estado: 'CANCELADO' }, { cupo: 1 })
        const otra = sembrarAsistente(m.__bd, { numeroDocumento: '87654321' })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: otra.id })
        const llena = await patch(fila.id, { estado: 'INSCRITO' })
        expect([llena.status, llena.body.code]).toEqual([409, 'TALK_FULL'])
        expect(fila.estado).toBe('CANCELADO')
    })

    it('corrige los datos de la persona; vacío borra el correo y el celular', async () => {
        const { ana, fila } = preparar()
        ana.correo = 'viejo@gmail.com'
        ana.celular = '987654321'
        const r = await patch(fila.id, { asistente: { nombres: 'Ana María', correo: '', celular: '', procedencia: 'EXTERNO' } })
        expect(r.status).toBe(200)
        expect(r.body.data.asistente).toMatchObject({ nombres: 'Ana María', apellidos: 'Pérez', correo: null, celular: null, procedencia: 'EXTERNO' })
    })

    it('pide algo que cambiar y valida el estado', async () => {
        const { fila } = preparar()
        expect((await patch(fila.id, {})).status).toBe(422)
        expect((await patch(fila.id, { estado: 'BORRADO' })).status).toBe(422)
    })

    it('una inscripción de otro evento responde 403 y una inexistente 404', async () => {
        const ajena = preparar({}, { eventoId: 3 })
        expect((await patch(ajena.fila.id, { estado: 'CANCELADO' })).status).toBe(403)
        expect((await patch(999, { estado: 'CANCELADO' })).status).toBe(404)
    })
})

describe('listado de inscripciones del panel', () => {
    function datos() {
        const a = sembrarPonencia(m.__bd, { tema: 'Redes', horaInicio: desdeAhora(60) })
        const b = sembrarPonencia(m.__bd, { tema: 'IA', ambiente: 'Laboratorio 2', horaInicio: desdeAhora(60), modalidad: 'VIRTUAL' })
        const ajena = sembrarPonencia(m.__bd, { tema: 'Ajena', eventoId: 3 })
        const ana = sembrarAsistente(m.__bd, { nombres: 'Ana', apellidos: 'Pérez Ruiz', correo: 'ana@gmail.com', procedencia: 'INTERNO' })
        const luis = sembrarAsistente(m.__bd, { numeroDocumento: '87654321', nombres: 'Luis', apellidos: 'Gómez', celular: '987654321', procedencia: 'EXTERNO' })
        const eva = sembrarAsistente(m.__bd, { numeroDocumento: '11112222', nombres: 'Eva', apellidos: 'Soto' })
        sembrarInscripcion(m.__bd, { ponenciaId: a.id, asistenteId: ana.id, origen: 'LANDING', asistioEn: new Date() })
        sembrarInscripcion(m.__bd, { ponenciaId: a.id, asistenteId: luis.id, origen: 'STAFF' })
        sembrarInscripcion(m.__bd, { ponenciaId: b.id, asistenteId: eva.id, origen: 'PUERTA', estado: 'CANCELADO' })
        sembrarInscripcion(m.__bd, { ponenciaId: ajena.id, asistenteId: ana.id })
        return { a, b }
    }
    const listar = (consulta = '', token = comision(['especializadas.ver'])) =>
        request(app).get(`/api/v1/events/2/specialized-talk-registrations${consulta}`).set(con(token))
    const nombres = (r: request.Response) => r.body.data.map((f: { asistente: { nombres: string } }) => f.asistente.nombres).sort()

    it('lista las del evento con la ponencia y la persona, sin las de otro evento', async () => {
        datos()
        const r = await listar()
        expect(r.status).toBe(200)
        expect(nombres(r)).toEqual(['Ana', 'Eva', 'Luis'])
        expect(r.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 3, asistieron: 1 })
        expect(r.body.data[0]).toHaveProperty('ponencia.tema')
        expect(r.body.data[0]).toHaveProperty('asistente.numeroDocumento')
    })

    it('filtra por ponencia, estado, asistencia, origen, procedencia y modalidad', async () => {
        const { a, b } = datos()
        expect(nombres(await listar(`?ponenciaId=${a.id}`))).toEqual(['Ana', 'Luis'])
        expect(nombres(await listar(`?ponenciaId=${b.id}`))).toEqual(['Eva'])
        expect(nombres(await listar('?estado=CANCELADO'))).toEqual(['Eva'])
        expect(nombres(await listar('?asistencia=si'))).toEqual(['Ana'])
        expect(nombres(await listar('?asistencia=no&estado=INSCRITO'))).toEqual(['Luis'])
        expect(nombres(await listar('?origen=PUERTA'))).toEqual(['Eva'])
        expect(nombres(await listar('?procedencia=EXTERNO'))).toEqual(['Luis'])
        expect(nombres(await listar('?procedencia=SIN_DATO'))).toEqual(['Eva'])
        expect(nombres(await listar('?modalidad=VIRTUAL'))).toEqual(['Eva'])
    })

    it('busca por documento, nombre completo, correo o celular', async () => {
        datos()
        expect(nombres(await listar('?q=87654321'))).toEqual(['Luis'])
        expect(nombres(await listar('?q=ana%20ruiz'))).toEqual(['Ana'])
        expect(nombres(await listar('?q=gmail'))).toEqual(['Ana'])
        expect(nombres(await listar('?q=98765'))).toEqual(['Luis'])
        expect(nombres(await listar('?q=nadie'))).toEqual([])
    })

    it('pagina y rechaza filtros inválidos', async () => {
        datos()
        const pagina = await listar('?pageSize=2&page=2')
        expect(pagina.body.data).toHaveLength(1)
        expect(pagina.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3 })
        for (const consulta of ['?estado=X', '?asistencia=tal_vez', '?fecha=ayer', '?ponenciaId=abc', '?origen=OTRO']) {
            expect({ consulta, status: (await listar(consulta)).status }).toEqual({ consulta, status: 400 })
        }
    })

    it('exige «ver» y el evento asignado', async () => {
        datos()
        expect((await listar('', tokenDeRol('TESORERO', 30, { eventoIds: [2] }))).status).toBe(403)
        const otro = await request(app).get('/api/v1/events/3/specialized-talk-registrations').set(con(comision(['especializadas.ver'])))
        expect([otro.status, otro.body.code]).toEqual([403, 'EVENT_NOT_ASSIGNED'])
    })
})

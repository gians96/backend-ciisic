import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { HttpError } from '../../src/core/http-error'
import { consultarDni } from '../../src/api/document-lookup/services/lookup'
import { tokenDeRol } from '../helpers/tokens'
import { desdeAhora, reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return { prisma: { ...cliente, __bd: bd, evento: { findUnique: jest.fn() } } }
})
jest.mock('../../src/api/document-lookup/services/lookup', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/lookup'),
    consultarDni: jest.fn(),
}))

const m = prisma as unknown as { __bd: EstadoBd, evento: { findUnique: jest.Mock } }
const dni = consultarDni as jest.Mock

const puerta = (eventoIds = [2]) => tokenDeRol('COMISION', 40, { eventoIds, permisos: ['especializadas.asistencia'] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const marcar = (ponenciaId: number, cuerpo: object = { tipoDocumento: 'dni', numeroDocumento: '12345678' }, token = puerta()) =>
    request(app).post(`/api/v1/specialized-talks/${ponenciaId}/check-in`).set(con(token)).send(cuerpo)

/** Ponencia en curso: empezó hace 10 minutos y termina en 35. */
const enCurso = (datos: Record<string, unknown> = {}) => sembrarPonencia(m.__bd, { horaInicio: desdeAhora(-10), horaFin: desdeAhora(35), ...datos })

beforeEach(() => {
    reiniciar(m.__bd)
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ id: where.id, codigo: `evento-${where.id}`, estado: 'PUBLICADO' }))
    dni.mockResolvedValue({ numero: '12345678', nombres: 'JUAN CARLOS', apellidoPaterno: 'QUISPE', apellidoMaterno: 'MAMANI' })
})

describe('asistencia en puerta con el DNI', () => {
    it('marca a quien ya estaba inscrito, dentro de horario', async () => {
        const p = enCurso({ cupo: 20 })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({
            inscripcionNueva: false, esFueraDeHorario: false, liberadas: [],
            asistente: { nombres: 'Ana', numeroDocumento: '12345678' },
            ponencia: { id: p.id, cupo: 20, inscritos: 1, asistentes: 1 },
        })
        expect(m.__bd.inscripciones[0]).toMatchObject({ estado: 'INSCRITO', origen: 'LANDING', asistenciaPorId: 40 })
        expect(m.__bd.inscripciones[0].asistioEn).toBeInstanceOf(Date)
        expect(dni).not.toHaveBeenCalled()
    })

    it('una segunda lectura responde 409 con la hora y no cambia la marca', async () => {
        const p = enCurso()
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        await marcar(p.id)
        const marca = (m.__bd.inscripciones[0].asistioEn as Date).getTime()
        const otra = await marcar(p.id)
        expect([otra.status, otra.body.code]).toEqual([409, 'ATTENDANCE_ALREADY_REGISTERED'])
        expect((m.__bd.inscripciones[0].asistioEn as Date).getTime()).toBe(marca)
    })

    it('si la persona no existe la busca con la API, la registra, la inscribe y marca su asistencia', async () => {
        const p = enCurso({ cupo: 20 })
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(dni).toHaveBeenCalledWith('12345678', 'PANEL')
        expect(r.body.data).toMatchObject({ inscripcionNueva: true, asistente: { nombres: 'JUAN CARLOS', apellidos: 'QUISPE MAMANI' }, ponencia: { inscritos: 1, asistentes: 1 } })
        expect(m.__bd.asistentes).toHaveLength(1)
        expect(m.__bd.inscripciones[0]).toMatchObject({ origen: 'PUERTA', estado: 'INSCRITO', registradoPorId: 40, asistenciaPorId: 40 })
    })

    it('una persona conocida pero no inscrita en esta ponencia se inscribe en el acto', async () => {
        const p = enCurso()
        sembrarAsistente(m.__bd)
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data.inscripcionNueva).toBe(true)
        expect(dni).not.toHaveBeenCalled()
        expect(m.__bd.asistentes).toHaveLength(1)
    })

    it('reactiva una inscripción cancelada si hay cupo', async () => {
        const p = enCurso({ cupo: 1 })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, estado: 'CANCELADO', canceladoEn: new Date(), motivoCancelacion: 'STAFF' })
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data.inscripcionNueva).toBe(true)
        expect(m.__bd.inscripciones).toHaveLength(1)
        expect(m.__bd.inscripciones[0]).toMatchObject({ estado: 'INSCRITO', canceladoEn: null, motivoCancelacion: null, origen: 'PUERTA' })
    })

    it('con la ponencia llena no inscribe a quien llega, pero sí marca a quien ya tiene su cupo', async () => {
        const p = enCurso({ cupo: 1 })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        const nuevo = await marcar(p.id, { tipoDocumento: 'dni', numeroDocumento: '87654321', nombres: 'Luis', apellidos: 'Gómez' })
        expect([nuevo.status, nuevo.body.code]).toEqual([409, 'TALK_FULL'])
        expect(m.__bd.inscripciones).toHaveLength(1)
        const suyo = await marcar(p.id)
        expect(suyo.status).toBe(201)
        expect(suyo.body.data.inscripcionNueva).toBe(false)
    })

    it('quien estaba inscrito en otra ponencia del mismo horario cambia en puerta y se libera su cupo', async () => {
        const destino = enCurso({ tema: 'Destino', cupo: 20 })
        const origen = enCurso({ tema: 'Origen', cupo: 20, ambiente: 'Laboratorio 2' })
        const posterior = sembrarPonencia(m.__bd, { tema: 'Más tarde', horaInicio: desdeAhora(300) })
        const ana = sembrarAsistente(m.__bd)
        const enOrigen = sembrarInscripcion(m.__bd, { ponenciaId: origen.id, asistenteId: ana.id })
        const enPosterior = sembrarInscripcion(m.__bd, { ponenciaId: posterior.id, asistenteId: ana.id })
        const r = await marcar(destino.id)
        expect(r.status).toBe(201)
        expect(r.body.data.inscripcionNueva).toBe(true)
        expect(r.body.data.liberadas).toEqual([{ inscripcionId: enOrigen.id, ponenciaId: origen.id, tema: 'Origen', ambiente: 'Laboratorio 2' }])
        const filas = m.__bd.inscripciones
        expect(filas.find((f) => f.id === enOrigen.id)).toMatchObject({ estado: 'CANCELADO', motivoCancelacion: 'CAMBIO_EN_PUERTA' })
        // La que no se cruza se conserva
        expect(filas.find((f) => f.id === enPosterior.id)).toMatchObject({ estado: 'INSCRITO', motivoCancelacion: null })
    })

    it('no libera la ponencia cruzada en la que la persona ya asistió', async () => {
        const destino = enCurso({ tema: 'Destino' })
        const origen = enCurso({ tema: 'Origen', ambiente: 'Laboratorio 2' })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: origen.id, asistenteId: ana.id, asistioEn: new Date() })
        const r = await marcar(destino.id)
        expect(r.status).toBe(201)
        expect(r.body.data.liberadas).toEqual([])
        expect(m.__bd.inscripciones.find((f) => f.ponenciaId === origen.id)?.estado).toBe('INSCRITO')
    })

    it('un día distinto o fuera de la ventana se registra, pero queda marcado como fuera de horario', async () => {
        const manana = sembrarPonencia(m.__bd, { horaInicio: desdeAhora(60 * 24) })
        const r = await marcar(manana.id)
        expect(r.status).toBe(201)
        expect(r.body.data.esFueraDeHorario).toBe(true)
        expect(m.__bd.inscripciones[0].esFueraDeHorario).toBe(true)
    })

    it('si la consulta del DNI falla usa los nombres escritos; sin ellos pide escribirlos', async () => {
        dni.mockRejectedValue(new HttpError(404, 'DOCUMENT_NOT_FOUND', 'No encontrado'))
        const p = enCurso()
        const sin = await marcar(p.id)
        expect([sin.status, sin.body.code]).toEqual([422, 'NAMES_REQUIRED'])
        expect(m.__bd.asistentes).toHaveLength(0)
        const con = await marcar(p.id, { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'María', apellidos: 'López', procedencia: 'EXTERNO' })
        expect(con.status).toBe(201)
        expect(m.__bd.asistentes[0]).toMatchObject({ nombres: 'María', apellidos: 'López', procedencia: 'EXTERNO' })
    })

    it('valida el documento', async () => {
        const p = enCurso()
        expect((await marcar(p.id, { tipoDocumento: 'dni', numeroDocumento: '1234' })).status).toBe(422)
        expect((await marcar(p.id, { numeroDocumento: '12345678' })).status).toBe(422)
        expect((await marcar(p.id, {})).status).toBe(422)
        expect((await marcar(9999)).status).toBe(404)
    })

    it('exige «asistencia» y el evento asignado; «ver» o «inscribir» solos no alcanzan', async () => {
        const p = enCurso()
        const ajena = sembrarPonencia(m.__bd, { eventoId: 3 })
        for (const permisos of [['especializadas.ver'], ['especializadas.inscribir']]) {
            const r = await marcar(p.id, undefined, tokenDeRol('COMISION', 40, { eventoIds: [2], permisos }))
            expect([r.status, r.body.code]).toEqual([403, 'FORBIDDEN'])
        }
        const otro = await marcar(ajena.id)
        expect([otro.status, otro.body.code]).toEqual([403, 'EVENT_NOT_ASSIGNED'])
        expect((await marcar(p.id, undefined, tokenDeRol('TESORERO', 30, { eventoIds: [2] }))).status).toBe(403)
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('el Administrador marca en cualquier evento', async () => {
        const ajena = sembrarPonencia(m.__bd, { eventoId: 3 })
        const r = await marcar(ajena.id, undefined, tokenDeRol('ADMIN', 2))
        expect(r.status).toBe(201)
    })
})

describe('anular la asistencia', () => {
    const preparar = () => {
        const p = enCurso()
        const ana = sembrarAsistente(m.__bd)
        return sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, asistioEn: new Date(), asistenciaPorId: 40 })
    }
    const anular = (id: number, token = puerta()) => request(app).delete(`/api/v1/specialized-talk-registrations/${id}/attendance`).set(con(token))

    it('deja la inscripción vigente sin asistencia y permite volver a marcar', async () => {
        const fila = preparar()
        const r = await anular(fila.id)
        expect(r.status).toBe(200)
        expect(m.__bd.inscripciones[0]).toMatchObject({ estado: 'INSCRITO', asistioEn: null, asistenciaPorId: null, esFueraDeHorario: false })
        expect((await marcar(fila.ponenciaId)).status).toBe(201)
    })

    it('responde 404 si no hay asistencia y 403 sin el permiso o en otro evento', async () => {
        const fila = preparar()
        fila.asistioEn = null
        const sinMarca = await anular(fila.id)
        expect([sinMarca.status, sinMarca.body.code]).toEqual([404, 'ATTENDANCE_NOT_FOUND'])
        const soloInscribir = await anular(fila.id, tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['especializadas.inscribir'] }))
        expect(soloInscribir.status).toBe(403)
        const otroEvento = await anular(fila.id, puerta([3]))
        expect([otroEvento.status, otroEvento.body.code]).toEqual([403, 'EVENT_NOT_ASSIGNED'])
    })
})

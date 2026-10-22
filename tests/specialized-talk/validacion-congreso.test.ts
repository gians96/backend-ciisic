import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { HttpError } from '../../src/core/http-error'
import { correosCoinciden, resolverElegibilidad } from '../../src/core/ponencias-especializadas'
import { consultarDni } from '../../src/api/document-lookup/services/lookup'
import { nombresOficiales } from '../../src/api/document-lookup/services/cache'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO, registroDeToken } from '../helpers/sitio'
import { desdeAhora, reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return {
        prisma: {
            ...cliente,
            __bd: bd,
            evento: { findUnique: jest.fn(), update: jest.fn() },
            participante: { findUnique: jest.fn() },
            tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        },
    }
})
jest.mock('../../src/api/document-lookup/services/lookup', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/lookup'),
    consultarDni: jest.fn(),
}))
jest.mock('../../src/api/document-lookup/services/cache', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/cache'),
    nombresOficiales: jest.fn(),
}))

type Fila = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const m = prisma as unknown as {
    __bd: EstadoBd
    evento: { findUnique: jest.Mock, update: jest.Mock }
    participante: { findUnique: jest.Mock }
    tokenAcceso: { findUnique: jest.Mock, update: jest.Mock }
}
const dni = consultarDni as jest.Mock
const oficiales = nombresOficiales as jest.Mock

const sitio = { 'X-Api-Key': TOKEN_SITIO }
const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const admin = () => tokenDeRol('ADMIN', 2)
const comision = (permisos: string[]) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const gestion = () => comision(['especializadas.ver', 'especializadas.inscribir'])
const puerta = () => comision(['especializadas.asistencia'])

let evento: Fila
/** Congresistas sembrados: la inscripción al congreso de cada participante, por evento. */
let congreso: Array<{ participante: Fila, inscripciones: Fila[] }>
let secuenciaCongreso = 500

interface DatosCongresista {
    dni?: string
    correo?: string
    estado?: string
    /** `null`: sin tipo de inscripción, como una cortesía. */
    modalidad?: 'PRESENCIAL' | 'VIRTUAL' | null
    interno?: boolean
    eventoId?: number
}

/** Un participante con su inscripción al congreso; por defecto Ana, aprobada, presencial y externa. */
function sembrarCongresista(datos: DatosCongresista = {}): number {
    const id = ++secuenciaCongreso
    const modalidad = datos.modalidad === undefined ? 'PRESENCIAL' : datos.modalidad
    congreso.push({
        participante: { id, tipoDocumentoId: 'dni', numeroDocumento: datos.dni ?? '12345678', nombres: 'Ana', apellidos: 'Pérez Quispe', correo: datos.correo ?? 'ana@gmail.com', celular: '987654321' },
        inscripciones: [{
            id: id + 1000,
            eventoId: datos.eventoId ?? 2,
            esCorreoInstitucional: datos.interno ?? false,
            esEstudianteUndc: false,
            estado: { codigo: datos.estado ?? 'APROBADO' },
            tipoInscripcion: modalidad === null ? null : { nombre: modalidad === 'VIRTUAL' ? 'Público general virtual' : 'Público general', modalidad, categoria: { nombre: 'Público general' } },
        }],
    })
    return id + 1000
}

const cuerpo = (ponenciaIds: number[], asistente: Record<string, unknown> = { tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'ana@gmail.com' }) => ({ asistente, ponenciaIds })
const inscribirSitio = (ponenciaIds: number[], asistente?: Record<string, unknown>) =>
    request(app).post('/api/v1/site/specialized-talk-registrations').set(sitio).send(cuerpo(ponenciaIds, asistente))
const verificar = (cuerpoVerificacion: Record<string, unknown> = { tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'ana@gmail.com' }) =>
    request(app).post('/api/v1/site/specialized-talk-eligibility').set(sitio).send(cuerpoVerificacion)
const inscribirStaff = (ponenciaId: number, persona: Record<string, unknown> = { tipoDocumento: 'dni', numeroDocumento: '12345678' }) =>
    request(app).post(`/api/v1/specialized-talks/${ponenciaId}/registrations`).set(con(gestion())).send(persona)
const marcar = (ponenciaId: number, persona: Record<string, unknown> = { tipoDocumento: 'dni', numeroDocumento: '12345678' }) =>
    request(app).post(`/api/v1/specialized-talks/${ponenciaId}/check-in`).set(con(puerta())).send(persona)

beforeEach(() => {
    reiniciar(m.__bd)
    jest.clearAllMocks()
    congreso = []
    evento = { id: 2, codigo: 'ciisic-viii', estado: 'PUBLICADO', ponenciasAccesoLibre: false }
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ ...evento, id: where.id }))
    m.evento.update.mockImplementation(({ data }: { data: Fila }) => {
        Object.assign(evento, data)
        return Promise.resolve({ ...evento })
    })
    m.tokenAcceso.findUnique.mockImplementation(() => Promise.resolve(registroDeToken(evento as { id: number })))
    m.tokenAcceso.update.mockResolvedValue({})
    m.participante.findUnique.mockImplementation(async ({ where, select }: { where: { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: string, numeroDocumento: string } }, select: { inscripciones: { where: { eventoId: number } } } }) => {
        const clave = where.tipoDocumentoId_numeroDocumento
        const fila = congreso.find((c) => c.participante.tipoDocumentoId === clave.tipoDocumentoId && c.participante.numeroDocumento === clave.numeroDocumento)
        if (!fila) return null
        return { ...fila.participante, inscripciones: fila.inscripciones.filter((i) => i.eventoId === select.inscripciones.where.eventoId) }
    })
    oficiales.mockResolvedValue(null)
    dni.mockRejectedValue(new HttpError(503, 'LOOKUP_UNAVAILABLE', 'No disponible'))
})

// ─── Reglas puras ───────────────────────────────────────────────────────────

describe('reglas puras de elegibilidad', () => {
    it('solo el pago aprobado da acceso y el modo sale del tipo (sin tipo es presencial)', () => {
        expect(resolverElegibilidad({ estado: 'APROBADO', modalidadTipo: 'VIRTUAL' })).toEqual({ ok: true, modo: 'VIRTUAL' })
        expect(resolverElegibilidad({ estado: 'APROBADO', modalidadTipo: 'PRESENCIAL' })).toEqual({ ok: true, modo: 'PRESENCIAL' })
        expect(resolverElegibilidad({ estado: 'APROBADO', modalidadTipo: undefined })).toEqual({ ok: true, modo: 'PRESENCIAL' })
        expect(resolverElegibilidad({ estado: 'PENDIENTE', modalidadTipo: 'PRESENCIAL' })).toEqual({ ok: false, motivo: 'PAGO_PENDIENTE' })
        expect(resolverElegibilidad({ estado: 'EN_REVISION', modalidadTipo: 'PRESENCIAL' })).toEqual({ ok: false, motivo: 'PAGO_PENDIENTE' })
        expect(resolverElegibilidad({ estado: 'RECHAZADO', modalidadTipo: 'PRESENCIAL' })).toEqual({ ok: false, motivo: 'RECHAZADA' })
        expect(resolverElegibilidad({ estado: 'CANCELADO', modalidadTipo: 'PRESENCIAL' })).toEqual({ ok: false, motivo: 'RECHAZADA' })
        expect(resolverElegibilidad(null)).toEqual({ ok: false, motivo: 'NO_ENCONTRADA' })
    })

    it('el correo se compara sin distinguir mayúsculas ni espacios en los bordes', () => {
        expect(correosCoinciden('ana@gmail.com', ' Ana@Gmail.COM ')).toBe(true)
        expect(correosCoinciden('ana@gmail.com', 'otra@gmail.com')).toBe(false)
    })
})

// ─── Verificación previa de la landing ─────────────────────────────────────

describe('verificación del congresista (landing)', () => {
    it('responde con el modo y el tipo de su inscripción al congreso', async () => {
        sembrarCongresista({ modalidad: 'VIRTUAL' })
        const r = await verificar()
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ nombres: 'Ana', modoAsistencia: 'VIRTUAL', tipo: 'Público general virtual', categoria: 'Público general' })
        expect(dni).not.toHaveBeenCalled()
    })

    it('acepta el correo con otra capitalización', async () => {
        sembrarCongresista()
        expect((await verificar({ tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'ANA@Gmail.com' })).status).toBe(200)
    })

    it('un documento desconocido, un correo distinto y otro evento dan exactamente el mismo error', async () => {
        sembrarCongresista()
        sembrarCongresista({ dni: '22222222', correo: 'luis@gmail.com', eventoId: 3 })
        const desconocido = await verificar({ tipoDocumento: 'dni', numeroDocumento: '99999999', correo: 'ana@gmail.com' })
        const otroCorreo = await verificar({ tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'otra@gmail.com' })
        const otroEvento = await verificar({ tipoDocumento: 'dni', numeroDocumento: '22222222', correo: 'luis@gmail.com' })
        for (const r of [desconocido, otroCorreo, otroEvento]) expect([r.status, r.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        expect(otroCorreo.body.message).toBe(desconocido.body.message)
        expect(otroEvento.body.message).toBe(desconocido.body.message)
    })

    it('dice el motivo solo a quien acertó documento y correo: pago pendiente, en revisión o rechazado', async () => {
        sembrarCongresista({ dni: '11111111', correo: 'a@gmail.com', estado: 'PENDIENTE' })
        sembrarCongresista({ dni: '22222222', correo: 'b@gmail.com', estado: 'EN_REVISION' })
        sembrarCongresista({ dni: '33333333', correo: 'c@gmail.com', estado: 'RECHAZADO' })
        sembrarCongresista({ dni: '44444444', correo: 'd@gmail.com', estado: 'CANCELADO' })
        const motivo = async (numeroDocumento: string, correo: string) => (await verificar({ tipoDocumento: 'dni', numeroDocumento, correo })).body.code
        expect(await motivo('11111111', 'a@gmail.com')).toBe('CONGRESS_PAYMENT_PENDING')
        expect(await motivo('22222222', 'b@gmail.com')).toBe('CONGRESS_PAYMENT_PENDING')
        expect(await motivo('33333333', 'c@gmail.com')).toBe('CONGRESS_REGISTRATION_REJECTED')
        expect(await motivo('44444444', 'd@gmail.com')).toBe('CONGRESS_REGISTRATION_REJECTED')
        expect(await motivo('33333333', 'otra@gmail.com')).toBe('CONGRESS_REGISTRATION_NOT_FOUND')
    })

    it('exige token del evento y correo; con el acceso libre responde 409', async () => {
        sembrarCongresista()
        expect((await request(app).post('/api/v1/site/specialized-talk-eligibility').send({ tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'ana@gmail.com' })).status).toBe(401)
        const sinCorreo = await verificar({ tipoDocumento: 'dni', numeroDocumento: '12345678' })
        expect([sinCorreo.status, sinCorreo.body.code]).toEqual([422, 'VALIDATION_ERROR'])
        evento.ponenciasAccesoLibre = true
        const libre = await verificar()
        expect([libre.status, libre.body.code]).toEqual([409, 'FREE_ACCESS_ENABLED'])
    })
})

// ─── Inscripción desde la landing ──────────────────────────────────────────

describe('inscripción desde la landing con el acceso libre apagado', () => {
    it('inscribe a un congresista aprobado con sus datos del congreso, sin consultar el DNI', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 20 })
        const inscripcionCongresoId = sembrarCongresista({ interno: true })
        const r = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'Ana@Gmail.com', nombres: 'Otro', celular: '911111111' })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ modoAsistencia: 'PRESENCIAL', asistente: { nombres: 'Ana', apellidos: 'Pérez Quispe' }, inscripciones: [{ yaInscrito: false }] })
        expect(m.__bd.asistentes[0]).toMatchObject({ nombres: 'Ana', apellidos: 'Pérez Quispe', correo: 'ana@gmail.com', celular: '987654321', procedencia: 'INTERNO' })
        expect(m.__bd.inscripciones[0]).toMatchObject({ estado: 'INSCRITO', origen: 'LANDING', inscripcionCongresoId, modoAsistencia: 'PRESENCIAL' })
        expect(dni).not.toHaveBeenCalled()
        expect(oficiales).not.toHaveBeenCalled()
    })

    it('exige el correo y rechaza al que no es congresista aprobado sin crear nada', async () => {
        const p = sembrarPonencia(m.__bd)
        sembrarCongresista()
        const sinCorreo = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678' })
        expect([sinCorreo.status, sinCorreo.body.code, Object.keys(sinCorreo.body.fields ?? {})]).toEqual([422, 'VALIDATION_ERROR', ['correo']])
        const otro = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '87654321', correo: 'luis@gmail.com' })
        expect([otro.status, otro.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        const correoAjeno = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'luis@gmail.com' })
        expect([correoAjeno.status, correoAjeno.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        expect(m.__bd.asistentes).toHaveLength(0)
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('con el pago pendiente o rechazado no inscribe', async () => {
        const p = sembrarPonencia(m.__bd)
        sembrarCongresista({ estado: 'EN_REVISION' })
        const pendiente = await inscribirSitio([p.id])
        expect([pendiente.status, pendiente.body.code]).toEqual([422, 'CONGRESS_PAYMENT_PENDING'])
        congreso = []
        sembrarCongresista({ estado: 'RECHAZADO' })
        const rechazado = await inscribirSitio([p.id])
        expect([rechazado.status, rechazado.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_REJECTED'])
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('una cortesía (sin tipo) asiste de forma presencial', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        sembrarCongresista({ modalidad: null })
        const r = await inscribirSitio([p.id])
        expect(r.status).toBe(201)
        expect(r.body.data.modoAsistencia).toBe('PRESENCIAL')
        expect(m.__bd.inscripciones[0].modoAsistencia).toBe('PRESENCIAL')
    })

    it('el cupo es el aforo presencial: un virtual entra aunque esté llena y no resta cupos', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        sembrarCongresista({ dni: '11111111', correo: 'a@gmail.com' })
        sembrarCongresista({ dni: '22222222', correo: 'b@gmail.com' })
        sembrarCongresista({ dni: '33333333', correo: 'c@gmail.com', modalidad: 'VIRTUAL' })
        sembrarCongresista({ dni: '44444444', correo: 'd@gmail.com', modalidad: 'VIRTUAL' })
        const primero = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '11111111', correo: 'a@gmail.com' })
        expect(primero.body.data.inscripciones[0].ponencia).toMatchObject({ cuposDisponibles: 0, llena: true })
        const lleno = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '22222222', correo: 'b@gmail.com' })
        expect([lleno.status, lleno.body.code]).toEqual([409, 'TALK_FULL'])
        const virtual = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '33333333', correo: 'c@gmail.com' })
        expect([virtual.status, virtual.body.data.modoAsistencia]).toEqual([201, 'VIRTUAL'])
        const otroVirtual = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '44444444', correo: 'd@gmail.com' })
        expect(otroVirtual.status).toBe(201)
        expect(m.__bd.inscripciones.map((i) => i.modoAsistencia).sort()).toEqual(['PRESENCIAL', 'VIRTUAL', 'VIRTUAL'])

        const lista = await request(app).get('/api/v1/site/specialized-talks').set(sitio)
        expect(lista.body.data[0]).toMatchObject({ cupo: 1, cuposDisponibles: 0, llena: true })
        expect(lista.body.meta).toEqual({ accesoLibre: false })
    })

    it('repetir es idempotente y valida una inscripción anterior sin validar (y un virtual libera su aforo)', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        const ana = sembrarAsistente(m.__bd)
        const previa = sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        const inscripcionCongresoId = sembrarCongresista({ modalidad: 'VIRTUAL' })
        expect(previa).toMatchObject({ inscripcionCongresoId: null, modoAsistencia: 'PRESENCIAL' })
        const r = await inscribirSitio([p.id])
        expect(r.status).toBe(201)
        expect(r.body.data.inscripciones[0]).toMatchObject({ id: previa.id, yaInscrito: true, ponencia: { cuposDisponibles: 1, llena: false } })
        expect(m.__bd.inscripciones).toHaveLength(1)
        expect(m.__bd.inscripciones[0]).toMatchObject({ inscripcionCongresoId, modoAsistencia: 'VIRTUAL' })
    })

    it('un congresista cancelado en la ponencia puede volver a inscribirse con su modo', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 5 })
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, estado: 'CANCELADO' })
        sembrarCongresista({ modalidad: 'VIRTUAL' })
        const r = await inscribirSitio([p.id])
        expect(r.status).toBe(201)
        expect(m.__bd.inscripciones[0]).toMatchObject({ estado: 'INSCRITO', modoAsistencia: 'VIRTUAL' })
    })
})

// ─── Acceso libre ──────────────────────────────────────────────────────────

describe('con el acceso libre encendido', () => {
    beforeEach(() => {
        evento.ponenciasAccesoLibre = true
    })

    it('la landing inscribe solo con el documento y no mira el congreso', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 20 })
        const r = await inscribirSitio([p.id], { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez' })
        expect(r.status).toBe(201)
        expect(r.body.data.modoAsistencia).toBeNull()
        expect(m.__bd.inscripciones[0]).toMatchObject({ inscripcionCongresoId: null, modoAsistencia: 'PRESENCIAL' })
        expect(m.participante.findUnique).not.toHaveBeenCalled()
        const lista = await request(app).get('/api/v1/site/specialized-talks').set(sitio)
        expect(lista.body.meta).toEqual({ accesoLibre: true })
    })

    it('el staff y la puerta tampoco piden el congreso', async () => {
        const p = sembrarPonencia(m.__bd, { horaInicio: desdeAhora(-10), horaFin: desdeAhora(35) })
        const manual = await inscribirStaff(p.id, { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez' })
        expect(manual.status).toBe(201)
        const puertaMarca = await marcar(p.id, { tipoDocumento: 'dni', numeroDocumento: '12345678' })
        expect(puertaMarca.status).toBe(201)
        expect(puertaMarca.body.data).toMatchObject({ validada: false, modoAsistencia: 'PRESENCIAL' })
        expect(m.participante.findUnique).not.toHaveBeenCalled()
    })
})

// ─── Alta manual del staff ─────────────────────────────────────────────────

describe('inscripción manual con el acceso libre apagado', () => {
    it('basta el documento si es congresista aprobado: toma sus datos del congreso y su modo', async () => {
        const p = sembrarPonencia(m.__bd)
        const inscripcionCongresoId = sembrarCongresista({ modalidad: 'VIRTUAL' })
        const r = await inscribirStaff(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ origen: 'STAFF', validada: true, modoAsistencia: 'VIRTUAL', asistente: { nombres: 'Ana', correo: 'ana@gmail.com' } })
        expect(m.__bd.inscripciones[0]).toMatchObject({ inscripcionCongresoId, modoAsistencia: 'VIRTUAL' })
        expect(dni).not.toHaveBeenCalled()
    })

    it('al staff sí se le dice por qué no puede inscribir', async () => {
        const p = sembrarPonencia(m.__bd)
        const desconocido = await inscribirStaff(p.id)
        expect([desconocido.status, desconocido.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        expect(desconocido.body.message).toMatch(/no está entre los inscritos/)
        sembrarCongresista({ estado: 'PENDIENTE' })
        const pendiente = await inscribirStaff(p.id)
        expect([pendiente.status, pendiente.body.code]).toEqual([422, 'CONGRESS_PAYMENT_PENDING'])
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('respeta el aforo presencial pero no el de los virtuales', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        sembrarCongresista({ dni: '11111111', correo: 'a@gmail.com' })
        sembrarCongresista({ dni: '22222222', correo: 'b@gmail.com' })
        sembrarCongresista({ dni: '33333333', correo: 'c@gmail.com', modalidad: 'VIRTUAL' })
        expect((await inscribirStaff(p.id, { tipoDocumento: 'dni', numeroDocumento: '11111111' })).status).toBe(201)
        const lleno = await inscribirStaff(p.id, { tipoDocumento: 'dni', numeroDocumento: '22222222' })
        expect([lleno.status, lleno.body.code]).toEqual([409, 'TALK_FULL'])
        expect((await inscribirStaff(p.id, { tipoDocumento: 'dni', numeroDocumento: '33333333' })).status).toBe(201)
    })

    it('inscribir a quien ya estaba inscrito sin validar lo valida; si ya estaba validado, 409', async () => {
        const p = sembrarPonencia(m.__bd)
        const ana = sembrarAsistente(m.__bd)
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        const inscripcionCongresoId = sembrarCongresista()
        const validar = await inscribirStaff(p.id)
        expect(validar.status).toBe(201)
        expect(m.__bd.inscripciones[0]).toMatchObject({ inscripcionCongresoId })
        const repetida = await inscribirStaff(p.id)
        expect([repetida.status, repetida.body.code]).toEqual([409, 'ALREADY_REGISTERED'])
    })

    it('reactivar una inscripción sin validar la valida con el documento; sin congreso no se reactiva', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 1 })
        const ana = sembrarAsistente(m.__bd)
        const fila = sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id, estado: 'CANCELADO' })
        const patch = (cuerpoPatch: object) => request(app).patch(`/api/v1/specialized-talk-registrations/${fila.id}`).set(con(gestion())).send(cuerpoPatch)
        const sin = await patch({ estado: 'INSCRITO' })
        expect([sin.status, sin.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        expect(fila.estado).toBe('CANCELADO')
        const inscripcionCongresoId = sembrarCongresista({ modalidad: 'VIRTUAL' })
        const ok = await patch({ estado: 'INSCRITO' })
        expect(ok.status).toBe(200)
        expect(fila).toMatchObject({ estado: 'INSCRITO', inscripcionCongresoId, modoAsistencia: 'VIRTUAL' })
    })
})

// ─── Puerta ────────────────────────────────────────────────────────────────

describe('asistencia en puerta con el acceso libre apagado', () => {
    const enCurso = (datos: Fila = {}) => sembrarPonencia(m.__bd, { horaInicio: desdeAhora(-10), horaFin: desdeAhora(35), ...datos })

    it('inscribe y marca a un congresista aprobado con su modo', async () => {
        const p = enCurso({ cupo: 20 })
        const inscripcionCongresoId = sembrarCongresista()
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ inscripcionNueva: true, validada: true, modoAsistencia: 'PRESENCIAL', ponencia: { inscritos: 1, presenciales: 1, virtuales: 0, asistentes: 1 } })
        expect(m.__bd.inscripciones[0]).toMatchObject({ origen: 'PUERTA', inscripcionCongresoId, modoAsistencia: 'PRESENCIAL' })
    })

    it('rechaza a quien no es congresista aprobado y no crea nada', async () => {
        const p = enCurso()
        const desconocido = await marcar(p.id)
        expect([desconocido.status, desconocido.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
        sembrarCongresista({ estado: 'PENDIENTE' })
        const pendiente = await marcar(p.id)
        expect([pendiente.status, pendiente.body.code]).toEqual([422, 'CONGRESS_PAYMENT_PENDING'])
        expect(m.__bd.asistentes).toHaveLength(0)
        expect(m.__bd.inscripciones).toHaveLength(0)
    })

    it('un virtual se marca igual aunque el aforo esté lleno, y la respuesta lo indica', async () => {
        const p = enCurso({ cupo: 1 })
        const otra = sembrarAsistente(m.__bd, { numeroDocumento: '87654321', nombres: 'Luis' })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: otra.id })
        sembrarCongresista({ modalidad: 'VIRTUAL' })
        const r = await marcar(p.id)
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ modoAsistencia: 'VIRTUAL', ponencia: { inscritos: 2, presenciales: 1, virtuales: 1 } })
        sembrarCongresista({ dni: '55555555', correo: 'e@gmail.com' })
        const lleno = await marcar(p.id, { tipoDocumento: 'dni', numeroDocumento: '55555555' })
        expect([lleno.status, lleno.body.code]).toEqual([409, 'TALK_FULL'])
    })

    it('una inscripción anterior sin validar toma el sello al marcarla; si ya no hay pago aprobado, se rechaza', async () => {
        const p = enCurso()
        const ana = sembrarAsistente(m.__bd)
        const fila = sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: ana.id })
        sembrarCongresista({ estado: 'RECHAZADO' })
        const rechazada = await marcar(p.id)
        expect([rechazada.status, rechazada.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_REJECTED'])
        expect(fila.asistioEn).toBeNull()
        congreso = []
        const inscripcionCongresoId = sembrarCongresista({ modalidad: 'VIRTUAL' })
        const ok = await marcar(p.id)
        expect(ok.status).toBe(201)
        expect(fila).toMatchObject({ inscripcionCongresoId, modoAsistencia: 'VIRTUAL' })
        expect(fila.asistioEn).toBeInstanceOf(Date)
    })
})

// ─── Panel: acceso libre, listado y conteos ────────────────────────────────

describe('panel: interruptor de acceso libre', () => {
    it('quien ve el programa lo consulta y solo quien lo gestiona lo cambia', async () => {
        const ver = await request(app).get('/api/v1/events/2/specialized-talks/access').set(con(comision(['especializadas.ver'])))
        expect([ver.status, ver.body.data]).toEqual([200, { accesoLibre: false }])
        const sinPermiso = await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(comision(['especializadas.ver', 'especializadas.inscribir']))).send({ accesoLibre: true })
        expect(sinPermiso.status).toBe(403)
        const encender = await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({ accesoLibre: true })
        expect([encender.status, encender.body.data]).toEqual([200, { accesoLibre: true }])
        expect(m.evento.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { ponenciasAccesoLibre: true } })
        const apagar = await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({ accesoLibre: false })
        expect(apagar.body.data).toEqual({ accesoLibre: false })
        expect((await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({ accesoLibre: 'si' })).status).toBe(422)
        expect((await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({})).status).toBe(422)
    })

    it('cambiarlo toma efecto de inmediato en la landing', async () => {
        const p = sembrarPonencia(m.__bd)
        const sinCongreso = { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez' }
        expect((await inscribirSitio([p.id], sinCongreso)).status).toBe(422)
        await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({ accesoLibre: true })
        expect((await inscribirSitio([p.id], sinCongreso)).status).toBe(201)
        await request(app).put('/api/v1/events/2/specialized-talks/access').set(con(admin())).send({ accesoLibre: false })
        const otra = await inscribirSitio([p.id], { ...sinCongreso, numeroDocumento: '87654321', correo: 'luis@gmail.com' })
        expect([otra.status, otra.body.code]).toEqual([422, 'CONGRESS_REGISTRATION_NOT_FOUND'])
    })
})

describe('panel: ponencias e inscripciones con modo y validación', () => {
    it('el programa separa inscritos presenciales y virtuales y el cupo solo cuenta los presenciales', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 20 })
        for (const [i, modoAsistencia] of (['PRESENCIAL', 'PRESENCIAL', 'VIRTUAL'] as const).entries()) {
            const a = sembrarAsistente(m.__bd, { numeroDocumento: `1000000${i}` })
            sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: a.id, modoAsistencia })
        }
        const r = await request(app).get('/api/v1/events/2/specialized-talks').set(con(admin()))
        expect(r.body.data[0]).toMatchObject({ inscritos: 3, inscritosPresenciales: 2, inscritosVirtuales: 1, cuposDisponibles: 18 })
    })

    it('no deja bajar el cupo por debajo de los presenciales, pero sí por debajo del total si hay virtuales', async () => {
        const p = sembrarPonencia(m.__bd, { cupo: 5 })
        for (const [i, modoAsistencia] of (['PRESENCIAL', 'PRESENCIAL', 'VIRTUAL', 'VIRTUAL'] as const).entries()) {
            const a = sembrarAsistente(m.__bd, { numeroDocumento: `2000000${i}` })
            sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: a.id, modoAsistencia })
        }
        const menor = await request(app).put(`/api/v1/specialized-talks/${p.id}`).set(con(admin())).send({ cupo: 1 })
        expect([menor.status, menor.body.code]).toEqual([409, 'CAPACITY_BELOW_REGISTERED'])
        const justo = await request(app).put(`/api/v1/specialized-talks/${p.id}`).set(con(admin())).send({ cupo: 2 })
        expect(justo.status).toBe(200)
    })

    it('el listado muestra el congreso de cada inscripción y filtra por validación y modo', async () => {
        const p = sembrarPonencia(m.__bd)
        const a = sembrarAsistente(m.__bd)
        const b = sembrarAsistente(m.__bd, { numeroDocumento: '87654321', nombres: 'Luis' })
        const c = sembrarAsistente(m.__bd, { numeroDocumento: '11112222', nombres: 'Rosa' })
        sembrarInscripcion(m.__bd, {
            ponenciaId: p.id, asistenteId: a.id, inscripcionCongresoId: 9, modoAsistencia: 'VIRTUAL',
            __congreso: { estado: { codigo: 'APROBADO' }, tipoInscripcion: { nombre: 'Estudiante virtual', categoria: { nombre: 'Estudiantes' } } },
        })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: b.id })
        sembrarInscripcion(m.__bd, { ponenciaId: p.id, asistenteId: c.id, estado: 'CANCELADO' })
        const lista = (consulta = '') => request(app).get(`/api/v1/events/2/specialized-talk-registrations${consulta}`).set(con(admin()))

        const todas = await lista()
        expect(todas.body.meta).toMatchObject({ sinValidar: 1 })
        const validada = todas.body.data.find((f: Fila) => f.asistente.nombres === 'Ana')
        expect(validada).toMatchObject({ validada: true, modoAsistencia: 'VIRTUAL', congreso: { estado: 'APROBADO', tipo: 'Estudiante virtual', categoria: 'Estudiantes' } })
        const sinValidar = todas.body.data.find((f: Fila) => f.asistente.nombres === 'Luis')
        expect(sinValidar).toMatchObject({ validada: false, modoAsistencia: 'PRESENCIAL', congreso: null })

        expect((await lista('?validacion=si')).body.data.map((f: Fila) => f.asistente.nombres)).toEqual(['Ana'])
        expect((await lista('?validacion=no&estado=INSCRITO')).body.data.map((f: Fila) => f.asistente.nombres)).toEqual(['Luis'])
        expect((await lista('?modo=VIRTUAL')).body.data.map((f: Fila) => f.asistente.nombres)).toEqual(['Ana'])
        expect((await lista('?modo=PRESENCIAL&estado=INSCRITO')).body.data.map((f: Fila) => f.asistente.nombres)).toEqual(['Luis'])
        expect((await lista('?validacion=quizas')).status).toBe(400)
        expect((await lista('?modo=HIBRIDO')).status).toBe(400)
    })
})

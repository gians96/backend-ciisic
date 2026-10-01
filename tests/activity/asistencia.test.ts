import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aColumnaFecha, fechaLima, instanteLima } from '../../src/core/fechas'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        actividad: { findUnique: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
        asistencia: {
            findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
            updateMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(),
        },
        inscripcion: { findMany: jest.fn(), findUnique: jest.fn() },
        participante: { findMany: jest.fn() },
        evento: { findUnique: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
        $transaction: jest.fn(),
    },
}))

type Fila = Record<string, unknown>
const m = prisma as unknown as {
    actividad: Record<string, jest.Mock>
    asistencia: Record<string, jest.Mock>
    inscripcion: Record<string, jest.Mock>
    participante: Record<string, jest.Mock>
    evento: Record<string, jest.Mock>
    configuracionSistema: Record<string, jest.Mock>
    $transaction: jest.Mock
}

// ─── BD en memoria: lo justo para las consultas del módulo ──────────────────

/** Igualdad, `null`, `{ in }`, `{ not: null }` y filtros sobre una relación (objeto anidado). */
function cumple(fila: Fila, where: Fila = {}): boolean {
    return Object.entries(where).every(([campo, condicion]) => {
        const valor = fila[campo]
        if (condicion === null) return valor === null || valor === undefined
        if (typeof condicion === 'object' && !(condicion instanceof Date)) {
            const c = condicion as { in?: unknown[], not?: unknown }
            if ('in' in c) return (c.in ?? []).includes(valor)
            if ('not' in c) return c.not === null ? valor !== null && valor !== undefined : valor !== c.not
            return Boolean(valor) && cumple(valor as Fila, condicion as Fila)
        }
        return valor === condicion
    })
}

const persona = (id: number, numeroDocumento: string, tipoDocumentoId = 'dni') =>
    ({ id, nombres: 'Persona', apellidos: `Prueba ${id}`, tipoDocumentoId, numeroDocumento, fotoArchivo: null as string | null })
const ANA = { ...persona(100, '12345678'), fotoArchivo: 'foto-123e4567-e89b-42d3-a456-426614174000.jpg' }
const LUIS = persona(101, '87654321')
const DE_OTRO_EVENTO = persona(102, '11112222')
const DNI_REPETIDO = persona(103, '55556666', 'dni')
const CE_REPETIDO = persona(104, '55556666', 'ce')
/** Inscrita después de la spec 014: solo tiene el QR nuevo (sin la marca del QR anterior). */
const NUEVA = persona(105, '44443333')
const PERSONAS = [ANA, LUIS, DE_OTRO_EVENTO, DNI_REPETIDO, CE_REPETIDO, NUEVA]

const APROBADO = { codigo: 'APROBADO' }
const ESTUDIANTE = { nombre: 'Estudiante', etiqueta: 'UNDC' }
const INSCRIPCIONES = [
    { id: 500, eventoId: 2, participante: ANA, estado: APROBADO, codigoCredencial: 'ANA0000001', esQrLegado: true, tipoInscripcion: ESTUDIANTE },
    { id: 501, eventoId: 2, participante: LUIS, estado: { codigo: 'PENDIENTE' }, codigoCredencial: 'LUIS000001', esQrLegado: false, tipoInscripcion: null },
    { id: 502, eventoId: 3, participante: DE_OTRO_EVENTO, estado: APROBADO, codigoCredencial: 'OTRO000001', esQrLegado: true, tipoInscripcion: null },
    // Creada por la imagen anterior durante el despliegue: sin código, su credencial trae el QR anterior
    { id: 503, eventoId: 2, participante: DNI_REPETIDO, estado: APROBADO, codigoCredencial: null, esQrLegado: false, tipoInscripcion: null },
    { id: 504, eventoId: 2, participante: CE_REPETIDO, estado: APROBADO, codigoCredencial: 'CE00000001', esQrLegado: true, tipoInscripcion: null },
    { id: 505, eventoId: 2, participante: NUEVA, estado: APROBADO, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false, tipoInscripcion: null },
]

// La actividad «en curso» abarca una hora antes y después de ahora (hora de Lima)
const ahora = new Date()
const enCurso = (id: number, eventoId: number) => ({
    id, eventoId, nombre: `Actividad ${id}`, fecha: aColumnaFecha(fechaLima(ahora)),
    horaInicio: new Date(ahora.getTime() - 60 * 60 * 1000), horaFin: new Date(ahora.getTime() + 60 * 60 * 1000),
})
const EN_CURSO = 10
const PASADA = 11
const DE_EVENTO_3 = 20

let actividades: Map<number, Fila>
let asistencias: Fila[]
let siguienteId: number
/** Último día (`fechaFin`) de cada evento: el QR anterior vale hasta ese día inclusive. */
let finEvento: Record<number, string>
const HOY = fechaLima(ahora)
const AYER = fechaLima(new Date(ahora.getTime() - 24 * 60 * 60 * 1000))

function reiniciarBd() {
    actividades = new Map<number, Fila>([
        [EN_CURSO, enCurso(EN_CURSO, 2)],
        [PASADA, { id: PASADA, eventoId: 2, nombre: 'Taller pasado', fecha: aColumnaFecha('2026-01-10'), horaInicio: instanteLima('2026-01-10', '09:00'), horaFin: instanteLima('2026-01-10', '11:00') }],
        [DE_EVENTO_3, enCurso(DE_EVENTO_3, 3)],
    ])
    const antes = new Date('2026-01-10T14:30:00.000Z')
    asistencias = [
        { id: 1, actividadId: PASADA, participanteId: ANA.id, registradoEn: antes, metodo: 'QR', registradoPorId: 2, esFueraDeHorario: false, anuladoEn: null, anuladoPorId: null },
        { id: 2, actividadId: PASADA, participanteId: DNI_REPETIDO.id, registradoEn: antes, metodo: 'DOCUMENTO', registradoPorId: 2, esFueraDeHorario: false, anuladoEn: antes, anuladoPorId: 2 },
    ]
    siguienteId = 3
    finEvento = { 2: HOY, 3: HOY }
}

/** Fila de inscripción como la devuelve el `select` del servicio (con la fecha de fin del evento). */
const conEvento = (i: typeof INSCRIPCIONES[number]) => ({ ...i, evento: { fechaFin: aColumnaFecha(finEvento[i.eventoId]) } })

const porClave = (where: Fila) => {
    const par = where.participanteId_actividadId as { participanteId: number, actividadId: number } | undefined
    return asistencias.find((a) => (par ? a.participanteId === par.participanteId && a.actividadId === par.actividadId : a.id === where.id)) ?? null
}

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarBd()
    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve([2, 3].includes(where.id) ? { id: where.id } : null))
    m.configuracionSistema.findUnique.mockResolvedValue(null)
    m.$transaction.mockImplementation((operaciones: Promise<unknown>[]) => Promise.all(operaciones))

    m.actividad.findUnique.mockImplementation(({ where }) => Promise.resolve(actividades.get(where.id) ?? null))
    m.actividad.findMany.mockImplementation(({ where, include }) => Promise.resolve([...actividades.values()]
        .filter((a) => cumple(a, where))
        .map((a) => (include?._count
            ? { ...a, _count: { asistencias: asistencias.filter((x) => x.actividadId === a.id && cumple(x, include._count.select.asistencias.where)).length } }
            : a))))
    m.actividad.delete.mockImplementation(({ where }) => {
        if (asistencias.some((a) => a.actividadId === where.id)) {
            return Promise.reject(new Prisma.PrismaClientKnownRequestError('FK', { code: 'P2003', clientVersion: 'test' }))
        }
        actividades.delete(where.id)
        return Promise.resolve({ id: where.id })
    })

    m.inscripcion.findMany.mockImplementation(({ where, take }) => Promise.resolve(INSCRIPCIONES.filter((i) => cumple(i, where)).slice(0, take).map(conEvento)))
    m.inscripcion.findUnique.mockImplementation(({ where }) => {
        const inscripcion = INSCRIPCIONES.find((i) => i.codigoCredencial === where.codigoCredencial)
        return Promise.resolve(inscripcion ? conEvento(inscripcion) : null)
    })
    m.participante.findMany.mockImplementation(({ where }) => {
        const { eventoId } = where.inscripciones.some
        return Promise.resolve(INSCRIPCIONES.filter((i) => i.eventoId === eventoId && i.estado.codigo === 'APROBADO').map((i) => i.participante))
    })

    m.asistencia.findUnique.mockImplementation(({ where }) => {
        const fila = porClave(where)
        return Promise.resolve(fila ? { ...fila, actividad: actividades.get(fila.actividadId as number) } : null)
    })
    m.asistencia.findFirst.mockImplementation(({ where, select }) => {
        const encontrada = asistencias.find((a) => cumple(a, where))
        return Promise.resolve(encontrada && select ? Object.fromEntries(Object.keys(select).map((campo) => [campo, encontrada[campo]])) : encontrada ?? null)
    })
    m.asistencia.findMany.mockImplementation(({ where, include }) => Promise.resolve(asistencias.filter((a) => cumple(a, where)).map((a) => (include
        ? {
            ...a,
            participante: PERSONAS.find((p) => p.id === a.participanteId),
            registradoPor: a.registradoPorId ? { id: a.registradoPorId, nombres: 'Test', apellidos: 'Staff' } : null,
        }
        : a))))
    m.asistencia.create.mockImplementation(({ data }) => {
        if (porClave({ participanteId_actividadId: data })) {
            return Promise.reject(new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }))
        }
        const fila = { id: siguienteId++, anuladoEn: null, anuladoPorId: null, ...data }
        asistencias.push(fila)
        return Promise.resolve({ id: fila.id })
    })
    m.asistencia.updateMany.mockImplementation(({ where, data }) => {
        const filas = asistencias.filter((a) => cumple(a, where))
        filas.forEach((a) => Object.assign(a, data))
        return Promise.resolve({ count: filas.length })
    })
    m.asistencia.count.mockImplementation(({ where }) => Promise.resolve(asistencias.filter((a) => cumple(a, where)).length))
    m.asistencia.deleteMany.mockImplementation(({ where }) => {
        const antes = asistencias.length
        asistencias = asistencias.filter((a) => !cumple(a, where))
        return Promise.resolve({ count: antes - asistencias.length })
    })
})

// ─── Cuentas ────────────────────────────────────────────────────────────────

const bearer = (token: string) => `Bearer ${token}`
const admin = () => bearer(tokenDeRol('ADMIN'))
const tesorero = () => bearer(tokenDeRol('TESORERO', 30, { eventoIds: [2] }))
/** Comisión del evento 2 que solo marca (implica `asistencia.ver`). */
const comision = () => bearer(tokenDeRol('COMISION', 41, { eventoIds: [2], permisos: ['asistencia.marcar'] }))
const comisionFueraDeHorario = () => bearer(tokenDeRol('COMISION', 42, { eventoIds: [2], permisos: ['asistencia.marcar', 'asistencia.fuera_horario'] }))
const comisionAnula = () => bearer(tokenDeRol('COMISION', 43, { eventoIds: [2], permisos: ['asistencia.anular'] }))

const marcar = (actividadId: number, cuerpo: Fila, autorizacion: string) =>
    request(app).post(`/api/v1/activities/${actividadId}/attendances`).set('Authorization', autorizacion).send(cuerpo)
const fila = (id: number) => asistencias.find((a) => a.id === id)

// ─── Marcar ─────────────────────────────────────────────────────────────────

describe('marcar asistencia', () => {
    it('la Comisión marca con el código de la credencial y queda auditado quién y cómo', async () => {
        const r = await marcar(EN_CURSO, { codigo: 'ANA0000001' }, comision())
        expect(r.status).toBe(201)
        expect(r.body.data).toEqual({
            id: 3,
            registradoEn: expect.any(String),
            metodo: 'QR',
            esFueraDeHorario: false,
            alerta: null,
            // Sin `inscripciones.ver` el documento va enmascarado; la foto se pide con GET /v1/inscriptions/:id/photo
            participante: { id: ANA.id, nombres: 'Persona', apellidos: 'Prueba 100', tipoDocumento: 'dni', numeroDocumento: '****5678', foto: { tiene: true } },
            inscripcion: { id: 500, tipoInscripcion: { nombre: 'Estudiante', etiqueta: 'UNDC' } },
        })
        expect(fila(3)).toMatchObject({ actividadId: EN_CURSO, participanteId: ANA.id, registradoPorId: 41, metodo: 'QR', esFueraDeHorario: false, anuladoEn: null })
        expect(m.inscripcion.findUnique.mock.calls[0][0].where).toEqual({ codigoCredencial: 'ANA0000001' })
    })

    it('por número de documento el método es DOCUMENTO; MANUAL se respeta y sin método el id es QR_LEGADO', async () => {
        const porDocumento = await marcar(EN_CURSO, { numeroDocumento: ANA.numeroDocumento }, comision())
        expect(porDocumento.status).toBe(201)
        expect(porDocumento.body.data).toMatchObject({ metodo: 'DOCUMENTO', alerta: null })
        expect(fila(porDocumento.body.data.id)).toMatchObject({ participanteId: ANA.id, metodo: 'DOCUMENTO' })

        const manual = await marcar(EN_CURSO, { participanteId: DNI_REPETIDO.id, metodo: 'MANUAL' }, admin())
        expect(manual.status).toBe(201)
        expect(manual.body.data).toMatchObject({ metodo: 'MANUAL', alerta: null, participante: { numeroDocumento: DNI_REPETIDO.numeroDocumento } })

        const nulo = await marcar(EN_CURSO, { participanteId: CE_REPETIDO.id, metodo: null }, admin())
        expect(nulo.status).toBe(201)
        expect(nulo.body.data).toMatchObject({ metodo: 'QR_LEGADO', alerta: 'QR_LEGADO' })
    })

    it('el panel no puede declarar QR_LEGADO ni un método desconocido', async () => {
        for (const metodo of ['QR_LEGADO', 'OTRO']) {
            const r = await marcar(EN_CURSO, { participanteId: ANA.id, metodo }, comision())
            expect(r.status).toBe(422)
            expect(r.body.fields).toHaveProperty('metodo')
        }
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('en una actividad de otro evento responde 403 EVENT_NOT_ASSIGNED y en una inexistente 404', async () => {
        const ajena = await marcar(DE_EVENTO_3, { participanteId: DE_OTRO_EVENTO.id }, comision())
        expect(ajena.status).toBe(403)
        expect(ajena.body).toMatchObject({ success: false, code: 'EVENT_NOT_ASSIGNED' })

        const inexistente = await marcar(999, { participanteId: ANA.id }, comision())
        expect(inexistente.status).toBe(404)
        expect(inexistente.body).toMatchObject({ success: false, code: 'NOT_FOUND' })
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('la búsqueda se limita a las inscripciones del evento: una persona de otro evento no existe', async () => {
        for (const cuerpo of [{ participanteId: DE_OTRO_EVENTO.id }, { numeroDocumento: DE_OTRO_EVENTO.numeroDocumento }, { participanteId: 9999 }]) {
            const r = await marcar(EN_CURSO, cuerpo, admin())
            expect(r.status).toBe(404)
            expect(r.body).toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' })
        }
        expect(m.inscripcion.findMany.mock.calls[0][0].where).toEqual({ eventoId: 2, participante: { id: DE_OTRO_EVENTO.id } })
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('un documento repetido en el evento exige el tipo de documento', async () => {
        const ambiguo = await marcar(EN_CURSO, { numeroDocumento: '55556666' }, comision())
        expect(ambiguo.status).toBe(409)
        expect(ambiguo.body).toMatchObject({ code: 'AMBIGUOUS_DOCUMENT' })

        const conTipo = await marcar(EN_CURSO, { numeroDocumento: '55556666', tipoDocumento: 'CE' }, comision())
        expect(conTipo.status).toBe(201)
        expect(conTipo.body.data.participante).toMatchObject({ id: CE_REPETIDO.id, tipoDocumento: 'ce', numeroDocumento: '****6666' })
    })

    it('una inscripción no aprobada responde 403 NOT_APPROVED (por código y por documento)', async () => {
        for (const cuerpo of [{ codigo: 'LUIS000001' }, { numeroDocumento: LUIS.numeroDocumento }]) {
            const r = await marcar(EN_CURSO, cuerpo, comision())
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ code: 'NOT_APPROVED' })
        }
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('fuera de horario exige el permiso asistencia.fuera_horario', async () => {
        const fueraDeVentana = await marcar(PASADA, { participanteId: CE_REPETIDO.id }, comision())
        expect(fueraDeVentana.status).toBe(409)
        expect(fueraDeVentana.body).toMatchObject({ code: 'OUTSIDE_WINDOW' })

        const sinPermiso = await marcar(PASADA, { participanteId: CE_REPETIDO.id, fueraDeHorario: true }, comision())
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body).toMatchObject({ code: 'OUT_OF_HOURS_NOT_ALLOWED' })

        const conPermiso = await marcar(PASADA, { participanteId: CE_REPETIDO.id, fueraDeHorario: true }, comisionFueraDeHorario())
        expect(conPermiso.status).toBe(201)
        expect(conPermiso.body.data.esFueraDeHorario).toBe(true)
        expect(fila(conPermiso.body.data.id)).toMatchObject({ esFueraDeHorario: true, registradoPorId: 42 })
    })

    it('dentro del horario no queda como fuera de horario aunque el panel deje marcada la casilla', async () => {
        const r = await marcar(EN_CURSO, { participanteId: ANA.id, fueraDeHorario: true }, comisionFueraDeHorario())
        expect(r.status).toBe(201)
        expect(r.body.data.esFueraDeHorario).toBe(false)
        expect(fila(r.body.data.id)).toMatchObject({ esFueraDeHorario: false })
    })

    it('una marca repetida responde 409 con la hora del registro previo', async () => {
        expect((await marcar(EN_CURSO, { participanteId: ANA.id }, comision())).status).toBe(201)
        const r = await marcar(EN_CURSO, { participanteId: ANA.id }, admin())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ATTENDANCE_ALREADY_REGISTERED')
        expect(r.body.message).toMatch(/a las \d{2}:\d{2}\.$/)
    })

    it('si otra marca gana la carrera (P2002) responde 409', async () => {
        m.asistencia.findUnique.mockImplementationOnce(() => Promise.resolve(null))
        asistencias.push({ id: 50, actividadId: EN_CURSO, participanteId: ANA.id, registradoEn: new Date(), anuladoEn: null })
        const r = await marcar(EN_CURSO, { participanteId: ANA.id }, comision())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ATTENDANCE_ALREADY_REGISTERED')
    })

    it('anular y volver a marcar reactiva la misma fila con los datos de quien marca', async () => {
        const marcada = await marcar(EN_CURSO, { participanteId: ANA.id }, admin())
        const id = marcada.body.data.id
        expect(fila(id)).toMatchObject({ registradoPorId: 2 })

        const anulada = await request(app).delete(`/api/v1/attendances/${id}`).set('Authorization', comisionAnula())
        expect(anulada.status).toBe(200)
        expect(fila(id)).toMatchObject({ anuladoEn: expect.any(Date), anuladoPorId: 43 })

        const otraVez = await request(app).delete(`/api/v1/attendances/${id}`).set('Authorization', comisionAnula())
        expect(otraVez.status).toBe(404)
        expect(otraVez.body.code).toBe('ATTENDANCE_NOT_FOUND')

        const reactivada = await marcar(EN_CURSO, { numeroDocumento: ANA.numeroDocumento }, comision())
        expect(reactivada.status).toBe(201)
        expect(reactivada.body.data).toMatchObject({ id, metodo: 'DOCUMENTO' })
        expect(fila(id)).toMatchObject({ anuladoEn: null, anuladoPorId: null, registradoPorId: 41, metodo: 'DOCUMENTO' })
        expect(asistencias.filter((a) => a.participanteId === ANA.id && a.actividadId === EN_CURSO)).toHaveLength(1)
    })

    it('el Tesorero no marca asistencia', async () => {
        const r = await marcar(EN_CURSO, { participanteId: ANA.id }, tesorero())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ code: 'FORBIDDEN' })
    })

    it('el Administrador (global) marca en cualquier evento sin resolver el evento', async () => {
        const r = await marcar(DE_EVENTO_3, { participanteId: DE_OTRO_EVENTO.id }, admin())
        expect(r.status).toBe(201)
        expect(r.body.data.participante.numeroDocumento).toBe(DE_OTRO_EVENTO.numeroDocumento)
        expect(fila(r.body.data.id)).toMatchObject({ registradoPorId: 2 })
        // Solo la consulta del servicio: el resolutor (select eventoId) no se usa con cuentas globales
        expect(m.actividad.findUnique).toHaveBeenCalledTimes(1)
        expect(m.actividad.findUnique.mock.calls[0][0]).not.toHaveProperty('select')
    })

    it('sin sesión responde 401', async () => {
        const r = await request(app).post(`/api/v1/activities/${EN_CURSO}/attendances`).send({ participanteId: ANA.id })
        expect(r.status).toBe(401)
    })
})

// ─── Spec 014: código, QR anterior, método y tolerancia ──────────────────────

describe('marcar con el código de la credencial (spec 014)', () => {
    it('acepta minúsculas y espacios del lector y lo busca en mayúsculas', async () => {
        const r = await marcar(EN_CURSO, { codigo: ' k7q2m9x4tb\r\n' }, comision())
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({
            metodo: 'QR',
            alerta: null,
            participante: { id: NUEVA.id, foto: { tiene: false } },
            inscripcion: { id: 505, tipoInscripcion: null },
        })
        expect(m.inscripcion.findUnique.mock.calls[0][0].where).toEqual({ codigoCredencial: 'K7Q2M9X4TB' })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('el código de otro evento responde 409 CODE_OTHER_EVENT sin datos de la persona', async () => {
        const r = await marcar(EN_CURSO, { codigo: 'OTRO000001' }, admin())
        expect(r.status).toBe(409)
        expect(r.body).toEqual({ success: false, code: 'CODE_OTHER_EVENT', message: expect.any(String) })
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('un código inexistente responde 404 CODE_NOT_FOUND y uno mal formado 422', async () => {
        const inexistente = await marcar(EN_CURSO, { codigo: 'ZZZZZZZZZZ' }, comision())
        expect(inexistente.status).toBe(404)
        expect(inexistente.body).toMatchObject({ code: 'CODE_NOT_FOUND' })

        for (const codigo of ['ANA000001', 'ANA00000011', 'ANA-000001']) {
            const r = await marcar(EN_CURSO, { codigo }, comision())
            expect(r.status).toBe(422)
            expect(r.body.fields).toHaveProperty('codigo')
        }
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('exige exactamente un identificador y el tipo de documento solo con el documento', async () => {
        const cuerpos: Fila[] = [
            {},
            { codigo: 'ANA0000001', participanteId: ANA.id },
            { codigo: 'ANA0000001', numeroDocumento: ANA.numeroDocumento },
            { numeroDocumento: ANA.numeroDocumento, participanteId: ANA.id },
            { codigo: 'ANA0000001', tipoDocumento: 'dni' },
        ]
        for (const cuerpo of cuerpos) {
            const r = await marcar(EN_CURSO, cuerpo, comision())
            expect(r.status).toBe(422)
            expect(r.body.code).toBe('VALIDATION_ERROR')
        }
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
        expect(m.inscripcion.findUnique).not.toHaveBeenCalled()
    })

    it('el método declarado QR o DOCUMENTO no cambia el método deducido', async () => {
        const codigo = await marcar(EN_CURSO, { codigo: 'ANA0000001', metodo: 'DOCUMENTO' }, comision())
        expect(codigo.body.data).toMatchObject({ metodo: 'QR', alerta: null })
        // El panel de la spec 013 envía { participanteId, metodo: 'QR' }: sigue funcionando, como QR anterior
        const id = await marcar(EN_CURSO, { participanteId: CE_REPETIDO.id, metodo: 'QR' }, comision())
        expect(id.status).toBe(201)
        expect(id.body.data).toMatchObject({ metodo: 'QR_LEGADO', alerta: 'QR_LEGADO' })
        expect(fila(id.body.data.id)).toMatchObject({ metodo: 'QR_LEGADO' })
    })
})

describe('QR anterior (participanteId) (spec 014)', () => {
    it('se acepta con esQrLegado hasta el último día del evento, como QR_LEGADO y con alerta', async () => {
        const r = await marcar(EN_CURSO, { participanteId: ANA.id }, comision())
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({
            metodo: 'QR_LEGADO',
            alerta: 'QR_LEGADO',
            participante: { id: ANA.id, foto: { tiene: true } },
            inscripcion: { id: 500, tipoInscripcion: { nombre: 'Estudiante', etiqueta: 'UNDC' } },
        })
        expect(fila(r.body.data.id)).toMatchObject({ metodo: 'QR_LEGADO', registradoPorId: 41 })
    })

    it('se acepta sin la marca si la inscripción no tiene código (la creó la imagen anterior)', async () => {
        const r = await marcar(EN_CURSO, { participanteId: DNI_REPETIDO.id }, comision())
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ metodo: 'QR_LEGADO', alerta: 'QR_LEGADO', inscripcion: { id: 503 } })
    })

    it('se rechaza con 422 LEGACY_QR_NOT_ALLOWED sin la marca y con código propio', async () => {
        const r = await marcar(EN_CURSO, { participanteId: NUEVA.id }, comisionFueraDeHorario())
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ success: false, code: 'LEGACY_QR_NOT_ALLOWED' })
        expect(m.asistencia.create).not.toHaveBeenCalled()

        // Con su código nuevo sí entra
        expect((await marcar(EN_CURSO, { codigo: 'K7Q2M9X4TB' }, comision())).status).toBe(201)
    })

    it('se rechaza después del último día del evento (hora de Lima); el código nuevo sigue valiendo', async () => {
        finEvento[2] = AYER
        for (const cuerpo of [{ participanteId: ANA.id }, { participanteId: DNI_REPETIDO.id }, { participanteId: ANA.id, fueraDeHorario: true }]) {
            const r = await marcar(EN_CURSO, cuerpo, comisionFueraDeHorario())
            expect(r.status).toBe(422)
            expect(r.body).toMatchObject({ code: 'LEGACY_QR_NOT_ALLOWED', message: expect.stringContaining(AYER) })
        }
        expect(m.asistencia.create).not.toHaveBeenCalled()

        const conCodigo = await marcar(EN_CURSO, { codigo: 'ANA0000001' }, comision())
        expect(conCodigo.status).toBe(201)
        expect(conCodigo.body.data).toMatchObject({ metodo: 'QR', alerta: null })
    })

    it('la ruta legacy aplica la misma regla de plazo', async () => {
        finEvento[2] = AYER
        const r = await request(app).post('/api/v1/attendances').set('Authorization', admin()).send({ id_usuario: ANA.id, id_evento: EN_CURSO })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('LEGACY_QR_NOT_ALLOWED')
    })
})

describe('marca MANUAL (spec 014)', () => {
    it('exige asistencia.fuera_horario: sin él responde 403 MANUAL_NOT_ALLOWED antes de buscar', async () => {
        const r = await marcar(EN_CURSO, { participanteId: NUEVA.id, metodo: 'MANUAL' }, comision())
        expect(r.status).toBe(403)
        expect(r.body).toMatchObject({ code: 'MANUAL_NOT_ALLOWED' })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
        expect(m.asistencia.create).not.toHaveBeenCalled()
    })

    it('con el permiso registra MANUAL sin la regla del QR anterior y sin alerta', async () => {
        finEvento[2] = AYER
        const r = await marcar(EN_CURSO, { participanteId: NUEVA.id, metodo: 'MANUAL' }, comisionFueraDeHorario())
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ metodo: 'MANUAL', alerta: null, esFueraDeHorario: false })
        expect(fila(r.body.data.id)).toMatchObject({ metodo: 'MANUAL', registradoPorId: 42 })

        const porDocumento = await marcar(EN_CURSO, { numeroDocumento: ANA.numeroDocumento, metodo: 'MANUAL' }, comisionFueraDeHorario())
        expect(porDocumento.body.data).toMatchObject({ metodo: 'MANUAL', alerta: null })
    })
})

describe('tolerancia de 30 min antes del inicio (spec 014)', () => {
    const PROXIMA = 30
    const empiezaEn = (minutos: number) => {
        const inicio = Date.now() + minutos * 60 * 1000
        actividades.set(PROXIMA, {
            id: PROXIMA, eventoId: 2, nombre: 'Próxima', fecha: aColumnaFecha(fechaLima(ahora)),
            horaInicio: new Date(inicio), horaFin: new Date(inicio + 60 * 60 * 1000),
        })
    }

    it('dentro de los 30 min previos se marca y no queda como fuera de horario', async () => {
        empiezaEn(20)
        const r = await marcar(PROXIMA, { codigo: 'ANA0000001' }, comision())
        expect(r.status).toBe(201)
        expect(r.body.data.esFueraDeHorario).toBe(false)
        expect(fila(r.body.data.id)).toMatchObject({ esFueraDeHorario: false })
    })

    it('antes de los 30 min previos responde 409 OUTSIDE_WINDOW; con el permiso queda fuera de horario', async () => {
        empiezaEn(40)
        const temprano = await marcar(PROXIMA, { codigo: 'ANA0000001' }, comision())
        expect(temprano.status).toBe(409)
        expect(temprano.body).toMatchObject({ code: 'OUTSIDE_WINDOW', message: expect.stringMatching(/desde \d{2}:\d{2} hasta \d{2}:\d{2}/) })

        const conPermiso = await marcar(PROXIMA, { codigo: 'ANA0000001', fueraDeHorario: true }, comisionFueraDeHorario())
        expect(conPermiso.status).toBe(201)
        expect(conPermiso.body.data.esFueraDeHorario).toBe(true)
    })
})

// ─── Anular ─────────────────────────────────────────────────────────────────

describe('anular asistencia', () => {
    it('sin asistencia.anular responde 403 y no toca la fila', async () => {
        for (const autorizacion of [comision(), tesorero()]) {
            const r = await request(app).delete('/api/v1/attendances/1').set('Authorization', autorizacion)
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect(fila(1)).toMatchObject({ anuladoEn: null })
    })

    it('una cuenta por evento no anula marcas de otro evento; una marca ya anulada da 404', async () => {
        asistencias.push({ id: 60, actividadId: DE_EVENTO_3, participanteId: DE_OTRO_EVENTO.id, registradoEn: new Date(), anuladoEn: null })
        const ajena = await request(app).delete('/api/v1/attendances/60').set('Authorization', comisionAnula())
        expect(ajena.status).toBe(403)
        expect(ajena.body.code).toBe('EVENT_NOT_ASSIGNED')

        const yaAnulada = await request(app).delete('/api/v1/attendances/2').set('Authorization', admin())
        expect(yaAnulada.status).toBe(404)
        expect(yaAnulada.body.code).toBe('ATTENDANCE_NOT_FOUND')
    })
})

// ─── Lecturas ───────────────────────────────────────────────────────────────

describe('lecturas de asistencia', () => {
    it('el listado excluye las anuladas y enmascara el documento sin inscripciones.ver', async () => {
        const r = await request(app).get(`/api/v1/activities/${PASADA}/attendances`).set('Authorization', comision())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual([{
            id: 1,
            registradoEn: '2026-01-10T14:30:00.000Z',
            metodo: 'QR',
            esFueraDeHorario: false,
            registradoPor: { id: 2, nombres: 'Test', apellidos: 'Staff' },
            participante: { id: ANA.id, nombres: 'Persona', apellidos: 'Prueba 100', tipoDocumento: 'dni', numeroDocumento: '****5678' },
        }])

        const conDocumento = await request(app).get(`/api/v1/activities/${PASADA}/attendances`).set('Authorization', tesorero())
        expect(conDocumento.status).toBe(200)
        expect(conDocumento.body.data[0].participante.numeroDocumento).toBe(ANA.numeroDocumento)
    })

    it('el listado de otro evento responde 403 EVENT_NOT_ASSIGNED y sin asistencia.ver 403', async () => {
        expect((await request(app).get(`/api/v1/activities/${DE_EVENTO_3}/attendances`).set('Authorization', comision())).body.code).toBe('EVENT_NOT_ASSIGNED')
        const sinVer = await request(app).get(`/api/v1/activities/${PASADA}/attendances`)
            .set('Authorization', bearer(tokenDeRol('COMISION', 44, { eventoIds: [2], permisos: ['mensajes.ver'] })))
        expect(sinVer.status).toBe(403)
        expect(sinVer.body.code).toBe('FORBIDDEN')
    })

    it('las actividades del evento se ven con asistencia.ver y cuentan solo las vigentes', async () => {
        const r = await request(app).get('/api/v1/events/2/activities').set('Authorization', comision())
        expect(r.status).toBe(200)
        expect(r.body.data.find((a: Fila) => a.id === PASADA)).toMatchObject({ totalAsistencias: 1 })

        const ajeno = await request(app).get('/api/v1/events/3/activities').set('Authorization', comision())
        expect(ajeno.status).toBe(403)
        expect(ajeno.body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it('la exportación exige asistencia.exportar y la matriz no cuenta las anuladas', async () => {
        const sinPermiso = await request(app).get('/api/v1/events/2/attendances/export').set('Authorization', comision())
        expect(sinPermiso.status).toBe(403)
        expect(sinPermiso.body.code).toBe('FORBIDDEN')

        const r = await request(app).get('/api/v1/events/2/attendances/export').set('Authorization', tesorero())
        expect(r.status).toBe(200)
        const marcas = Object.fromEntries(r.body.data.participantes.map((p: { id: number, asistencias: Record<string, number> }) => [p.id, p.asistencias[PASADA]]))
        expect(marcas).toMatchObject({ [ANA.id]: 1, [DNI_REPETIDO.id]: 0 })
        expect(m.asistencia.findMany.mock.calls[0][0].where).toMatchObject({ anuladoEn: null })

        const ajeno = await request(app).get('/api/v1/events/3/attendances/export').set('Authorization', tesorero())
        expect(ajeno.status).toBe(403)
        expect(ajeno.body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it('la exportación enmascara el documento sin inscripciones.ver', async () => {
        const exporta = bearer(tokenDeRol('COMISION', 45, { eventoIds: [2], permisos: ['asistencia.exportar'] }))
        const r = await request(app).get('/api/v1/events/2/attendances/export').set('Authorization', exporta)
        expect(r.status).toBe(200)
        const documentos = r.body.data.participantes.map((p: { numeroDocumento: string }) => p.numeroDocumento)
        expect(documentos.length).toBeGreaterThan(0)
        expect(documentos.every((d: string) => /^\*{4}\d{4}$/.test(d))).toBe(true)
        expect(r.body.data.participantes.find((p: { id: number }) => p.id === ANA.id)).toMatchObject({ numeroDocumento: '****5678' })

        // Con inscripciones.ver (el Tesorero) sale completo
        const completo = await request(app).get('/api/v1/events/2/attendances/export').set('Authorization', tesorero())
        expect(completo.body.data.participantes.find((p: { id: number }) => p.id === ANA.id)).toMatchObject({ numeroDocumento: ANA.numeroDocumento })
    })
})

// ─── Actividades ────────────────────────────────────────────────────────────

describe('configuración de actividades', () => {
    it('crear, editar y borrar exigen eventos.configurar', async () => {
        for (const autorizacion of [comision(), tesorero()]) {
            expect((await request(app).post('/api/v1/events/2/activities').set('Authorization', autorizacion).send({})).status).toBe(403)
            expect((await request(app).put(`/api/v1/activities/${EN_CURSO}`).set('Authorization', autorizacion).send({})).status).toBe(403)
            expect((await request(app).delete(`/api/v1/activities/${EN_CURSO}`).set('Authorization', autorizacion)).status).toBe(403)
        }
        expect(actividades.has(EN_CURSO)).toBe(true)
    })

    it('una actividad con solo asistencias anuladas se borra junto con ellas', async () => {
        asistencias = asistencias.filter((a) => a.id !== 1)
        const r = await request(app).delete(`/api/v1/activities/${PASADA}`).set('Authorization', admin())
        expect(r.status).toBe(200)
        expect(actividades.has(PASADA)).toBe(false)
        expect(asistencias.some((a) => a.actividadId === PASADA)).toBe(false)
    })

    it('una actividad con asistencias vigentes no se borra', async () => {
        const r = await request(app).delete(`/api/v1/activities/${PASADA}`).set('Authorization', admin())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ACTIVITY_HAS_ATTENDANCE')
        expect(actividades.has(PASADA)).toBe(true)
        expect(asistencias).toHaveLength(2)
    })

    it('si alguien marca mientras se borra, la FK (P2003) responde el mismo 409', async () => {
        // El conteo no ve la marca (llegó después); el borrado de la actividad choca con ella
        m.asistencia.count.mockResolvedValueOnce(0)
        const r = await request(app).delete(`/api/v1/activities/${PASADA}`).set('Authorization', admin())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('ACTIVITY_HAS_ATTENDANCE')
        expect(m.actividad.delete).toHaveBeenCalledWith({ where: { id: PASADA } })
        expect(actividades.has(PASADA)).toBe(true)
    })
})

// ─── Legacy ─────────────────────────────────────────────────────────────────

describe('rutas legacy de asistencia', () => {
    const legacy = [
        ['post', '/api/v1/attendances', { id_usuario: ANA.id, id_evento: EN_CURSO }],
        ['post', '/api/v1/attendances/overtime', { id_usuario: ANA.id, id_evento: PASADA }],
        ['post', '/api/v1/attendances/export', { eventos: [PASADA] }],
        ['get', '/api/v1/attendances/1', undefined],
    ] as const
    const llamar = (method: 'get' | 'post', path: string, cuerpo: unknown, autorizacion?: string) => {
        const r = request(app)[method](path)
        if (autorizacion) r.set('Authorization', autorizacion)
        return cuerpo ? r.send(cuerpo as object) : r
    }

    it.each(legacy)('%s %s responde 403 al Tesorero y a la Comisión', async (method, path, cuerpo) => {
        for (const autorizacion of [tesorero(), comisionFueraDeHorario()]) {
            const r = await llamar(method, path, cuerpo, autorizacion)
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
    })

    it('registran al actor que marca y la búsqueda sigue limitada al evento', async () => {
        // id_usuario es el QR anterior: QR_LEGADO con su regla y el aviso para el operador
        const r = await llamar('post', '/api/v1/attendances', { id_usuario: ANA.id, id_evento: EN_CURSO }, admin())
        expect(r.status).toBe(201)
        expect(r.body).toMatchObject({ metodo: 'QR_LEGADO', alerta: 'QR_LEGADO', esFueraDeHorario: false })
        expect(fila(r.body.id)).toMatchObject({ registradoPorId: 2, metodo: 'QR_LEGADO' })

        const fuera = await llamar('post', '/api/v1/attendances/overtime', { id_usuario: CE_REPETIDO.id, id_evento: PASADA }, admin())
        expect(fuera.status).toBe(201)
        expect(fila(fuera.body.id)).toMatchObject({ esFueraDeHorario: true, registradoPorId: 2 })

        const ajena = await llamar('post', '/api/v1/attendances', { id_usuario: DE_OTRO_EVENTO.id, id_evento: EN_CURSO }, admin())
        expect(ajena.status).toBe(404)
        expect(ajena.body.code).toBe('PARTICIPANT_NOT_FOUND')

        // Quien solo tiene el QR nuevo no se marca por id ni siquiera por la ruta legacy
        const sinQrAnterior = await llamar('post', '/api/v1/attendances', { id_usuario: NUEVA.id, id_evento: EN_CURSO }, admin())
        expect(sinQrAnterior.status).toBe(422)
        expect(sinQrAnterior.body.code).toBe('LEGACY_QR_NOT_ALLOWED')
    })

    it('la consulta legacy conserva sus campos y oculta las anuladas', async () => {
        const vigente = await llamar('get', '/api/v1/attendances/1', undefined, admin())
        expect(vigente.status).toBe(200)
        expect(vigente.body).toEqual({ id: 1, registradoEn: '2026-01-10T14:30:00.000Z', participanteId: ANA.id, actividadId: PASADA })

        const anulada = await llamar('get', '/api/v1/attendances/2', undefined, admin())
        expect(anulada.status).toBe(404)
        expect(anulada.body.code).toBe('ATTENDANCE_NOT_FOUND')
    })

    it('responden 410 si las rutas legacy están desactivadas', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, rutasLegacyActivas: false, undcApiTimeoutMs: 8000 })
        reiniciarCacheConfiguracion()
        try {
            for (const [method, path, cuerpo] of legacy) {
                const r = await llamar(method, path, cuerpo, tesorero())
                expect(r.status).toBe(410)
                expect(r.body.code).toBe('LEGACY_ROUTE_DISABLED')
            }
        } finally {
            reiniciarCacheConfiguracion()
        }
    })
})

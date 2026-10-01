import request from 'supertest'
import { Prisma } from '@prisma/client'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { REGEX_CODIGO } from '../../src/api/certificate/codigos/codigo'
import { consultarDni } from '../../src/api/document-lookup/services/lookup'
import { MAX_CONSULTAS_DNI_IMPORTACION } from '../../src/api/certificate/services/destinatarios'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Emisión de certificados (spec 015): individual, desde los inscritos y por lista, sobre una «BD»
 * en memoria que respeta las claves únicas (clave vigente, número por evento y código).
 */
jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        evento: { findUnique: jest.fn() },
        tipoCertificado: { findUnique: jest.fn() },
        plantillaCertificado: { findUnique: jest.fn() },
        ponencia: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
        certificado: { findMany: jest.fn(), aggregate: jest.fn(), create: jest.fn(), createMany: jest.fn() },
        inscripcion: { findMany: jest.fn() },
        actividad: { findMany: jest.fn() },
        asistencia: { groupBy: jest.fn() },
        personaConsultada: { findUnique: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
    }
    mock.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mock))
    return { prisma: mock }
})
jest.mock('../../src/api/document-lookup/services/lookup', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/lookup'),
    consultarDni: jest.fn(),
}))

type Mock = jest.Mock
const m = prisma as unknown as Record<string, Record<string, Mock>> & { $transaction: Mock }
const dni = consultarDni as unknown as Mock

const EVENTO = 2
const OTRO_EVENTO = 3
const PONENCIA_1 = '6f1c2a4e-3b5d-4c7e-9f10-1a2b3c4d5e6f'
const PONENCIA_2 = '7a2d3b5f-4c6e-4d8f-8a21-2b3c4d5e6f70'
const PONENCIA_OTRA = '8b3e4c6a-5d7f-4e9a-9b32-3c4d5e6f7081'

interface Persona { id: number, tipoDocumentoId: string, numeroDocumento: string, nombres: string, apellidos: string, correo: string, celular: string }
interface Cert { id: number, eventoId: number, participanteId: number, tipoCertificadoId: number, plantillaId: number, inscripcionId: number | null, ponenciaId: string | null, numero: number, codigo: string, claveVigente: string | null, estado: string, nombreImpreso: string, tipoDocumento: string, numeroDocumento: string, detalle: string | null, horas: number | null, fechaEmision: Date, emitidoPorId: number }

let personas: Persona[]
let certificados: Cert[]
let inscripciones: { id: number, eventoId: number, tipoInscripcionId: number, estado: string, participanteId: number }[]
let asistencias: { participanteId: number, actividadId: number, anuladoEn: Date | null }[]

const p2002 = (target: string) => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target } })

/** Las claves únicas de `certificados`, como en MySQL (una fila repetida aborta el INSERT completo). */
function insertar(filas: Omit<Cert, 'id'>[]): Cert[] {
    const nuevas: Cert[] = []
    for (const fila of filas) {
        const todas = [...certificados, ...nuevas]
        if (fila.claveVigente && todas.some((c) => c.claveVigente === fila.claveVigente)) throw p2002('uq_certificados_clave_vigente')
        if (todas.some((c) => c.eventoId === fila.eventoId && c.numero === fila.numero)) throw p2002('uq_certificados_evento_numero')
        if (todas.some((c) => c.codigo === fila.codigo)) throw p2002('uq_certificados_codigo')
        nuevas.push({ ...fila, id: certificados.length + nuevas.length + 1 })
    }
    certificados.push(...nuevas)
    return nuevas
}

const TIPOS: Record<string, { id: number, codigo: string, activo: boolean }> = {
    PARTICIPANTE: { id: 1, codigo: 'PARTICIPANTE', activo: true },
    ORGANIZADOR: { id: 2, codigo: 'ORGANIZADOR', activo: true },
    PONENTE: { id: 3, codigo: 'PONENTE', activo: true },
    COMITE: { id: 4, codigo: 'COMITE', activo: false },
}
const PLANTILLAS: Record<number, { id: number, eventoId: number, activa: boolean, horasPorDefecto: number | null }> = {
    4: { id: 4, eventoId: EVENTO, activa: true, horasPorDefecto: 20 },
    5: { id: 5, eventoId: OTRO_EVENTO, activa: true, horasPorDefecto: null },
    6: { id: 6, eventoId: EVENTO, activa: false, horasPorDefecto: null },
}

const persona = (id: number, numeroDocumento: string, correo: string, nombres = 'Ana', apellidos = 'Pérez Quispe'): Persona =>
    ({ id, tipoDocumentoId: 'dni', numeroDocumento, nombres, apellidos, correo, celular: '' })

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    personas = [persona(50, '12345678', 'ana@gmail.com'), persona(51, '87654321', 'luis@gmail.com', 'Luis', 'Rojas Díaz'), persona(52, '11112222', 'eva@gmail.com', 'Eva', 'Soto Ríos')]
    certificados = []
    inscripciones = [
        { id: 101, eventoId: EVENTO, tipoInscripcionId: 1, estado: 'APROBADO', participanteId: 50 },
        { id: 102, eventoId: EVENTO, tipoInscripcionId: 2, estado: 'APROBADO', participanteId: 51 },
        { id: 103, eventoId: EVENTO, tipoInscripcionId: 1, estado: 'APROBADO', participanteId: 52 },
        { id: 104, eventoId: EVENTO, tipoInscripcionId: 1, estado: 'PENDIENTE', participanteId: 53 },
    ]
    asistencias = []

    m.evento.findUnique.mockImplementation(async ({ where }) => ([EVENTO, OTRO_EVENTO].includes(where.id) ? { id: where.id, fechaInicio: new Date('2026-10-26T00:00:00Z') } : null))
    m.configuracionSistema.findUnique.mockResolvedValue(null)
    m.tipoCertificado.findUnique.mockImplementation(async ({ where }) => TIPOS[where.codigo] ?? null)
    m.plantillaCertificado.findUnique.mockImplementation(async ({ where }) => PLANTILLAS[where.id] ?? null)
    m.ponencia.findUnique.mockImplementation(async ({ where }) => ({ [PONENCIA_1]: { id: PONENCIA_1, eventoId: EVENTO }, [PONENCIA_2]: { id: PONENCIA_2, eventoId: EVENTO }, [PONENCIA_OTRA]: { id: PONENCIA_OTRA, eventoId: OTRO_EVENTO } })[where.id as string] ?? null)
    m.personaConsultada.findUnique.mockResolvedValue(null)

    m.participante.findUnique.mockImplementation(async ({ where }) => {
        if (where.id !== undefined) return personas.find((p) => p.id === where.id) ?? null
        if (where.correo !== undefined) return personas.find((p) => p.correo === where.correo) ?? null
        const { tipoDocumentoId, numeroDocumento } = where.tipoDocumentoId_numeroDocumento
        return personas.find((p) => p.tipoDocumentoId === tipoDocumentoId && p.numeroDocumento === numeroDocumento) ?? null
    })
    m.participante.findMany.mockImplementation(async ({ where }) => {
        if (where.OR) return personas.filter((p) => where.OR.some((d: { tipoDocumentoId: string, numeroDocumento: string }) => d.tipoDocumentoId === p.tipoDocumentoId && d.numeroDocumento === p.numeroDocumento))
        return personas.filter((p) => where.correo.in.includes(p.correo))
    })
    m.participante.create.mockImplementation(async ({ data }) => {
        const nueva = { ...data, id: 200 + personas.length, googleSub: null, googleVinculadoEn: null, creadoEn: new Date(), actualizadoEn: new Date() }
        personas.push(nueva)
        return nueva
    })

    m.certificado.aggregate.mockImplementation(async ({ where }) => ({ _max: { numero: Math.max(0, ...certificados.filter((c) => c.eventoId === where.eventoId).map((c) => c.numero)) || null } }))
    m.certificado.create.mockImplementation(async ({ data }) => {
        const [creado] = insertar([data])
        return { ...creado, tipo: { id: creado.tipoCertificadoId, codigo: 'X', nombre: 'X', textoImpreso: 'X' }, plantilla: { id: creado.plantillaId, nombre: 'Diseño', version: 1, firmasRequeridas: 1 }, plantillaVersion: null, archivoGenerado: null, archivoFirmado: null }
    })
    m.certificado.createMany.mockImplementation(async ({ data }) => ({ count: insertar(data).length }))
    m.certificado.findMany.mockImplementation(async ({ where }) => certificados.filter((c) => c.claveVigente && where.claveVigente.in.includes(c.claveVigente)).map((c) => ({ claveVigente: c.claveVigente })))

    m.inscripcion.findMany.mockImplementation(async ({ where }) => inscripciones
        .filter((i) => i.eventoId === where.eventoId && i.estado === where.estado.codigo && (!where.tipoInscripcionId || where.tipoInscripcionId.in.includes(i.tipoInscripcionId)))
        .map((i) => ({ id: i.id, participante: personas.find((p) => p.id === i.participanteId) ?? persona(i.participanteId, '99999999', `p${i.participanteId}@gmail.com`) })))
    m.actividad.findMany.mockImplementation(async ({ where }) => [11, 12, 13, 14].filter((id) => !where.id || where.id.in.includes(id)).filter(() => where.eventoId === EVENTO).map((id) => ({ id })))
    m.asistencia.groupBy.mockImplementation(async ({ where }) => {
        const cuenta = new Map<number, number>()
        for (const a of asistencias) {
            if (!where.actividadId.in.includes(a.actividadId) || a.anuladoEn !== where.anuladoEn) continue
            cuenta.set(a.participanteId, (cuenta.get(a.participanteId) ?? 0) + 1)
        }
        return [...cuenta].map(([participanteId, n]) => ({ participanteId, _count: { _all: n } }))
    })
    dni.mockImplementation(async (numero: string) => ({ numero, nombres: 'NOMBRE', apellidoPaterno: 'PATERNO', apellidoMaterno: 'MATERNO', fuente: 'PROVEEDOR', proveedor: 'DECOLECTA' }))
})

const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const emitir = (body: Record<string, unknown>, auth = ADMIN(), eventoId = EVENTO) =>
    request(app).post(`/api/v1/events/${eventoId}/certificates`).set('Authorization', auth).send(body)
const desdeInscritos = (body: Record<string, unknown>, auth = ADMIN()) =>
    request(app).post(`/api/v1/events/${EVENTO}/certificates/from-inscriptions`).set('Authorization', auth).send(body)
const importar = (body: Record<string, unknown>, auth = ADMIN()) =>
    request(app).post(`/api/v1/events/${EVENTO}/certificates/import`).set('Authorization', auth).send(body)

describe('permisos de la emisión (certificados.gestionar)', () => {
    it.each([
        ['Tesorero', () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [EVENTO] })}`],
        ['Comisión con operar', () => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [EVENTO], permisos: ['certificados.operar'] })}`],
    ])('%s → 403 en las tres formas de emitir', async (_rol, token) => {
        const body = { tipoCodigo: 'PARTICIPANTE', plantillaId: 4, participanteId: 50, filtro: {}, filas: [{ numeroDocumento: '12345678', correo: 'a@b.pe' }] }
        for (const r of [await emitir(body, token()), await desdeInscritos(body, token()), await importar(body, token())]) {
            expect(r.status).toBe(403)
        }
        expect(certificados).toHaveLength(0)
    })
})

// ─── Individual ──────────────────────────────────────────────────────────────

describe('POST /v1/events/:eventId/certificates (individual)', () => {
    it('a un participante existente: PENDIENTE, código <PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>, copia del nombre y documento', async () => {
        const r = await emitir({ participanteId: 50, tipoCodigo: 'participante', plantillaId: 4, detalle: 'Asistente', fechaEmision: '2026-10-31' })
        expect(r.status).toBe(201)
        const { certificado } = r.body.data
        expect(certificado.codigo).toMatch(REGEX_CODIGO)
        expect(certificado.codigo).toMatch(/^CIISIC-2026-000001-/)
        expect(certificado).toMatchObject({ estado: 'PENDIENTE', numero: 1, nombreImpreso: 'Ana Pérez Quispe', numeroDocumento: '12345678', horas: 20, detalle: 'Asistente', fechaEmision: '2026-10-31' })
        expect(r.body.data.participante).toEqual({ id: 50, nuevo: false })
        expect(certificados[0]).toMatchObject({ claveVigente: `${EVENTO}:50:1:-`, plantillaId: 4, tipoDocumento: 'dni', emitidoPorId: 2, inscripcionId: null })
    })

    it('usa el prefijo configurado y numera de forma consecutiva por evento', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ certificadosPrefijo: 'UNDCFI', certificadosProveedor: 'LOCAL', certificadosProveedorConfirmado: false, rutasLegacyActivas: true })
        await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        const r = await emitir({ participanteId: 51, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(r.body.data.certificado.codigo).toMatch(/^UNDCFI-2026-000002-[0-9A-HJKMNP-TV-Z]{6}$/)
    })

    it('repetido → 409 CERTIFICATE_EXISTS sin gastar un número; tras anular se vuelve a emitir', async () => {
        await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        const repetido = await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(repetido.status).toBe(409)
        expect(repetido.body.code).toBe('CERTIFICATE_EXISTS')
        expect(m.certificado.create).toHaveBeenCalledTimes(1)
        Object.assign(certificados[0], { estado: 'ANULADO', claveVigente: null })
        const reemision = await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(reemision.status).toBe(201)
        expect(reemision.body.data.certificado.numero).toBe(2)
    })

    it('ponenciaId distingue dos certificados PONENTE de la misma persona', async () => {
        expect((await emitir({ participanteId: 51, tipoCodigo: 'PONENTE', plantillaId: 4, ponenciaId: PONENCIA_1 })).status).toBe(201)
        expect((await emitir({ participanteId: 51, tipoCodigo: 'PONENTE', plantillaId: 4, ponenciaId: PONENCIA_2 })).status).toBe(201)
        expect((await emitir({ participanteId: 51, tipoCodigo: 'PONENTE', plantillaId: 4, ponenciaId: PONENCIA_1 })).status).toBe(409)
        expect(certificados.map((c) => c.claveVigente)).toEqual([`${EVENTO}:51:3:${PONENCIA_1}`, `${EVENTO}:51:3:${PONENCIA_2}`])
        const otra = await emitir({ participanteId: 51, tipoCodigo: 'PONENTE', plantillaId: 4, ponenciaId: PONENCIA_OTRA })
        expect(otra.status).toBe(422)
        expect(otra.body.code).toBe('PAPER_OTHER_EVENT')
    })

    it('persona nueva por documento: se registra con el servicio de participantes (nombres del DNI)', async () => {
        const r = await emitir({ persona: { tipoDocumento: 'dni', numeroDocumento: '44445555', correo: 'Org@UNDC.edu.pe' }, tipoCodigo: 'ORGANIZADOR', plantillaId: 4, horas: 40 })
        expect(r.status).toBe(201)
        expect(r.body.data.participante.nuevo).toBe(true)
        expect(r.body.data.certificado).toMatchObject({ nombreImpreso: 'NOMBRE PATERNO MATERNO', horas: 40, numeroDocumento: '44445555' })
        expect(m.participante.create.mock.calls[0][0].data).toMatchObject({ correo: 'org@undc.edu.pe', tipoDocumentoId: 'dni', celular: '' })
        expect(dni).toHaveBeenCalledWith('44445555', 'PANEL')
    })

    it('persona ya registrada con otro correo: se conserva el registrado y se avisa', async () => {
        const r = await emitir({ persona: { tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'otro@gmail.com' }, tipoCodigo: 'ORGANIZADOR', plantillaId: 4 })
        expect(r.status).toBe(201)
        expect(r.body.data.participante).toEqual({ id: 50, nuevo: false })
        expect(r.body.data.avisos).toEqual([expect.objectContaining({ codigo: 'CORREO_CONSERVADO' })])
        expect(m.participante.create).not.toHaveBeenCalled()
        expect(personas[0].correo).toBe('ana@gmail.com')
    })

    it('correo de otra persona → 409 EMAIL_IN_USE y no se crea nada', async () => {
        const r = await emitir({ persona: { tipoDocumento: 'dni', numeroDocumento: '44445555', correo: 'luis@gmail.com' }, tipoCodigo: 'ORGANIZADOR', plantillaId: 4 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EMAIL_IN_USE')
        expect(certificados).toHaveLength(0)
    })

    it('se valida el certificado antes de registrar a nadie (plantilla de otro evento, inactiva, tipo inactivo)', async () => {
        const nueva = { persona: { tipoDocumento: 'dni', numeroDocumento: '44445555', correo: 'org@undc.edu.pe' } }
        for (const [cuerpo, codigo] of [
            [{ ...nueva, tipoCodigo: 'ORGANIZADOR', plantillaId: 5 }, 'TEMPLATE_OTHER_EVENT'],
            [{ ...nueva, tipoCodigo: 'ORGANIZADOR', plantillaId: 6 }, 'TEMPLATE_INACTIVE'],
            [{ ...nueva, tipoCodigo: 'COMITE', plantillaId: 4 }, 'CERTIFICATE_TYPE_INACTIVE'],
            [{ ...nueva, tipoCodigo: 'NO_EXISTE', plantillaId: 4 }, 'CERTIFICATE_TYPE_NOT_FOUND'],
        ] as const) {
            const r = await emitir(cuerpo)
            expect(r.status).toBe(422)
            expect(r.body.code).toBe(codigo)
        }
        const sinPlantilla = await emitir({ ...nueva, tipoCodigo: 'ORGANIZADOR', plantillaId: 99 })
        expect(sinPlantilla.status).toBe(404)
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('422 VALIDATION_ERROR: sin plantilla, sin tipo, sin correo, con participanteId y persona a la vez', async () => {
        const sinPlantilla = await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE' })
        expect(sinPlantilla.status).toBe(422)
        expect(sinPlantilla.body.fields).toHaveProperty('plantillaId')
        const sinCorreo = await emitir({ persona: { tipoDocumento: 'dni', numeroDocumento: '44445555' }, plantillaId: 4 })
        expect(Object.keys(sinCorreo.body.fields)).toEqual(expect.arrayContaining(['persona.correo', 'tipoCodigo']))
        const ambos = await emitir({ participanteId: 50, persona: { tipoDocumento: 'dni', numeroDocumento: '44445555', correo: 'a@b.pe' }, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(ambos.status).toBe(422)
        const ninguno = await emitir({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(ninguno.status).toBe(422)
        expect(certificados).toHaveLength(0)
    })

    it('participante o evento inexistentes → 404', async () => {
        expect((await emitir({ participanteId: 999, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })).body.code).toBe('PARTICIPANT_NOT_FOUND')
        expect((await emitir({ participanteId: 50, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 }, ADMIN(), 99)).body.code).toBe('EVENT_NOT_FOUND')
    })
})

// ─── Desde los inscritos ─────────────────────────────────────────────────────

describe('POST /v1/events/:eventId/certificates/from-inscriptions', () => {
    it('simular cuenta los aprobados, lo ya emitido y los excluidos por asistencia (sin anuladas) y no crea nada', async () => {
        // 50: 3/4 (75 %), 51: 2/4 pero una anulada → 1/4 (25 %), 52: 2/4 (50 %)
        asistencias = [
            ...[11, 12, 13].map((actividadId) => ({ participanteId: 50, actividadId, anuladoEn: null })),
            { participanteId: 51, actividadId: 11, anuladoEn: null }, { participanteId: 51, actividadId: 12, anuladoEn: new Date() },
            { participanteId: 52, actividadId: 11, anuladoEn: null }, { participanteId: 52, actividadId: 14, anuladoEn: null },
        ]
        await emitir({ participanteId: 52, tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        const r = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, filtro: { asistenciaMinima: 50 }, simular: true })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ simular: true, candidatos: 3, crear: 1, yaEmitidos: 1, excluidos: 1 })
        const muestra = Object.fromEntries(r.body.data.muestra.map((f: { participanteId: number }) => [f.participanteId, f]))
        expect(muestra[50]).toMatchObject({ resultado: 'CREAR', inscripcionId: 101, asistencia: { marcadas: 3, total: 4, porcentaje: 75 } })
        expect(muestra[51]).toMatchObject({ resultado: 'EXCLUIDO', asistencia: { marcadas: 1, total: 4, porcentaje: 25 } })
        expect(muestra[52].resultado).toBe('YA_EMITIDO')
        expect(certificados).toHaveLength(1)
        expect(m.asistencia.groupBy.mock.calls[0][0].where).toEqual({ actividadId: { in: [11, 12, 13, 14] }, anuladoEn: null })
    })

    it('emite lo que falta (201), con la inscripción de origen, y repetir es idempotente', async () => {
        const r = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, horas: 30, fechaEmision: '2026-10-31' })
        expect(r.status).toBe(201)
        expect(r.body.data).toEqual({ simular: false, candidatos: 3, creados: 3, yaEmitidos: 0, excluidos: 0 })
        expect(certificados.map((c) => [c.participanteId, c.inscripcionId, c.numero, c.horas])).toEqual([[50, 101, 1, 30], [51, 102, 2, 30], [52, 103, 3, 30]])
        expect(new Set(certificados.map((c) => c.codigo)).size).toBe(3)
        const otra = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(otra.body.data).toEqual({ simular: false, candidatos: 3, creados: 0, yaEmitidos: 3, excluidos: 0 })
        expect(certificados).toHaveLength(3)
    })

    it('filtra por tipo de inscripción y por actividades elegidas', async () => {
        asistencias = [{ participanteId: 50, actividadId: 11, anuladoEn: null }]
        const r = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, filtro: { tipoInscripcionIds: [1], actividadIds: [11, 12], asistenciaMinima: 50 }, simular: true })
        expect(r.body.data).toMatchObject({ candidatos: 2, crear: 1, excluidos: 1 })
        expect(m.inscripcion.findMany.mock.calls[0][0].where).toMatchObject({ eventoId: EVENTO, estado: { codigo: 'APROBADO' }, tipoInscripcionId: { in: [1] } })
    })

    it('si otra emisión simultánea creó alguno, ese bloque se repite uno por uno y se informa como ya emitido', async () => {
        // Entre la lectura de lo ya emitido y el INSERT aparece el de la persona 51
        m.certificado.findMany.mockImplementationOnce(async () => {
            insertar([{ eventoId: EVENTO, participanteId: 51, tipoCertificadoId: 1, plantillaId: 4, inscripcionId: 102, ponenciaId: null, numero: 1, codigo: 'CIISIC-2026-000001-AAAAAA', claveVigente: `${EVENTO}:51:1:-`, estado: 'PENDIENTE', nombreImpreso: 'Luis', tipoDocumento: 'dni', numeroDocumento: '87654321', detalle: null, horas: null, fechaEmision: new Date(), emitidoPorId: 1 }])
            return []
        })
        const r = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4 })
        expect(r.body.data).toMatchObject({ creados: 2, yaEmitidos: 1 })
        expect(certificados.map((c) => c.numero).sort()).toEqual([1, 2, 3])
    })

    it('actividades de otro evento o filtro sin asistencia mínima → 422', async () => {
        const otra = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, filtro: { actividadIds: [11, 99], asistenciaMinima: 50 } })
        expect(otra.status).toBe(422)
        expect(otra.body.code).toBe('ACTIVITY_OTHER_EVENT')
        const sinMinima = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, filtro: { actividadIds: [11] } })
        expect(sinMinima.status).toBe(422)
        expect(sinMinima.body.fields).toHaveProperty(['filtro.asistenciaMinima'])
        const fuera = await desdeInscritos({ tipoCodigo: 'PARTICIPANTE', plantillaId: 4, filtro: { asistenciaMinima: 120 } })
        expect(fuera.status).toBe(422)
        expect(certificados).toHaveLength(0)
    })
})

// ─── Por lista ───────────────────────────────────────────────────────────────

describe('POST /v1/events/:eventId/certificates/import', () => {
    const filas = () => [
        { tipoDocumento: 'DNI', numeroDocumento: '12345678', correo: 'ana@gmail.com', detalle: 'Comité organizador' }, // 1 registrada
        { numeroDocumento: '44445555', correo: 'nuevo@undc.edu.pe', horas: '12' }, // 2 nueva
        { numeroDocumento: '1234', correo: 'malo@gmail.com' }, // 3 DNI inválido
        { numeroDocumento: '44445555', correo: 'otro@gmail.com' }, // 4 repetida en la lista
        { numeroDocumento: '66667777', correo: 'luis@gmail.com' }, // 5 correo de otra persona
        { numeroDocumento: '87654321', correo: 'cambio@gmail.com' }, // 6 registrada con otro correo
        { tipoDocumento: 'ce', numeroDocumento: '001234567', correo: 'ce@gmail.com' }, // 7 CE sin nombres
        { numeroDocumento: '88889999', correo: 'horas@gmail.com', horas: 'muchas' }, // 8 horas inválidas
    ]

    it('simular: resultado por fila y nada creado', async () => {
        const r = await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: filas(), simular: true })
        expect(r.status).toBe(200)
        const por = r.body.data.filas.map((f: { resultado: string, codigo: string | null }) => [f.resultado, f.codigo])
        expect(por).toEqual([
            ['CREAR', null], ['CREAR', null], ['ERROR', 'INVALID_ROW'], ['ERROR', 'DUPLICATE_ROW'], ['ERROR', 'EMAIL_IN_USE'],
            ['CREAR', 'CORREO_CONSERVADO'], ['ERROR', 'NAMES_REQUIRED'], ['ERROR', 'INVALID_ROW'],
        ])
        expect(r.body.data.resumen).toEqual({ total: 8, porCrear: 3, creados: 0, yaEmitidos: 0, errores: 5 })
        expect(r.body.data.filas[1].participante).toEqual({ id: null, nuevo: true })
        expect(certificados).toHaveLength(0)
        expect(m.participante.create).not.toHaveBeenCalled()
        expect(dni).not.toHaveBeenCalled()
    })

    it('emite (201), registra a las personas nuevas y volver a enviar la lista es seguro', async () => {
        const r = await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: filas() })
        expect(r.status).toBe(201)
        expect(r.body.data.resumen).toMatchObject({ creados: 3, errores: 5 })
        expect(r.body.data.filas[1]).toMatchObject({ resultado: 'CREADO', participante: { nuevo: true } })
        expect(certificados.map((c) => [c.numeroDocumento, c.detalle, c.horas])).toEqual([['12345678', 'Comité organizador', 20], ['44445555', null, 12], ['87654321', null, 20]])
        const otra = await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: filas() })
        expect(otra.body.data.resumen).toMatchObject({ creados: 0, yaEmitidos: 3 })
        expect(certificados).toHaveLength(3)
    })

    it(`como mucho ${MAX_CONSULTAS_DNI_IMPORTACION} consultas DNI por envío; las de la caché no cuentan`, async () => {
        const muchas = Array.from({ length: MAX_CONSULTAS_DNI_IMPORTACION + 2 }, (_, i) => ({ numeroDocumento: String(70000000 + i), correo: `p${i}@gmail.com` }))
        m.personaConsultada.findUnique.mockImplementation(async ({ where }) => (where.tipoDocumento_numeroDocumento.numeroDocumento === '70000000'
            ? { numeroDocumento: '70000000', nombres: 'EN', apellidoPaterno: 'CACHE', apellidoMaterno: 'X', consultadoEn: new Date() }
            : null))
        const r = await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: muchas })
        const limite = r.body.data.filas.filter((f: { codigo: string | null }) => f.codigo === 'LOOKUP_LIMIT')
        expect(limite).toHaveLength(1)
        expect(r.body.data.resumen.creados).toBe(MAX_CONSULTAS_DNI_IMPORTACION + 1)
    })

    it('más de 300 filas → 422 IMPORT_TOO_LARGE; lista vacía o sin plantilla → 422', async () => {
        const grande = await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: Array.from({ length: 301 }, () => ({ numeroDocumento: '12345678', correo: 'a@b.pe' })) })
        expect(grande.status).toBe(422)
        expect(grande.body.code).toBe('IMPORT_TOO_LARGE')
        expect((await importar({ tipoCodigo: 'ORGANIZADOR', plantillaId: 4, filas: [] })).status).toBe(422)
        const sinPlantilla = await importar({ tipoCodigo: 'ORGANIZADOR', filas: [{ numeroDocumento: '12345678', correo: 'a@b.pe' }] })
        expect(sinPlantilla.body.fields).toHaveProperty('plantillaId')
    })
})

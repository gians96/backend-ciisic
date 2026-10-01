import fs from 'fs'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_PLANTILLAS_CERTIFICADO, nuevoNombrePlantilla } from '../../src/core/almacenamiento'
import { eliminarEvento } from '../../src/api/event/services/event'
import { eliminarInscripcion } from '../../src/api/inscription/services/inscription'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/**
 * Certificados (spec 015): listado, detalle, edición y borrado, con sus permisos; y los 409 al
 * borrar eventos o inscripciones con certificados.
 */
jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        certificado: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
        evento: { findUnique: jest.fn(), delete: jest.fn() },
        plantillaCertificado: { findUnique: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
        inscripcion: { count: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        ponencia: { count: jest.fn() },
        asistencia: { count: jest.fn() },
        tipoInscripcion: { deleteMany: jest.fn() },
        categoriaInscripcion: { deleteMany: jest.fn() },
        actividad: { deleteMany: jest.fn() },
        $transaction: jest.fn(async (operaciones: unknown[]) => operaciones),
    }
    return { prisma: mock }
})
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoAprobacion: jest.fn() }))

type Mock = jest.Mock
const m = prisma as unknown as {
    certificado: Record<'count' | 'findMany' | 'groupBy' | 'findUnique' | 'updateMany' | 'deleteMany', Mock>
    evento: { findUnique: Mock, delete: Mock }
    plantillaCertificado: { findUnique: Mock, findMany: Mock, deleteMany: Mock }
    inscripcion: { count: Mock, findUnique: Mock, delete: Mock }
    ponencia: { count: Mock }
    asistencia: { count: Mock }
    $transaction: Mock
}

const EVENTO = 2
const OTRO_EVENTO = 3
const ahora = new Date('2026-11-02T15:00:00.000Z')

function certificado(cambios: Record<string, unknown> = {}) {
    return {
        id: 7, eventoId: EVENTO, participanteId: 50, tipoCertificadoId: 1, plantillaId: 4, inscripcionId: 9, ponenciaId: null,
        numero: 7, codigo: 'CIISIC-2026-000007-7KQ2XM', claveVigente: `${EVENTO}:50:1:-`, estado: 'PREPARADO',
        nombreImpreso: 'María José Ñahuinlla', tipoDocumento: 'dni', numeroDocumento: '12345678', detalle: null, horas: 20,
        fechaEmision: new Date('2026-10-31T00:00:00.000Z'), codigoImpreso: 'CIISIC-2026-000007-7KQ2XM',
        urlVerificacion: 'https://admin.example.pe/verificar/CIISIC-2026-000007-7KQ2XM', plantillaVersion: 1, generacion: 'ABCDEFGH',
        archivoGenerado: 'CIISIC-2026-000007-7KQ2XM-ABCDEFGH.pdf', hashGenerado: 'a'.repeat(64), bytesGenerado: 1000, generadoEn: ahora,
        descargadoParaFirmarEn: null, archivoFirmado: null, hashFirmado: null, firmasDetectadas: 0, coincidencia: null, motivoForzado: null,
        firmadoEn: null, codigoExterno: null, registroExterno: 'NO_APLICA', registroExternoError: null, registradoExternoEn: null,
        anuladoEn: null, motivoAnulacion: null, emitidoPorId: 2, editadoPorId: null, firmadoCargadoPorId: null, anuladoPorId: null,
        creadoEn: ahora, actualizadoEn: ahora,
        tipo: { id: 1, codigo: 'PARTICIPANTE', nombre: 'Participante', textoImpreso: 'PARTICIPANTE' },
        plantilla: { id: 4, nombre: 'Diseño general', version: 1, firmasRequeridas: 1 },
        evento: { id: EVENTO, codigo: 'ciisic-viii-2026', nombreCorto: 'VIII CIISIC' },
        participante: { nombres: 'María José', apellidos: 'Ñahuinlla Güemes' },
        emitidoPor: { id: 2, nombres: 'Test', apellidos: 'Administrador' }, editadoPor: null, firmadoCargadoPor: null, anuladoPor: null,
        ...cambios,
    }
}

const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const TESORERO = () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [EVENTO] })}`
const COMISION = (permisos = ['certificados.ver']) => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [EVENTO], permisos })}`

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => ([EVENTO, OTRO_EVENTO].includes(where.id) ? { id: where.id, codigo: 'ciisic', datosPago: null } : null))
    m.certificado.count.mockResolvedValue(1)
    m.certificado.findMany.mockResolvedValue([certificado()])
    m.certificado.groupBy.mockResolvedValue([{ estado: 'PREPARADO', _count: { _all: 1 } }, { estado: 'PENDIENTE', _count: { _all: 3 } }])
    m.certificado.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => (where.id === 7 ? certificado() : where.id === 8 ? certificado({ id: 8, eventoId: OTRO_EVENTO }) : null))
    m.certificado.updateMany.mockResolvedValue({ count: 1 })
    m.certificado.deleteMany.mockResolvedValue({ count: 1 })
    m.plantillaCertificado.findUnique.mockResolvedValue({ id: 5, eventoId: EVENTO, activa: true, horasPorDefecto: null })
})

// ─── Acceso ──────────────────────────────────────────────────────────────────

describe('acceso', () => {
    it('sin sesión 401; con sesión de participante 403', async () => {
        expect((await request(app).get(`/api/v1/events/${EVENTO}/certificates`)).status).toBe(401)
        const r = await request(app).get(`/api/v1/events/${EVENTO}/certificates`).set('Authorization', `Bearer ${tokenDeParticipante()}`)
        expect(r.status).toBe(403)
        expect(m.certificado.findMany).not.toHaveBeenCalled()
    })

    it('el Tesorero ve los certificados de su evento, pero no edita ni borra', async () => {
        expect((await request(app).get(`/api/v1/events/${EVENTO}/certificates`).set('Authorization', TESORERO())).status).toBe(200)
        expect((await request(app).get('/api/v1/certificates/7').set('Authorization', TESORERO())).status).toBe(200)
        for (const r of [
            await request(app).put('/api/v1/certificates/7').set('Authorization', TESORERO()).send({ detalle: 'x' }),
            await request(app).delete('/api/v1/certificates/7').set('Authorization', TESORERO()),
        ]) {
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        expect(m.certificado.deleteMany).not.toHaveBeenCalled()
    })

    it('la Comisión con «ver» no entra a un evento que no tiene asignado (por ruta ni por id)', async () => {
        const porRuta = await request(app).get(`/api/v1/events/${OTRO_EVENTO}/certificates`).set('Authorization', COMISION())
        expect(porRuta.status).toBe(403)
        expect(porRuta.body.code).toBe('EVENT_NOT_ASSIGNED')
        const porId = await request(app).get('/api/v1/certificates/8').set('Authorization', COMISION())
        expect(porId.status).toBe(403)
        expect(porId.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect((await request(app).get('/api/v1/certificates/999').set('Authorization', COMISION())).status).toBe(404)
    })

    it('la Comisión con «operar» tampoco edita ni borra (es de certificados.gestionar)', async () => {
        const token = COMISION(['certificados.operar'])
        expect((await request(app).put('/api/v1/certificates/7').set('Authorization', token).send({})).status).toBe(403)
        expect((await request(app).delete('/api/v1/certificates/7').set('Authorization', token)).status).toBe(403)
    })
})

// ─── Listado y detalle ───────────────────────────────────────────────────────

describe('GET /v1/events/:eventId/certificates', () => {
    it('pagina, resume por estado en meta y no expone archivos, hashes ni rutas', async () => {
        const r = await request(app).get(`/api/v1/events/${EVENTO}/certificates?page=2&pageSize=5`).set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.body.meta).toEqual({ page: 2, pageSize: 5, total: 1, resumen: { PENDIENTE: 3, PREPARADO: 1, EN_FIRMA: 0, FIRMADO: 0, ANULADO: 0 } })
        expect(m.certificado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventoId: EVENTO }, skip: 5, take: 5, orderBy: { numero: 'asc' } }))
        const [fila] = r.body.data
        expect(fila).toMatchObject({ id: 7, codigo: 'CIISIC-2026-000007-7KQ2XM', estado: 'PREPARADO', numeroDocumento: '12345678', tieneGenerado: true, tieneFirmado: false, fechaEmision: '2026-10-31' })
        const texto = JSON.stringify(r.body)
        for (const secreto of ['archivoGenerado', 'archivoFirmado', 'hashGenerado', 'ABCDEFGH.pdf', 'a'.repeat(64), 'claveVigente']) expect(texto).not.toContain(secreto)
    })

    it('filtra por estado (lista), tipo, plantilla y texto; el resumen ignora el filtro de estado', async () => {
        const r = await request(app).get(`/api/v1/events/${EVENTO}/certificates?estado=pendiente,PREPARADO&tipo=ponente&plantillaId=4&q=maria`).set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        const base = {
            eventoId: EVENTO,
            tipo: { codigo: 'PONENTE' },
            plantillaId: 4,
            OR: [
                { nombreImpreso: { contains: 'maria' } },
                { codigo: { contains: 'MARIA' } },
                { codigoImpreso: { contains: 'MARIA' } },
                { numeroDocumento: { contains: 'maria' } },
            ],
        }
        expect(m.certificado.findMany.mock.calls[0][0].where).toEqual({ ...base, estado: { in: ['PENDIENTE', 'PREPARADO'] } })
        expect(m.certificado.groupBy.mock.calls[0][0].where).toEqual(base)
    })

    it('estado desconocido o plantillaId inválido → 422 con el campo', async () => {
        const r1 = await request(app).get(`/api/v1/events/${EVENTO}/certificates?estado=VALIDO`).set('Authorization', ADMIN())
        expect(r1.status).toBe(422)
        expect(r1.body.fields).toHaveProperty('estado')
        const r2 = await request(app).get(`/api/v1/events/${EVENTO}/certificates?plantillaId=abc`).set('Authorization', ADMIN())
        expect(r2.status).toBe(422)
        expect(r2.body.fields).toHaveProperty('plantillaId')
    })

    it('sin certificados.gestionar el documento sale enmascarado y no se busca por documento', async () => {
        const r = await request(app).get(`/api/v1/events/${EVENTO}/certificates?q=5678`).set('Authorization', COMISION())
        expect(r.status).toBe(200)
        expect(r.body.data[0].numeroDocumento).toBe('****5678')
        expect(JSON.stringify(r.body)).not.toContain('12345678')
        expect(JSON.stringify(m.certificado.findMany.mock.calls[0][0].where)).not.toContain('numeroDocumento')
    })

    it('evento inexistente → 404', async () => {
        const r = await request(app).get('/api/v1/events/99/certificates').set('Authorization', ADMIN())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('EVENT_NOT_FOUND')
    })
})

describe('GET /v1/certificates/:id', () => {
    it('detalle con la URL de verificación y la auditoría; documento completo solo con gestionar', async () => {
        const admin = await request(app).get('/api/v1/certificates/7').set('Authorization', ADMIN())
        expect(admin.status).toBe(200)
        expect(admin.body.data).toMatchObject({
            id: 7, numeroDocumento: '12345678', urlVerificacion: 'https://admin.example.pe/verificar/CIISIC-2026-000007-7KQ2XM',
            evento: { id: EVENTO, codigo: 'ciisic-viii-2026' }, emitidoPor: { id: 2 }, plantillaDesactualizada: false,
        })
        expect(JSON.stringify(admin.body)).not.toContain('archivoGenerado')
        const comision = await request(app).get('/api/v1/certificates/7').set('Authorization', COMISION())
        expect(comision.body.data.numeroDocumento).toBe('****5678')
    })

    it('inexistente → 404 CERTIFICATE_NOT_FOUND; id mal formado → 400', async () => {
        const r = await request(app).get('/api/v1/certificates/999').set('Authorization', ADMIN())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('CERTIFICATE_NOT_FOUND')
        expect((await request(app).get('/api/v1/certificates/abc').set('Authorization', ADMIN())).status).toBe(400)
    })

    it('señala el generado de una versión anterior de la plantilla', async () => {
        m.certificado.findUnique.mockResolvedValueOnce(certificado({ plantillaVersion: 1, plantilla: { id: 4, nombre: 'Diseño', version: 2, firmasRequeridas: 1 } }))
        const r = await request(app).get('/api/v1/certificates/7').set('Authorization', ADMIN())
        expect(r.body.data.plantillaDesactualizada).toBe(true)
    })
})

// ─── Edición ─────────────────────────────────────────────────────────────────

describe('PUT /v1/certificates/:id', () => {
    it('cambia el contenido, vuelve a PENDIENTE, descarta la generación y registra quién lo editó', async () => {
        const r = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN())
            .send({ nombreImpreso: '  María José Ñahuinlla Güemes ', detalle: 'Ponencia: IA', horas: 24, plantillaId: 5, fechaEmision: '2026-11-01' })
        expect(r.status).toBe(200)
        const { where, data } = m.certificado.updateMany.mock.calls[0][0]
        expect(where).toEqual({ id: 7, estado: { in: ['PENDIENTE', 'PREPARADO'] } })
        expect(data).toMatchObject({
            estado: 'PENDIENTE', editadoPorId: 2, generacion: null, hashGenerado: null, bytesGenerado: null, descargadoParaFirmarEn: null,
            nombreImpreso: 'María José Ñahuinlla Güemes', detalle: 'Ponencia: IA', horas: 24, plantillaId: 5,
        })
        expect(data.fechaEmision.toISOString()).toBe('2026-11-01T00:00:00.000Z')
        // El código, el código impreso y la URL quedan congelados
        expect(data).not.toHaveProperty('codigo')
        expect(data).not.toHaveProperty('codigoImpreso')
        expect(data).not.toHaveProperty('urlVerificacion')
    })

    it('sincronizarNombre toma los nombres actuales del participante', async () => {
        await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ sincronizarNombre: true })
        expect(m.certificado.updateMany.mock.calls[0][0].data.nombreImpreso).toBe('María José Ñahuinlla Güemes')
    })

    it.each(['EN_FIRMA', 'FIRMADO', 'ANULADO'])('%s → 409 CERTIFICATE_LOCKED', async (estado) => {
        m.certificado.findUnique.mockResolvedValueOnce(certificado({ estado }))
        const r = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ detalle: 'x' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('CERTIFICATE_LOCKED')
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })

    it('ya descargado para firmar: 409 CERTIFICATE_SENT_TO_SIGN salvo confirmar', async () => {
        m.certificado.findUnique.mockResolvedValue(certificado({ descargadoParaFirmarEn: ahora }))
        const sin = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ detalle: 'x' })
        expect(sin.status).toBe(409)
        expect(sin.body.code).toBe('CERTIFICATE_SENT_TO_SIGN')
        const con = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ detalle: 'x', confirmar: true })
        expect(con.status).toBe(200)
    })

    it('una carga de firmados simultánea gana: la edición responde 409', async () => {
        m.certificado.updateMany.mockResolvedValueOnce({ count: 0 })
        m.certificado.findUnique.mockResolvedValueOnce(certificado()).mockResolvedValueOnce({ estado: 'FIRMADO' })
        const r = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ detalle: 'x' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('CERTIFICATE_LOCKED')
    })

    it('plantilla de otro evento o inactiva → 422; datos inválidos → 422 VALIDATION_ERROR', async () => {
        m.plantillaCertificado.findUnique.mockResolvedValueOnce({ id: 5, eventoId: OTRO_EVENTO, activa: true, horasPorDefecto: null })
        const otra = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ plantillaId: 5 })
        expect(otra.status).toBe(422)
        expect(otra.body.code).toBe('TEMPLATE_OTHER_EVENT')
        m.plantillaCertificado.findUnique.mockResolvedValueOnce({ id: 5, eventoId: EVENTO, activa: false, horasPorDefecto: null })
        expect((await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ plantillaId: 5 })).body.code).toBe('TEMPLATE_INACTIVE')
        const invalido = await request(app).put('/api/v1/certificates/7').set('Authorization', ADMIN()).send({ horas: -1, fechaEmision: '2026-02-31', nombreImpreso: 'x' })
        expect(invalido.status).toBe(422)
        expect(Object.keys(invalido.body.fields).sort()).toEqual(['fechaEmision', 'horas', 'nombreImpreso'])
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })
})

// ─── Borrado ─────────────────────────────────────────────────────────────────

describe('DELETE /v1/certificates/:id', () => {
    it('borra un PENDIENTE que nunca se generó (condicionado a que siga así)', async () => {
        m.certificado.findUnique.mockResolvedValueOnce({ estado: 'PENDIENTE', generadoEn: null })
        const r = await request(app).delete('/api/v1/certificates/7').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(m.certificado.deleteMany).toHaveBeenCalledWith({ where: { id: 7, estado: 'PENDIENTE', generadoEn: null } })
    })

    it.each([
        ['PREPARADO', ahora],
        ['PENDIENTE', ahora], // editado tras generarse: su código ya se imprimió
        ['FIRMADO', ahora],
    ])('%s (generado %s) → 409 CERTIFICATE_LOCKED', async (estado, generadoEn) => {
        m.certificado.findUnique.mockResolvedValueOnce({ estado, generadoEn })
        const r = await request(app).delete('/api/v1/certificates/7').set('Authorization', ADMIN())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('CERTIFICATE_LOCKED')
        expect(m.certificado.deleteMany).not.toHaveBeenCalled()
    })

    it('si se generó entre la lectura y el borrado → 409', async () => {
        m.certificado.findUnique.mockResolvedValueOnce({ estado: 'PENDIENTE', generadoEn: null })
        m.certificado.deleteMany.mockResolvedValueOnce({ count: 0 })
        expect((await request(app).delete('/api/v1/certificates/7').set('Authorization', ADMIN())).status).toBe(409)
    })
})

// ─── Borrar eventos e inscripciones ──────────────────────────────────────────

describe('eliminarEvento con certificados (spec 015)', () => {
    beforeEach(() => {
        m.inscripcion.count.mockResolvedValue(0)
        m.ponencia.count.mockResolvedValue(0)
        m.asistencia.count.mockResolvedValue(0)
        m.certificado.count.mockResolvedValue(0)
        m.plantillaCertificado.findMany.mockResolvedValue([])
    })

    it('con certificados (aunque no tenga inscripciones) → 409 y no borra nada', async () => {
        m.certificado.count.mockResolvedValue(2)
        await expect(eliminarEvento(EVENTO)).rejects.toMatchObject({ status: 409, code: 'EVENT_HAS_INSCRIPTIONS' })
        expect(m.certificado.count).toHaveBeenCalledWith({ where: { eventoId: EVENTO } })
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('sin certificados borra sus plantillas en la transacción y después sus PDF de diseño', async () => {
        const archivo = nuevoNombrePlantilla()
        fs.mkdirSync(DIRECTORIO_PLANTILLAS_CERTIFICADO, { recursive: true })
        const ruta = path.join(DIRECTORIO_PLANTILLAS_CERTIFICADO, archivo)
        fs.writeFileSync(ruta, '%PDF-1.7')
        m.plantillaCertificado.findMany.mockResolvedValue([{ archivoDiseno: archivo }, { archivoDiseno: '../../secreto.pdf' }])
        await eliminarEvento(EVENTO)
        expect(m.plantillaCertificado.deleteMany).toHaveBeenCalledWith({ where: { eventoId: EVENTO } })
        expect(m.evento.delete).toHaveBeenCalledWith({ where: { id: EVENTO } })
        expect(fs.existsSync(ruta)).toBe(false)
    })
})

describe('eliminarInscripcion con certificado vigente (spec 015)', () => {
    beforeEach(() => {
        m.inscripcion.findUnique.mockResolvedValue({ id: 5, eventoId: EVENTO, voucherArchivo: null })
    })

    it('con un certificado vigente → 409 INSCRIPTION_HAS_CERTIFICATE y no la borra', async () => {
        m.certificado.count.mockResolvedValue(1)
        await expect(eliminarInscripcion(5)).rejects.toMatchObject({ status: 409, code: 'INSCRIPTION_HAS_CERTIFICATE' })
        expect(m.certificado.count).toHaveBeenCalledWith({ where: { inscripcionId: 5, estado: { not: 'ANULADO' } } })
        expect(m.inscripcion.delete).not.toHaveBeenCalled()
    })

    it('sin certificados vigentes (o solo anulados) se borra', async () => {
        m.certificado.count.mockResolvedValue(0)
        await eliminarInscripcion(5)
        expect(m.inscripcion.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    })
})

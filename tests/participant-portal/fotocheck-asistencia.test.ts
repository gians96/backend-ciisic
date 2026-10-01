import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { REGEX_CODIGO_CREDENCIAL } from '../../src/core/codigos'
import { nuevoNombreFoto } from '../../src/core/almacenamiento'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn() },
        inscripcion: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        actividad: { findMany: jest.fn() },
    },
}))
// El QR se simula para comprobar qué codifica: solo el código opaco de la credencial
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async (texto: string) => `data:image/png;base64,${Buffer.from(texto).toString('base64')}`) }))

type Mock = jest.Mock
const m = prisma as unknown as {
    participante: { findUnique: Mock }
    inscripcion: Record<'findFirst' | 'findUnique' | 'findMany' | 'updateMany', Mock>
    actividad: { findMany: Mock }
}
const SESION = `Bearer ${tokenDeParticipante(50, 'ana@gmail.com')}`
const qrDe = (texto: string) => `data:image/png;base64,${Buffer.from(texto).toString('base64')}`

const evento = { nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026', fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'), sede: 'Cañete' }
const fila = (cambios: Record<string, unknown> = {}) => ({
    id: 29, codigoCredencial: 'K7Q2M9X4TB', estado: { codigo: 'APROBADO' }, evento,
    participante: { nombres: 'ANA', apellidos: 'PEREZ', tipoDocumentoId: 'dni', numeroDocumento: '70009999', fotoArchivo: null },
    tipoInscripcion: { nombre: 'ESTUDIANTES', etiqueta: 'CON KIT' }, ...cambios,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue({ id: 50, correo: 'ana@gmail.com' })
})

describe('fotocheck virtual', () => {
    it('la inscripción ajena o inexistente es 404 y la no aprobada 409', async () => {
        m.inscripcion.findFirst.mockResolvedValueOnce(null)
        const ajena = await request(app).get('/api/v1/me/inscriptions/99/badge').set('Authorization', SESION)
        expect(ajena.status).toBe(404)
        expect(ajena.body.code).toBe('INSCRIPTION_NOT_FOUND')
        expect(m.inscripcion.findFirst.mock.calls[0][0].where).toEqual({ id: 99, participanteId: 50 })

        for (const codigo of ['PENDIENTE', 'EN_REVISION', 'RECHAZADO']) {
            m.inscripcion.findFirst.mockResolvedValueOnce(fila({ estado: { codigo } }))
            const r = await request(app).get('/api/v1/me/inscriptions/29/badge').set('Authorization', SESION)
            expect(r.status).toBe(409)
            expect(r.body.code).toBe('NOT_APPROVED')
        }
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('devuelve código, QR del código, evento, documento enmascarado y nada interno', async () => {
        m.inscripcion.findFirst.mockResolvedValue(fila({ participante: { ...fila().participante, fotoArchivo: nuevoNombreFoto('jpg') } }))
        const r = await request(app).get('/api/v1/me/inscriptions/29/badge').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.body.data).toEqual({
            inscripcionId: 29,
            codigo: 'K7Q2M9X4TB',
            qr: qrDe('K7Q2M9X4TB'),
            evento: { nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026', fechaInicio: '2026-10-26', fechaFin: '2026-10-30', sede: 'Cañete' },
            participante: { nombres: 'ANA', apellidos: 'PEREZ', tipoDocumento: 'dni', documentoEnmascarado: '****9999' },
            tipoInscripcion: { nombre: 'ESTUDIANTES', etiqueta: 'CON KIT' },
            foto: { tiene: true },
        })
        expect(JSON.stringify(r.body)).not.toMatch(/70009999|foto-|revisadoPor|correo/)
        // Solo pide a la BD lo que muestra
        const consulta = m.inscripcion.findFirst.mock.calls[0][0]
        expect(consulta.where).toEqual({ id: 29, participanteId: 50 })
        expect(consulta.select.revisadoPor).toBeUndefined()
    })

    it('si la inscripción aún no tiene código (imagen anterior), lo asigna y lo marca como QR anterior', async () => {
        m.inscripcion.findFirst.mockResolvedValue(fila({ codigoCredencial: null, tipoInscripcion: null }))
        m.inscripcion.findUnique
            .mockResolvedValueOnce({ codigoCredencial: null, credencialEnviadaEn: new Date(), estado: { codigo: 'APROBADO' } })
            .mockImplementationOnce(async () => ({ codigoCredencial: m.inscripcion.updateMany.mock.calls[0][0].data.codigoCredencial }))
        m.inscripcion.updateMany.mockResolvedValue({ count: 1 })
        const r = await request(app).get('/api/v1/me/inscriptions/29/badge').set('Authorization', SESION)
        expect(r.status).toBe(200)
        const asignado = m.inscripcion.updateMany.mock.calls[0][0]
        expect(asignado.where).toEqual({ id: 29, codigoCredencial: null })
        expect(asignado.data).toEqual({ codigoCredencial: expect.stringMatching(REGEX_CODIGO_CREDENCIAL), esQrLegado: true })
        expect(r.body.data.codigo).toBe(asignado.data.codigoCredencial)
        expect(r.body.data.qr).toBe(qrDe(asignado.data.codigoCredencial))
        expect(r.body.data.tipoInscripcion).toBeNull()
        expect(r.body.data.foto).toEqual({ tiene: false })
    })

    it('GET /me/inscriptions marca el fotocheck disponible solo en las aprobadas', async () => {
        const base = {
            participanteId: 50, evento: { ...evento, codigo: 'ciisic-viii-2026' }, monto: 100, descuento: 0, modalidadPago: 'billetera', banco: null, tipoOperacion: null,
            billeteraDigital: 'yape', numeroOperacion: 'OP-1', fechaPago: new Date('2026-09-29T00:00:00Z'), motivoRechazo: null, revisadoEn: null, credencialEnviadaEn: null,
            creadoEn: new Date('2026-09-28T15:00:00Z'), tipoInscripcion: null, clasificacion: null,
        }
        m.inscripcion.findMany.mockResolvedValue([
            { ...base, id: 29, estado: { codigo: 'APROBADO', nombre: 'Aprobado' } },
            { ...base, id: 30, estado: { codigo: 'PENDIENTE', nombre: 'Pendiente' } },
        ])
        const r = await request(app).get('/api/v1/me/inscriptions').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.body.data.map((i: { fotocheck: unknown }) => i.fotocheck)).toEqual([{ disponible: true }, { disponible: false }])
    })

    it('un token de staff no ve fotochecks ni asistencias (403)', async () => {
        const admin = `Bearer ${tokenDeRol('SUPERADMIN')}`
        expect((await request(app).get('/api/v1/me/inscriptions/29/badge').set('Authorization', admin)).status).toBe(403)
        expect((await request(app).get('/api/v1/me/attendances').set('Authorization', admin)).status).toBe(403)
        expect((await request(app).get('/api/v1/me/attendances')).status).toBe(401)
        expect(m.inscripcion.findFirst).not.toHaveBeenCalled()
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })
})

describe('mi asistencia', () => {
    const lima = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-05:00`)
    const actividad = (id: number, eventoId: number, fecha: string, inicio: string, fin: string, asistencias: unknown[] = []) => ({
        id, eventoId, nombre: `Actividad ${id}`, fecha: new Date(`${fecha}T00:00:00Z`), horaInicio: lima(fecha, inicio), horaFin: lima(fecha, fin), asistencias,
    })

    it('agrupa por evento aprobado, con todas sus actividades, y no cuenta las marcas anuladas', async () => {
        const registradoEn = new Date('2026-10-26T14:05:00Z')
        m.inscripcion.findMany.mockResolvedValue([
            { evento: { id: 2, nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' } },
            { evento: { id: 1, nombre: 'VII Congreso', nombreCorto: 'VII CIISIC 2025' } },
        ])
        m.actividad.findMany.mockResolvedValue([
            actividad(10, 2, '2026-10-26', '09:00', '11:00', [{ registradoEn, anuladoEn: null }]),
            actividad(11, 2, '2026-10-26', '15:00', '17:00', [{ registradoEn, anuladoEn: new Date() }]),
            actividad(12, 2, '2026-10-27', '09:00', '11:00'),
        ])
        const r = await request(app).get('/api/v1/me/attendances').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.body.data).toEqual([
            {
                evento: { id: 2, nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' },
                totalActividades: 3,
                asistidas: 1,
                actividades: [
                    { id: 10, nombre: 'Actividad 10', fecha: '2026-10-26', horaInicio: '09:00', horaFin: '11:00', asistio: true, registradoEn: registradoEn.toISOString() },
                    { id: 11, nombre: 'Actividad 11', fecha: '2026-10-26', horaInicio: '15:00', horaFin: '17:00', asistio: false, registradoEn: null },
                    { id: 12, nombre: 'Actividad 12', fecha: '2026-10-27', horaInicio: '09:00', horaFin: '11:00', asistio: false, registradoEn: null },
                ],
            },
            { evento: { id: 1, nombre: 'VII Congreso', nombreCorto: 'VII CIISIC 2025' }, totalActividades: 0, asistidas: 0, actividades: [] },
        ])

        // Solo inscripciones aprobadas del propio participante y solo sus marcas vigentes
        const inscripciones = m.inscripcion.findMany.mock.calls[0][0]
        expect(inscripciones.where).toEqual({ participanteId: 50, estado: { codigo: 'APROBADO' } })
        const actividades = m.actividad.findMany.mock.calls[0][0]
        expect(actividades.where).toEqual({ eventoId: { in: [2, 1] } })
        expect(actividades.select.asistencias.where).toEqual({ participanteId: 50, anuladoEn: null })
    })

    it('sin inscripciones aprobadas devuelve una lista vacía sin consultar actividades', async () => {
        m.inscripcion.findMany.mockResolvedValue([])
        const r = await request(app).get('/api/v1/me/attendances').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual([])
        expect(m.actividad.findMany).not.toHaveBeenCalled()
    })
})

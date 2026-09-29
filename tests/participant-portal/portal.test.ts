import fs from 'fs'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_UPLOADS } from '../../src/core/almacenamiento'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn() },
        inscripcion: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as Record<'participante' | 'inscripcion', Record<string, jest.Mock>>
const sesion = () => `Bearer ${tokenDeParticipante(50, 'ana@gmail.com')}`
const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'), sede: 'Cañete' }
const inscripcion = (cambios: Record<string, unknown> = {}) => ({
    id: 29, participanteId: 50, evento, monto: 100, descuento: 20, modalidadPago: 'billetera', banco: null, tipoOperacion: null, billeteraDigital: 'yape',
    numeroOperacion: 'OP-1', fechaPago: new Date('2026-09-29T00:00:00Z'), motivoRechazo: 'Voucher ilegible', revisadoEn: null, credencialEnviadaEn: null,
    creadoEn: new Date(), revisadoPorId: 1, voucherArchivo: 'voucher-1.png',
    tipoInscripcion: { nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', precio: 120, categoria: { nombre: 'ESTUDIANTES' } },
    clasificacion: { nombre: 'ESTUDIANTE - VI CICLO' }, estado: { codigo: 'PENDIENTE', nombre: 'Pendiente' }, ...cambios,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue({ id: 50, correo: 'ana@gmail.com', nombres: 'ANA', apellidos: 'PEREZ', tipoDocumentoId: 'dni', numeroDocumento: '70009999' })
})

describe('portal del inscrito', () => {
    it('lista solo sus inscripciones, sin datos internos, y el motivo solo si fue rechazada', async () => {
        m.inscripcion.findMany.mockResolvedValue([inscripcion(), inscripcion({ id: 30, estado: { codigo: 'RECHAZADO', nombre: 'Rechazado' } })])
        const r = await request(app).get('/api/v1/me/inscriptions').set('Authorization', sesion())
        expect(r.status).toBe(200)
        expect(m.inscripcion.findMany.mock.calls[0][0].where).toEqual({ participanteId: 50 })
        expect(r.body.data[0]).toMatchObject({
            id: 29, evento: { codigo: 'ciisic-viii-2026', fechaInicio: '2026-10-26' }, monto: 100, precioRegular: 120, descuento: 20,
            estado: { codigo: 'PENDIENTE' }, motivoRechazo: null, credencial: { disponible: false },
        })
        expect(r.body.data[1].motivoRechazo).toBe('Voucher ilegible')
        expect(JSON.stringify(r.body)).not.toMatch(/revisadoPor|voucher-1/)
    })

    it('devuelve su perfil', async () => {
        const r = await request(app).get('/api/v1/me').set('Authorization', sesion())
        expect(r.body.data).toEqual({ id: 50, nombres: 'ANA', apellidos: 'PEREZ', correo: 'ana@gmail.com', tipoDocumento: 'dni', numeroDocumento: '70009999' })
    })

    it('la credencial ajena es 404 y la no aprobada 409; la propia aprobada se descarga', async () => {
        m.inscripcion.findFirst.mockResolvedValueOnce(null)
        expect((await request(app).get('/api/v1/me/inscriptions/99/credential').set('Authorization', sesion())).status).toBe(404)
        expect(m.inscripcion.findFirst.mock.calls[0][0].where).toEqual({ id: 99, participanteId: 50 })

        m.inscripcion.findFirst.mockResolvedValue({ id: 29, evento: { codigo: 'ciisic-viii-2026' } })
        m.inscripcion.findUnique.mockResolvedValueOnce(inscripcion())
        const pendiente = await request(app).get('/api/v1/me/inscriptions/29/credential').set('Authorization', sesion())
        expect(pendiente.status).toBe(409)
        expect(pendiente.body.code).toBe('NOT_APPROVED')

        const ruta = path.join(DIRECTORIO_UPLOADS, 'credenciales', 'ciisic-viii-2026', '29.pdf')
        fs.mkdirSync(path.dirname(ruta), { recursive: true })
        fs.writeFileSync(ruta, '%PDF-1.4 credencial')
        m.inscripcion.findUnique.mockResolvedValueOnce(inscripcion({ estado: { codigo: 'APROBADO', nombre: 'Aprobado' } }))
        const pdf = await request(app).get('/api/v1/me/inscriptions/29/credential').set('Authorization', sesion())
        expect(pdf.status).toBe(200)
        expect(pdf.headers['content-disposition']).toBe('attachment; filename="credencial-ciisic-viii-2026-29.pdf"')
    })

    it('si su correo cambió, la sesión deja de valer; un token de admin no entra', async () => {
        m.participante.findUnique.mockResolvedValue({ correo: 'nuevo@gmail.com' })
        const r = await request(app).get('/api/v1/me/inscriptions').set('Authorization', sesion())
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
        const admin = await request(app).get('/api/v1/me').set('Authorization', `Bearer ${tokenDeRol('SUPERADMIN')}`)
        expect(admin.status).toBe(403)
    })
})

import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        cambioTipoInscripcion: { findMany: jest.fn() },
    },
}))

const m = prisma as unknown as {
    inscripcion: { findUnique: jest.Mock, findMany: jest.Mock, count: jest.Mock }
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
    cambioTipoInscripcion: { findMany: jest.Mock }
}

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', esPrincipal: true, estado: 'PUBLICADO' }
const ENTREGADO_EN = new Date('2026-10-26T15:32:00.000Z')
const ENTREGADOR = { id: 41, nombres: 'Rosa', apellidos: 'Quispe' }

function tipo(cambios: Record<string, unknown> = {}) {
    return {
        id: 3, codigo: 'estudiantes_con_kit', nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', precio: new Prisma.Decimal(120), precioInstitucional: new Prisma.Decimal(100),
        modalidad: 'PRESENCIAL', incluyeKit: true, categoria: { id: 3, codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES', esEstudiantil: true }, ...cambios,
    }
}

function inscripcion(cambios: Record<string, unknown> = {}) {
    return {
        id: 5, eventoId: 2, participanteId: 50, tipoInscripcionId: 3, clasificacionId: null, estadoId: 2,
        creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        banco: null, billeteraDigital: 'yape', tipoOperacion: null, modalidadPago: 'billetera', numeroOperacion: 'OP-777',
        monto: new Prisma.Decimal(100), descuento: new Prisma.Decimal(20), tieneDescuento: true, fechaPago: new Date('2026-09-19T00:00:00Z'),
        voucherArchivo: 'voucher-5.png', esCorreoInstitucional: false, motivoRechazo: null, revisadoPorId: null, revisadoEn: null,
        credencialEnviadaEn: null, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        kitEntregadoEn: null, kitEntregadoPorId: null, kitEntregadoPor: null,
        evento,
        participante: { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321' },
        tipoInscripcion: tipo(),
        clasificacion: null,
        estado: { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' },
        revisadoPor: null,
        ...cambios,
    }
}

const tesorero = () => ({ Authorization: `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}` })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 ? evento : null))
    m.inscripcion.findUnique.mockResolvedValue(inscripcion())
    m.inscripcion.findMany.mockResolvedValue([inscripcion()])
    m.inscripcion.count.mockResolvedValue(1)
    m.cambioTipoInscripcion.findMany.mockResolvedValue([])
})

describe('el kit en el detalle y el listado de inscripciones (spec 037)', () => {
    it('el detalle dice si el tipo incluye kit y que aún está pendiente', async () => {
        const r = await request(app).get('/api/v1/inscriptions/5').set(tesorero())
        expect(r.status).toBe(200)
        expect(r.body.data.tipoInscripcion.incluyeKit).toBe(true)
        expect(r.body.data.kit).toEqual({ incluye: true, entregado: false, entregadoEn: null, entregadoPor: null })
        // Se pide quién lo entregó junto con el resto del detalle
        const consulta = m.inscripcion.findUnique.mock.calls.map(([argumentos]) => argumentos).find((argumentos) => argumentos.include)
        expect(consulta.include.kitEntregadoPor).toEqual({ select: { id: true, nombres: true, apellidos: true } })
    })

    it('entregado: cuándo y quién', async () => {
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ kitEntregadoEn: ENTREGADO_EN, kitEntregadoPorId: 41, kitEntregadoPor: ENTREGADOR }))
        const r = await request(app).get('/api/v1/inscriptions/5').set(tesorero())
        expect(r.body.data.kit).toEqual({ incluye: true, entregado: true, entregadoEn: ENTREGADO_EN.toISOString(), entregadoPor: ENTREGADOR })
    })

    it('un tipo sin kit, virtual o sin tipo (cortesía) no incluye kit', async () => {
        for (const cambios of [
            { tipoInscripcion: tipo({ incluyeKit: false, etiqueta: 'SIN KIT' }) },
            { tipoInscripcion: tipo({ incluyeKit: true, modalidad: 'VIRTUAL' }) },
            { tipoInscripcionId: null, tipoInscripcion: null },
        ]) {
            m.inscripcion.findUnique.mockResolvedValue(inscripcion(cambios))
            const r = await request(app).get('/api/v1/inscriptions/5').set(tesorero())
            expect(r.body.data.kit.incluye).toBe(false)
        }
    })

    it('un backend sin las columnas del kit (filas sin ellas) se lee como pendiente', async () => {
        const { kitEntregadoEn, kitEntregadoPorId, kitEntregadoPor, ...sinKit } = inscripcion()
        void kitEntregadoEn; void kitEntregadoPorId; void kitEntregadoPor
        m.inscripcion.findUnique.mockResolvedValue(sinKit)
        const r = await request(app).get('/api/v1/inscriptions/5').set(tesorero())
        expect(r.body.data.kit).toMatchObject({ entregado: false, entregadoEn: null, entregadoPor: null })
    })

    it('el listado trae `incluyeKit` del tipo y si el kit ya se entregó, sin el detalle de cuándo ni quién', async () => {
        m.inscripcion.findMany.mockResolvedValue([inscripcion(), inscripcion({ id: 6, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPor: ENTREGADOR })])
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(r.status).toBe(200)
        const [pendiente, entregado] = r.body.data
        expect(pendiente.tipoInscripcion.incluyeKit).toBe(true)
        expect(pendiente.kitEntregado).toBe(false)
        expect(entregado.kitEntregado).toBe(true)
        expect(entregado).not.toHaveProperty('kit')
    })
})

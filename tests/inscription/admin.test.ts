import fs from 'fs'
import path from 'path'
import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { generarCredencialPdf, rutaCredencial } from '../../src/api/inscription/utils/generatePdf'
import { enviarCorreoAprobacion } from '../../src/api/inscription/utils/sendEmail'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        // Borrar la inscripción revisa sus certificados vigentes (spec 015)
        certificado: { count: jest.fn(async () => 0) },
    },
}))

// La credencial real usa puppeteer y el correo, Brevo: se simulan
jest.mock('../../src/api/inscription/utils/generatePdf', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/generatePdf'),
    generarCredencialPdf: jest.fn(),
}))
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoAprobacion: jest.fn() }))

const m = prisma as unknown as {
    inscripcion: { findUnique: jest.Mock, findMany: jest.Mock, count: jest.Mock, update: jest.Mock, delete: jest.Mock }
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
}
const generarPdf = generarCredencialPdf as jest.Mock
const enviarCorreo = enviarCorreoAprobacion as jest.Mock

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', esPrincipal: true, estado: 'PUBLICADO' }

function inscripcion(cambios: Record<string, unknown> = {}) {
    return {
        id: 5, eventoId: 2, participanteId: 50, tipoInscripcionId: 7, clasificacionId: null, estadoId: 1,
        creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        banco: 'bcp', billeteraDigital: null, tipoOperacion: 'directo', modalidadPago: 'banco', numeroOperacion: 'OP-777',
        monto: new Prisma.Decimal(120), descuento: new Prisma.Decimal(20), tieneDescuento: true, fechaPago: new Date('2026-09-19T00:00:00Z'),
        voucherArchivo: 'voucher-5.png', esCorreoInstitucional: false, motivoRechazo: null, revisadoPorId: null, revisadoEn: null,
        credencialEnviadaEn: null, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        evento,
        participante: { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321' },
        tipoInscripcion: {
            id: 7, codigo: 'GENERAL', nombre: 'General', etiqueta: null, precio: new Prisma.Decimal(140), precioInstitucional: new Prisma.Decimal(120),
            categoria: { id: 3, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', esEstudiantil: false },
        },
        clasificacion: null,
        estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' },
        revisadoPor: null,
        ...cambios,
    }
}

const CAMPOS_PAGO_LISTA = ['monto', 'modalidadPago', 'numeroOperacion', 'fechaPago']

// TESORERO (30) y COMISION (40) asignados al evento 2
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = (permisos: string[] = ['inscripciones.ver', 'inscripciones.exportar']) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 || where.id === 3 ? { ...evento, id: where.id } : null))
    m.inscripcion.findUnique.mockResolvedValue(inscripcion())
    m.inscripcion.findMany.mockResolvedValue([inscripcion()])
    m.inscripcion.count.mockResolvedValue(1)
})

describe('lista, detalle y CSV según «pagos.ver»', () => {
    it('el Tesorero ve montos y datos de pago', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ monto: 120, modalidadPago: 'banco', numeroOperacion: 'OP-777', fechaPago: '2026-09-19', tieneVoucher: true })
    })

    it('la Comisión con «inscripciones.ver» recibe la lista sin montos ni datos de pago', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(con(comision()))
        expect(r.status).toBe(200)
        const [fila] = r.body.data
        for (const campo of CAMPOS_PAGO_LISTA) expect(fila[campo]).toBeNull()
        expect(fila.tieneVoucher).toBe(false)
        expect(fila.participante).toMatchObject({ nombres: 'Ana', numeroDocumento: '12345678', correo: 'ana@gmail.com' })
    })

    it('sin «pagos.ver» la búsqueda libre no mira el número de operación', async () => {
        const where = () => m.inscripcion.findMany.mock.calls[0][0].where
        await request(app).get('/api/v1/events/2/inscriptions?q=OP-777').set(con(comision()))
        expect(JSON.stringify(where().OR)).not.toContain('numeroOperacion')
        expect(where().OR).toContainEqual({ participante: { numeroDocumento: { contains: 'OP-777' } } })

        m.inscripcion.findMany.mockClear()
        await request(app).get('/api/v1/events/2/inscriptions?q=OP-777').set(con(tesorero()))
        expect(where().OR).toContainEqual({ numeroOperacion: { contains: 'OP-777' } })
    })

    it('el detalle de la Comisión no lleva el pago ni los precios del tipo', async () => {
        const r = await request(app).get('/api/v1/inscriptions/5').set(con(comision()))
        expect(r.status).toBe(200)
        // Mismas claves con los datos en null: el panel anterior lee `pago.tieneVoucher` sin comprobar null
        expect(r.body.data.pago).toEqual({
            monto: null, descuento: null, tieneDescuento: null, modalidad: null, banco: null, tipoOperacion: null,
            billeteraDigital: null, numeroOperacion: null, fechaPago: null, tieneVoucher: false, voucherMime: null,
        })
        expect(r.body.data.tipoInscripcion).toMatchObject({ id: 7, nombre: 'General', precio: null, precioInstitucional: null })
        expect(JSON.stringify(r.body.data)).not.toContain('OP-777')

        const tesoreria = await request(app).get('/api/v1/inscriptions/5').set(con(tesorero()))
        expect(tesoreria.body.data.pago).toMatchObject({ monto: 120, descuento: 20, numeroOperacion: 'OP-777', tieneVoucher: true })
        expect(tesoreria.body.data.tipoInscripcion).toMatchObject({ precio: 140, precioInstitucional: 120 })
    })

    it('el CSV de la Comisión omite las columnas de pago', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(con(comision()))
        expect(r.status).toBe(200)
        // BOM para Excel y luego las líneas
        expect(r.text.charCodeAt(0)).toBe(0xfeff)
        const [encabezado, fila] = r.text.slice(1).split('\r\n')
        for (const columna of ['Monto', 'Descuento', 'Modalidad', 'Banco / billetera', 'N° operación', 'Fecha de pago']) {
            expect(encabezado.split(';')).not.toContain(columna)
        }
        expect(encabezado.split(';')).toHaveLength(fila.split(';').length)
        expect(r.text).not.toContain('OP-777')
        expect(r.text).toContain('12345678')

        const tesoreria = await request(app).get('/api/v1/events/2/inscriptions/export').set(con(tesorero()))
        expect(tesoreria.text).toContain('N° operación')
        expect(tesoreria.text).toContain('OP-777')
        expect(tesoreria.text).toContain('120.00')
    })

    it('exportar exige «inscripciones.exportar»', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(con(comision(['inscripciones.ver'])))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })
})

describe('alcance por evento', () => {
    it('una inscripción de otro evento responde 403 EVENT_NOT_ASSIGNED', async () => {
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ id: 3, eventoId: 3 }))
        const r = await request(app).get('/api/v1/inscriptions/3').set(con(tesorero()))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it.each(['0x3', '3.0'])('el id %s no abre una inscripción de otro evento', async (id) => {
        // El resolutor y el controlador parsean igual (idParam): nunca llega a leer el recurso ajeno
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ id: 3, eventoId: 3 }))
        const r = await request(app).get(`/api/v1/inscriptions/${id}`).set(con(tesorero()))
        expect([400, 403]).toContain(r.status)
        expect(r.body.success).toBe(false)
    })

    it('una inscripción inexistente responde 404 a la cuenta por evento', async () => {
        m.inscripcion.findUnique.mockResolvedValue(null)
        const r = await request(app).get('/api/v1/inscriptions/99').set(con(tesorero()))
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('NOT_FOUND')
    })

    it('la lista de otro evento responde 403 EVENT_NOT_ASSIGNED', async () => {
        const r = await request(app).get('/api/v1/events/3/inscriptions').set(con(tesorero()))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })
})

describe('pagos y cambio de estado', () => {
    it('el voucher exige «pagos.ver»: 403 a la Comisión', async () => {
        const r = await request(app).get('/api/v1/inscriptions/5/voucher').set(con(comision()))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })

    it('el Tesorero pasa la guarda del voucher', async () => {
        const r = await request(app).get('/api/v1/inscriptions/5/voucher').set(con(tesorero()))
        // El archivo no existe en el directorio de pruebas: la guarda dejó pasar
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('VOUCHER_NOT_FOUND')
    })

    it('la Comisión no puede cambiar el estado', async () => {
        const r = await request(app).patch('/api/v1/inscriptions/5/status').set(con(comision())).send({ estado: 'APROBADO' })
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.inscripcion.update).not.toHaveBeenCalled()
    })

    it('el Tesorero no puede cancelar', async () => {
        const r = await request(app).patch('/api/v1/inscriptions/5/status').set(con(tesorero())).send({ estado: 'CANCELADO' })
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('STATUS_NOT_ALLOWED')
        expect(m.inscripcion.update).not.toHaveBeenCalled()
    })

    it('el Tesorero aprueba: queda como revisor y se envía la credencial', async () => {
        const aprobada = inscripcion({ estado: { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' }, revisadoEn: new Date() })
        m.inscripcion.findUnique.mockResolvedValueOnce(inscripcion()).mockResolvedValueOnce(inscripcion()).mockResolvedValue(aprobada)
        m.inscripcion.update.mockResolvedValue(aprobada)
        generarPdf.mockResolvedValue('/tmp/credencial.pdf')
        enviarCorreo.mockResolvedValue(true)
        const r = await request(app).patch('/api/v1/inscriptions/5/status').set(con(tesorero())).send({ estado: 'APROBADO' })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ estado: { codigo: 'APROBADO' }, credencialEnviada: true })
        expect(r.body.data.pago).toMatchObject({ monto: 120 })
        expect(m.inscripcion.update.mock.calls[0][0].data).toMatchObject({ estado: { connect: { codigo: 'APROBADO' } }, revisadoPor: { connect: { id: 30 } } })
        expect(generarPdf).toHaveBeenCalled()
    })

    it('el Owner sí puede cancelar', async () => {
        m.inscripcion.update.mockResolvedValue(inscripcion({ estado: { id: 5, codigo: 'CANCELADO', nombre: 'Cancelado' } }))
        const r = await request(app).patch('/api/v1/inscriptions/5/status').set(con(tokenDeRol('SUPERADMIN'))).send({ estado: 'CANCELADO' })
        expect(r.status).toBe(200)
        expect(m.inscripcion.update.mock.calls[0][0].data).toMatchObject({ estado: { connect: { codigo: 'CANCELADO' } }, revisadoPor: { connect: { id: 1 } } })
    })
})

describe('reenvío de la credencial', () => {
    const aprobada = () => inscripcion({ estado: { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' }, revisadoEn: new Date() })

    it('reutiliza el PDF ya generado', async () => {
        m.inscripcion.findUnique.mockResolvedValue(aprobada())
        enviarCorreo.mockResolvedValue(true)
        const ruta = rutaCredencial(aprobada() as unknown as Parameters<typeof rutaCredencial>[0])
        fs.mkdirSync(path.dirname(ruta), { recursive: true })
        fs.writeFileSync(ruta, '%PDF-1.4')
        try {
            const r = await request(app).post('/api/v1/inscriptions/5/resend-credential').set(con(tesorero()))
            expect(r.status).toBe(200)
            expect(r.body.data).toEqual({ credencialEnviada: true })
            expect(generarPdf).not.toHaveBeenCalled()
            expect(enviarCorreo).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), ruta)
            expect(m.inscripcion.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { credencialEnviadaEn: expect.any(Date) } })
        } finally {
            fs.rmSync(ruta, { force: true })
        }
    })

    it('genera otro PDF si la persona o el evento cambiaron después de generarlo', async () => {
        enviarCorreo.mockResolvedValue(true)
        generarPdf.mockResolvedValue('/tmp/regenerada.pdf')
        const base = aprobada()
        const ruta = rutaCredencial(base as unknown as Parameters<typeof rutaCredencial>[0])
        fs.mkdirSync(path.dirname(ruta), { recursive: true })
        fs.writeFileSync(ruta, '%PDF-1.4')
        const generadoEn = fs.statSync(ruta).mtime
        const despues = new Date(generadoEn.getTime() + 60_000)
        try {
            for (const cambio of [
                { participante: { ...base.participante, apellidos: 'Pérez Corregido', actualizadoEn: despues } },
                { evento: { ...evento, actualizadoEn: despues } },
            ]) {
                generarPdf.mockClear()
                m.inscripcion.findUnique.mockResolvedValue({ ...base, ...cambio })
                const r = await request(app).post('/api/v1/inscriptions/5/resend-credential').set(con(tesorero()))
                expect(r.status).toBe(200)
                expect(generarPdf).toHaveBeenCalledTimes(1)
                expect(enviarCorreo).toHaveBeenLastCalledWith(expect.anything(), '/tmp/regenerada.pdf')
            }
            // Un cambio anterior al PDF no lo regenera
            generarPdf.mockClear()
            m.inscripcion.findUnique.mockResolvedValue({ ...base, participante: { ...base.participante, actualizadoEn: new Date(generadoEn.getTime() - 60_000) } })
            await request(app).post('/api/v1/inscriptions/5/resend-credential').set(con(tesorero()))
            expect(generarPdf).not.toHaveBeenCalled()
            expect(enviarCorreo).toHaveBeenLastCalledWith(expect.anything(), ruta)
        } finally {
            fs.rmSync(ruta, { force: true })
        }
    })

    it('genera el PDF si aún no existe', async () => {
        m.inscripcion.findUnique.mockResolvedValue(aprobada())
        generarPdf.mockResolvedValue('/tmp/nueva.pdf')
        enviarCorreo.mockResolvedValue(true)
        const r = await request(app).post('/api/v1/inscriptions/5/resend-credential').set(con(comision(['credenciales.reenviar'])))
        expect(r.status).toBe(200)
        expect(generarPdf).toHaveBeenCalledTimes(1)
        expect(enviarCorreo).toHaveBeenCalledWith(expect.anything(), '/tmp/nueva.pdf')
    })

    it('exige «credenciales.reenviar»', async () => {
        const r = await request(app).post('/api/v1/inscriptions/5/resend-credential').set(con(comision(['inscripciones.ver'])))
        expect(r.status).toBe(403)
        expect(enviarCorreo).not.toHaveBeenCalled()
    })
})

describe('rutas reservadas a las cuentas globales', () => {
    it.each([
        ['delete', '/api/v1/inscriptions/5'],
        ['get', '/api/v1/inscription'],
        ['get', '/api/v1/inscription/5'],
        ['put', '/api/v1/inscription/5/status'],
        ['delete', '/api/v1/inscription/5'],
    ])('%s %s responde 403 al Tesorero', async (method, ruta) => {
        const r = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](ruta).set(con(tesorero())).send({ estadoId: 2 })
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.inscripcion.delete).not.toHaveBeenCalled()
    })

    it('el Administrador del sistema elimina inscripciones', async () => {
        const r = await request(app).delete('/api/v1/inscriptions/5').set(con(tokenDeRol('ADMIN')))
        expect(r.status).toBe(200)
        expect(m.inscripcion.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    })

    it('la ruta legacy de estado registra como revisor a la cuenta de la sesión', async () => {
        m.inscripcion.update.mockResolvedValue(inscripcion())
        const r = await request(app).put('/api/v1/inscription/5/status').set(con(tokenDeRol('ADMIN'))).send({ estadoId: 2 })
        expect(r.status).toBe(200)
        expect(m.inscripcion.update.mock.calls[0][0].data).toMatchObject({ revisadoPor: { connect: { id: 2 } } })
    })
})

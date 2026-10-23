import ExcelJS from 'exceljs'
import express from 'express'
import request from 'supertest'
import type { Response as RespuestaHttp } from 'superagent'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { limitador } from '../../src/middlewares/rate-limit'

jest.mock('../../src/database/prisma', () => {
    const cliente = {
        evento: { findUnique: jest.fn() },
        padronEstudiante: { findMany: jest.fn() },
        asesor: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        inscripcion: { findMany: jest.fn() },
    }
    return { prisma: cliente }
})

const m = prisma as unknown as {
    padronEstudiante: { findMany: jest.Mock }
    asesor: { findMany: jest.Mock, findFirst: jest.Mock, update: jest.Mock }
    inscripcion: { findMany: jest.Mock }
}

const DNI = '12345678'
const RUTA = '/api/v1/public/advisor/lookup'

const alumno = (id: number, extra: Record<string, unknown> = {}) => ({
    id, eventoId: 2, semestre: '2026-2', documento: `6000000${id}`, codigo: `262101000${id}`, correo: `262101000${id}@undc.edu.pe`,
    nombre: `ALUMNO ${id}`, celular: '920301747', carrera: 'INGENIERÍA DE SISTEMAS', ciclo: 'I', turno: 'M', seccion: 'A',
    distrito: null, provincia: null, departamento: null, creadoEn: new Date('2026-10-21T12:00:00.000Z'), ...extra,
})
const inscripcion = (id: number, estado: string, codigoEstudiante: string, monto = 40) => ({
    id, monto, fechaPago: new Date('2026-10-19T00:00:00.000Z'), codigoEstudiante, estado: { codigo: estado },
    participante: { tipoDocumentoId: 'dni', numeroDocumento: '00000000', correo: `otro${id}@gmail.com` },
})

let ultimoAcceso: Date | null

beforeEach(() => {
    jest.clearAllMocks()
    ultimoAcceso = null
    m.padronEstudiante.findMany.mockResolvedValue([
        alumno(1), alumno(2), alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', nombre: 'CÁRDENAS RÍOS DIEGO', celular: null }),
    ])
    m.asesor.findMany.mockResolvedValue([
        { id: 7, eventoId: 2, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', documento: DNI, secciones: [{ asesorId: 7, eventoId: 2, ciclo: 'I', seccion: 'A' }] },
        { id: 8, eventoId: 2, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', documento: '87654321', secciones: [{ asesorId: 8, eventoId: 2, ciclo: 'II', seccion: 'B' }] },
    ])
    // Solo el DNI de la docente 7 existe
    m.asesor.findFirst.mockImplementation(({ where }: { where: { documento: string } }) => Promise.resolve(where.documento === DNI
        ? { id: 7, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', enlaceUltimoAcceso: ultimoAcceso, evento: { id: 2, nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' } }
        : null))
    m.asesor.update.mockImplementation(({ data }: { data: { enlaceUltimoAcceso: Date } }) => { ultimoAcceso = data.enlaceUltimoAcceso; return Promise.resolve({}) })
    m.inscripcion.findMany.mockResolvedValue([
        inscripcion(10, 'APROBADO', '2621010001', 40),
        inscripcion(11, 'PENDIENTE', '2621010002', 40),
        inscripcion(12, 'APROBADO', '2621010003', 100),
    ])
})

describe('página común de los docentes: vista con el DNI', () => {
    it('muestra solo a los estudiantes de ese docente, con lo mismo que su enlace personal', async () => {
        const r = await request(app).post(RUTA).send({ documento: DNI })
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
        const d = r.body.data
        expect(d.asesor).toEqual({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM' })
        expect(d.evento).toEqual({ nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' })
        expect(d.totales).toEqual({ alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5 })
        expect(d.secciones).toEqual([{ ciclo: 'I', seccion: 'A', turnos: ['M'], alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5 }])
        expect(d.alumnos.map((a: { codigo: string }) => a.codigo)).toEqual(['2621010001', '2621010002'])
        expect(d.alumnos[0]).toEqual({ nombre: 'ALUMNO 1', codigo: '2621010001', ciclo: 'I', seccion: 'A', turno: 'M', secciones: ['I-A'], celular: '920301747', situacion: 'PAGADO' })
    })

    it('un alumno que cursa también en la sección de otro docente aparece una vez y solo con las secciones de este docente (spec 033)', async () => {
        // El alumno 1 cursa en I-A (de esta docente) y en II-B (del docente 8): ella no debe ver II-B ni a quién la atiende
        m.padronEstudiante.findMany.mockResolvedValue([
            alumno(1, { secciones: [{ eventoId: 2, codigo: '2621010001', ciclo: 'I', seccion: 'A', turno: 'M', cursos: 5 }, { eventoId: 2, codigo: '2621010001', ciclo: 'II', seccion: 'B', turno: 'T', cursos: 1 }] }),
            alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', nombre: 'CÁRDENAS RÍOS DIEGO', celular: null }),
        ])
        const r = await request(app).post(RUTA).send({ documento: DNI })
        const d = r.body.data
        expect(d.totales.alumnos).toBe(1)
        expect(d.secciones).toHaveLength(1)
        expect(d.secciones[0]).toMatchObject({ ciclo: 'I', seccion: 'A', alumnos: 1 })
        expect(d.alumnos).toHaveLength(1)
        expect(d.alumnos[0]).toMatchObject({ codigo: '2621010001', ciclo: 'I', seccion: 'A', secciones: ['I-A'] })
        expect(JSON.stringify(r.body)).not.toMatch(/II-B|CÁRDENAS/)
    })

    it('nunca devuelve el DNI del docente, ni DNI, correo o montos de los estudiantes, ni a otros asesores', async () => {
        const texto = JSON.stringify((await request(app).post(RUTA).send({ documento: DNI })).body)
        for (const prohibido of ['documento', 'correo', 'monto', 'recaudado', 'fechaPago', 'inscripcionId', 'coincidencia', 'asesores', DNI, '87654321', '60000001', '@undc.edu.pe', 'CÁRDENAS']) {
            expect({ prohibido, aparece: texto.includes(prohibido) }).toEqual({ prohibido, aparece: false })
        }
    })

    it('acepta el DNI como número y completa el cero inicial de uno de 7 dígitos; usa el evento más reciente', async () => {
        expect((await request(app).post(RUTA).send({ documento: 12345678 })).status).toBe(200)
        await request(app).post(RUTA).send({ documento: '2442123' })
        expect(m.asesor.findFirst.mock.calls[1][0].where).toEqual({ documento: '02442123' })
        expect(m.asesor.findFirst.mock.calls[0][0].orderBy).toEqual({ eventoId: 'desc' })
    })

    it('un DNI desconocido, mal escrito, ausente o que no es texto responde exactamente igual', async () => {
        const respuestas = await Promise.all([
            request(app).post(RUTA).send({ documento: '99999999' }),
            request(app).post(RUTA).send({ documento: '123' }),
            request(app).post(RUTA).send({ documento: '1234567a' }),
            request(app).post(RUTA).send({ documento: '123456789' }),
            request(app).post(RUTA).send({}),
            request(app).post(RUTA),
            request(app).post(RUTA).send({ documento: { $ne: null } }),
            request(app).post(RUTA).send({ documento: [DNI] }),
        ])
        for (const r of respuestas) expect({ status: r.status, code: r.body.code }).toEqual({ status: 404, code: 'ADVISOR_DOCUMENT_NOT_FOUND' })
        expect(new Set(respuestas.map((r) => r.body.message)).size).toBe(1)
        // Solo el DNI bien formado (aunque desconocido) llega a la base
        expect(m.asesor.findFirst).toHaveBeenCalledTimes(1)
    })

    it('el DNI no viaja por la URL: ni por GET ni por la consulta', async () => {
        expect((await request(app).get(`${RUTA}?documento=${DNI}`)).status).toBe(404)
        const r = await request(app).post(`${RUTA}?documento=${DNI}`)
        expect({ status: r.status, code: r.body.code }).toEqual({ status: 404, code: 'ADVISOR_DOCUMENT_NOT_FOUND' })
    })

    it('anota el último acceso como máximo cada 5 minutos', async () => {
        await request(app).post(RUTA).send({ documento: DNI })
        expect(m.asesor.update).toHaveBeenCalledTimes(1)
        await request(app).post(RUTA).send({ documento: DNI })
        expect(m.asesor.update).toHaveBeenCalledTimes(1)
        ultimoAcceso = new Date(Date.now() - 6 * 60 * 1000)
        await request(app).post(RUTA).send({ documento: DNI })
        expect(m.asesor.update).toHaveBeenCalledTimes(2)
    })

    it('si no se puede anotar el acceso, el docente igual ve su avance', async () => {
        m.asesor.update.mockRejectedValueOnce(new Error('BD ocupada'))
        expect((await request(app).post(RUTA).send({ documento: DNI })).status).toBe(200)
    })
})

describe('página común de los docentes: descarga con el DNI', () => {
    const binario = (res: RespuestaHttp, cb: (error: Error | null, cuerpo: Buffer) => void) => {
        const partes: Buffer[] = []
        res.on('data', (parte: Buffer) => partes.push(parte))
        res.on('end', () => cb(null, Buffer.concat(partes)))
    }

    it('el Excel lleva su nombre y no tiene DNI, correo, montos ni asesores', async () => {
        const r = await request(app).post(`${RUTA}/export`).send({ documento: DNI, formato: 'xlsx' }).buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(r.headers['content-disposition']).toContain(encodeURIComponent('DRA. ANGOMA ASTUCURI MIRIAM.xlsx'))
        expect(r.headers['cache-control']).toBe('no-store')
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(r.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        const cabecera = libro.getWorksheet('Alumnos')?.getRow(1).values as unknown[]
        expect(cabecera).toEqual(expect.arrayContaining(['Ciclo', 'Sección', 'Código', 'Alumno', 'Celular', 'Situación']))
        for (const oculto of ['DNI', 'Correo', 'Asesores', 'Monto (S/)']) expect(cabecera).not.toContain(oculto)
        expect(libro.getWorksheet('Alumnos')?.rowCount).toBe(3)
    })

    it('entrega el PDF por defecto en xlsx y valida el formato y el DNI', async () => {
        const pdf = await request(app).post(`${RUTA}/export`).send({ documento: DNI, formato: 'pdf' }).buffer(true).parse(binario)
        expect(pdf.status).toBe(200)
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        const porDefecto = await request(app).post(`${RUTA}/export`).send({ documento: DNI }).buffer(true).parse(binario)
        expect(porDefecto.headers['content-type']).toContain('spreadsheetml')
        expect((await request(app).post(`${RUTA}/export`).send({ documento: DNI, formato: 'csv' })).status).toBe(422)
        const ajeno = await request(app).post(`${RUTA}/export`).send({ documento: '99999999', formato: 'xlsx' })
        expect({ status: ajeno.status, code: ajeno.body.code }).toEqual({ status: 404, code: 'ADVISOR_DOCUMENT_NOT_FOUND' })
    })
})

describe('límite de intentos con el DNI', () => {
    it('topa solo los intentos fallidos: quien acierta no se penaliza', async () => {
        const limite = limitador(60_000, 2, 'tope', { soloFallos: true, omitirEnPruebas: false })
        const mini = express()
        mini.get('/x', limite, (req, res) => { res.status(req.query.ok ? 200 : 404).json({}) })
        for (let i = 0; i < 6; i++) expect((await request(mini).get('/x?ok=1')).status).toBe(200)
        expect((await request(mini).get('/x')).status).toBe(404)
        expect((await request(mini).get('/x')).status).toBe(404)
        // El tercer fallo ya está topado; y un acierto después del tope también se frena
        expect((await request(mini).get('/x')).status).toBe(429)
        expect((await request(mini).get('/x?ok=1')).status).toBe(429)
    })
})

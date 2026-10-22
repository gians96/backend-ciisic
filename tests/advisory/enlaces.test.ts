import ExcelJS from 'exceljs'
import request from 'supertest'
import type { Response as RespuestaHttp } from 'superagent'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { REGEX_TOKEN } from '../../src/api/advisory/services/enlaces'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const cliente = {
        evento: { findUnique: jest.fn() },
        padronEstudiante: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
        asesor: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
        inscripcion: { findMany: jest.fn() },
        $transaction: jest.fn(),
    }
    cliente.$transaction.mockImplementation(async (trabajo: (tx: typeof cliente) => Promise<unknown>) => trabajo(cliente))
    return { prisma: cliente }
})

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    padronEstudiante: { findMany: jest.Mock, deleteMany: jest.Mock, createMany: jest.Mock }
    asesor: { findMany: jest.Mock, findUnique: jest.Mock, update: jest.Mock, updateMany: jest.Mock, deleteMany: jest.Mock, create: jest.Mock }
    inscripcion: { findMany: jest.Mock }
}

const admin = () => tokenDeRol('ADMIN', 2)
const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
const comision = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['reportes.ver', 'reportes.exportar'] })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

const TOKEN = 'A'.repeat(43)
const OTRO = 'B'.repeat(43)

const alumno = (id: number, extra: Record<string, unknown> = {}) => ({
    id, eventoId: 2, semestre: '2026-2', documento: `6000000${id}`, codigo: `262101000${id}`, correo: `262101000${id}@undc.edu.pe`,
    nombre: `ALUMNO ${id}`, celular: '920301747', carrera: 'INGENIERÍA DE SISTEMAS', ciclo: 'I', turno: 'M', seccion: 'A',
    distrito: null, provincia: null, departamento: null, creadoEn: new Date('2026-10-21T12:00:00.000Z'), ...extra,
})
const inscripcion = (id: number, estado: string, codigoEstudiante: string, monto = 40) => ({
    id, monto, fechaPago: new Date('2026-10-19T00:00:00.000Z'), codigoEstudiante, estado: { codigo: estado },
    participante: { tipoDocumentoId: 'dni', numeroDocumento: '00000000', correo: `otro${id}@gmail.com` },
})

/** Filas con enlace por asesor: 7 (Angoma, I-A) con token y 8 (Cárdenas, II-B) y 9 (Barrera, I-A) sin él. */
let enlaces: Array<{ id: number, nombre: string, enlaceToken: string | null, enlaceCreadoEn: Date | null, enlaceUltimoAcceso: Date | null }>

const SECCIONES: Record<number, Array<{ ciclo: string, seccion: string }>> = {
    7: [{ ciclo: 'I', seccion: 'A' }],
    8: [{ ciclo: 'II', seccion: 'B' }],
    9: [{ ciclo: 'I', seccion: 'A' }],
}

beforeEach(() => {
    jest.clearAllMocks()
    enlaces = [
        { id: 7, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', enlaceToken: TOKEN, enlaceCreadoEn: new Date('2026-10-22T10:00:00.000Z'), enlaceUltimoAcceso: null },
        { id: 8, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', enlaceToken: null, enlaceCreadoEn: null, enlaceUltimoAcceso: null },
        { id: 9, nombre: 'MG. MARIA LAURA BARRERA CAJACHAGUA', enlaceToken: null, enlaceCreadoEn: null, enlaceUltimoAcceso: null },
    ]
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? { id: 2, codigo: 'ciisic-viii', nombre: 'CIISIC VIII', estado: 'PUBLICADO' } : null))
    m.padronEstudiante.findMany.mockResolvedValue([
        alumno(1), alumno(2), alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', nombre: 'CÁRDENAS RÍOS DIEGO', celular: null }),
    ])
    // Una sola simulación para los dos usos de `asesor.findMany`: el seguimiento (con secciones) y los enlaces (con `select`)
    m.asesor.findMany.mockImplementation((args: { select?: unknown, where?: { id?: { in: number[] }, enlaceToken?: unknown } }) => {
        const ids = args.where?.id?.in
        let filas = enlaces.filter((a) => !ids || ids.includes(a.id))
        if (args.where && 'enlaceToken' in args.where) filas = filas.filter((a) => a.enlaceToken !== null)
        if (args.select) return Promise.resolve(filas)
        return Promise.resolve(enlaces.map((a) => ({ id: a.id, eventoId: 2, nombre: a.nombre, secciones: SECCIONES[a.id].map((s) => ({ asesorId: a.id, eventoId: 2, ...s })) })))
    })
    m.asesor.update.mockImplementation(({ where, data }: { where: { id: number }, data: Record<string, unknown> }) => {
        const fila = enlaces.find((a) => a.id === where.id)
        if (fila) Object.assign(fila, data)
        return Promise.resolve(fila)
    })
    m.asesor.updateMany.mockImplementation(({ where, data }: { where: { id: number, eventoId: number }, data: Record<string, unknown> }) => {
        const fila = enlaces.find((a) => a.id === where.id)
        if (fila) Object.assign(fila, data)
        return Promise.resolve({ count: fila ? 1 : 0 })
    })
    m.asesor.findUnique.mockImplementation(({ where }: { where: { enlaceToken: string } }) => {
        const fila = enlaces.find((a) => a.enlaceToken !== null && a.enlaceToken === where.enlaceToken)
        return Promise.resolve(fila ? { id: fila.id, nombre: fila.nombre, enlaceUltimoAcceso: fila.enlaceUltimoAcceso, evento: { id: 2, nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' } } : null)
    })
    m.inscripcion.findMany.mockResolvedValue([
        inscripcion(10, 'APROBADO', '2621010001', 40),
        inscripcion(11, 'PENDIENTE', '2621010002', 40),
        inscripcion(12, 'APROBADO', '2621010003', 100),
    ])
})

describe('enlaces públicos: administración', () => {
    it('crea solo los enlaces que faltan, con tokens de 43 caracteres', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({})
        expect(r.status).toBe(201)
        expect(r.headers['cache-control']).toBe('no-store')
        // El 7 ya tenía enlace y no se toca; el 8 y el 9 reciben uno nuevo
        expect(m.asesor.update.mock.calls.map((c) => c[0].where.id).sort()).toEqual([8, 9])
        const lista = r.body.data as Array<{ asesorId: number, token: string | null }>
        expect(lista.find((a) => a.asesorId === 7)?.token).toBe(TOKEN)
        for (const id of [8, 9]) expect(lista.find((a) => a.asesorId === id)?.token).toMatch(REGEX_TOKEN)
        expect(new Set(lista.map((a) => a.token)).size).toBe(3)
    })

    it('regenerar renueva también los existentes: el enlace anterior deja de valer', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({ regenerar: true })
        expect(r.status).toBe(201)
        expect(m.asesor.update).toHaveBeenCalledTimes(3)
        expect(r.body.data.find((a: { asesorId: number }) => a.asesorId === 7).token).not.toBe(TOKEN)
        const viejo = await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(viejo.status).toBe(404)
    })

    it('crea los de los asesores indicados y rechaza ids ajenos al evento o cuerpos inválidos', async () => {
        const uno = await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({ asesorIds: [8] })
        expect(uno.status).toBe(201)
        expect(m.asesor.update.mock.calls.map((c) => c[0].where.id)).toEqual([8])

        const ajeno = await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({ asesorIds: [8, 99] })
        expect(ajeno.status).toBe(404)
        expect(ajeno.body.code).toBe('ADVISOR_NOT_FOUND')

        expect((await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({ asesorIds: [] })).status).toBe(422)
        expect((await request(app).post('/api/v1/events/2/advisory/links').set(con(admin())).send({ asesorIds: ['x'] })).status).toBe(422)
    })

    it('lista los enlaces con su token y último acceso solo a quien gestiona el padrón', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/links').set(con(admin()))
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data[0]).toEqual({ asesorId: 7, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', token: TOKEN, creadoEn: '2026-10-22T10:00:00.000Z', ultimoAcceso: null })
        expect((await request(app).get('/api/v1/events/2/advisory/links')).status).toBe(401)
        // Ni el Tesorero ni la Comisión (aunque vean y descarguen reportes) ven ni crean enlaces
        for (const token of [tesorero(), comision()]) {
            expect((await request(app).get('/api/v1/events/2/advisory/links').set(con(token))).status).toBe(403)
            expect((await request(app).post('/api/v1/events/2/advisory/links').set(con(token)).send({})).status).toBe(403)
            expect((await request(app).delete('/api/v1/events/2/advisory/links/7').set(con(token))).status).toBe(403)
        }
    })

    it('desactivar el enlace lo borra y el token deja de abrir la vista', async () => {
        const r = await request(app).delete('/api/v1/events/2/advisory/links/7').set(con(admin()))
        expect(r.status).toBe(200)
        expect(m.asesor.updateMany).toHaveBeenCalledWith({ where: { id: 7, eventoId: 2 }, data: { enlaceToken: null, enlaceCreadoEn: null, enlaceUltimoAcceso: null } })
        expect(r.body.data.find((a: { asesorId: number }) => a.asesorId === 7).token).toBeNull()
        expect((await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)).status).toBe(404)
        const ajeno = await request(app).delete('/api/v1/events/2/advisory/links/99').set(con(admin()))
        expect(ajeno.status).toBe(404)
        expect(ajeno.body.code).toBe('ADVISOR_NOT_FOUND')
    })
})

describe('enlaces públicos: vista del docente', () => {
    it('muestra solo a los estudiantes del docente y solo lo necesario para el seguimiento', async () => {
        const r = await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
        const d = r.body.data
        expect(d.asesor).toEqual({ nombre: 'DRA. ANGOMA ASTUCURI MIRIAM' })
        expect(d.evento).toEqual({ nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' })
        expect(d.semestre).toBe('2026-2')
        expect(d.totales).toEqual({ alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5 })
        expect(d.secciones).toEqual([{ ciclo: 'I', seccion: 'A', turnos: ['M'], alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5 }])
        // Los estudiantes de otro docente (II-B) no salen
        expect(d.alumnos.map((a: { codigo: string }) => a.codigo)).toEqual(['2621010001', '2621010002'])
        expect(d.alumnos[0]).toEqual({ nombre: 'ALUMNO 1', codigo: '2621010001', ciclo: 'I', seccion: 'A', turno: 'M', celular: '920301747', situacion: 'PAGADO' })
    })

    it('nunca expone DNI, correo, montos, recaudado, inscripciones ni a otros asesores', async () => {
        const texto = JSON.stringify((await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)).body)
        for (const prohibido of ['documento', 'correo', 'monto', 'recaudado', 'fechaPago', 'inscripcionId', 'coincidencia', 'asesores', '60000001', '@undc.edu.pe', 'BARRERA', 'CÁRDENAS']) {
            expect({ prohibido, aparece: texto.includes(prohibido) }).toEqual({ prohibido, aparece: false })
        }
    })

    it('un token faltante, mal formado, desconocido o desactivado responde exactamente igual', async () => {
        const intentos = [
            request(app).get('/api/v1/public/advisor'),
            request(app).get('/api/v1/public/advisor').set('X-Link-Token', 'corto'),
            request(app).get('/api/v1/public/advisor').set('X-Link-Token', `${TOKEN}x`),
            request(app).get('/api/v1/public/advisor').set('X-Link-Token', OTRO),
        ]
        const respuestas = await Promise.all(intentos)
        for (const r of respuestas) expect({ status: r.status, code: r.body.code }).toEqual({ status: 404, code: 'LINK_NOT_FOUND' })
        expect(new Set(respuestas.map((r) => r.body.message)).size).toBe(1)
        // Un token mal formado ni siquiera consulta la base
        expect(m.asesor.findUnique).toHaveBeenCalledTimes(1)
    })

    it('anota el último acceso como máximo cada 5 minutos', async () => {
        await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(m.asesor.update).toHaveBeenCalledTimes(1)
        expect(enlaces[0].enlaceUltimoAcceso).toBeInstanceOf(Date)
        await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(m.asesor.update).toHaveBeenCalledTimes(1)
        enlaces[0].enlaceUltimoAcceso = new Date(Date.now() - 6 * 60 * 1000)
        await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(m.asesor.update).toHaveBeenCalledTimes(2)
    })

    it('si no se puede anotar el acceso, el docente igual ve su avance', async () => {
        m.asesor.update.mockRejectedValueOnce(new Error('BD ocupada'))
        const r = await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect(r.status).toBe(200)
    })
})

describe('enlaces públicos: descarga del docente', () => {
    const binario = (res: RespuestaHttp, cb: (error: Error | null, cuerpo: Buffer) => void) => {
        const partes: Buffer[] = []
        res.on('data', (parte: Buffer) => partes.push(parte))
        res.on('end', () => cb(null, Buffer.concat(partes)))
    }

    it('el Excel lleva su nombre y no tiene DNI, correo, montos ni asesores', async () => {
        const r = await request(app).get('/api/v1/public/advisor/export?formato=xlsx').set('X-Link-Token', TOKEN).buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(r.headers['content-disposition']).toContain(encodeURIComponent('DRA. ANGOMA ASTUCURI MIRIAM.xlsx'))
        expect(r.headers['cache-control']).toBe('no-store')
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(r.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Alumnos', 'Pagaron', 'No pagaron'])
        const cabecera = libro.getWorksheet('Alumnos')?.getRow(1).values as unknown[]
        expect(cabecera).toEqual(expect.arrayContaining(['Ciclo', 'Sección', 'Turno', 'Código', 'Alumno', 'Celular', 'Situación']))
        for (const oculto of ['DNI', 'Correo', 'Asesores', 'Monto (S/)', 'Fecha de pago']) expect(cabecera).not.toContain(oculto)
        expect(libro.getWorksheet('Alumnos')?.rowCount).toBe(3)
        const resumen: string[] = []
        libro.getWorksheet('Resumen')?.eachRow((fila) => fila.eachCell((celda) => { resumen.push(String(celda.value)) }))
        expect(resumen.join('|')).not.toMatch(/Recaudado|BARRERA|Asesores/)
    })

    it('entrega el PDF y valida el formato y el token', async () => {
        const pdf = await request(app).get('/api/v1/public/advisor/export?formato=pdf').set('X-Link-Token', TOKEN).buffer(true).parse(binario)
        expect(pdf.status).toBe(200)
        expect(pdf.headers['content-type']).toBe('application/pdf')
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        expect((await request(app).get('/api/v1/public/advisor/export?formato=csv').set('X-Link-Token', TOKEN)).status).toBe(422)
        expect((await request(app).get('/api/v1/public/advisor/export')).status).toBe(404)
        expect((await request(app).get('/api/v1/public/advisor/export?formato=xlsx').set('X-Link-Token', OTRO)).status).toBe(404)
    })
})

describe('enlaces públicos: al recargar el padrón', () => {
    async function libro(): Promise<Buffer> {
        const wb = new ExcelJS.Workbook()
        const hoja = wb.addWorksheet('ESTUDIANTES 2026-2')
        hoja.addRow(['SEMESTRE', 'DNI', 'CODIGO', 'EMAIL', 'ALUMNO', 'CELULAR', 'CARRERA', 'CICLO', 'TURNO', 'SECCIÓN'])
        hoja.addRow(['2026-2', 60344947, 2621010003, '2621010003@undc.edu.pe', 'ALBITES REYNALDO', 920301747, 'INGENIERÍA DE SISTEMAS', 'I', 'M', 'A'])
        const resumen = wb.addWorksheet('RESUMEN')
        resumen.addRow(['CICLO', 'SECCIÓN', 'ASESORES'])
        resumen.addRow(['I', 'A', 'dra. angoma astucuri miriam\nMG. MARIA LAURA BARRERA CAJACHAGUA'])
        return Buffer.from(await wb.xlsx.writeBuffer())
    }

    it('el asesor que ya tenía enlace lo conserva (por nombre, sin importar acentos ni mayúsculas) y los demás no reciben uno', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/import').set(con(admin())).attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(201)
        const creados = m.asesor.create.mock.calls.map((c) => c[0].data as Record<string, unknown>)
        const angoma = creados.find((d) => String(d.nombre).includes('ANGOMA') || String(d.nombre).includes('angoma'))
        const barrera = creados.find((d) => String(d.nombre).includes('BARRERA'))
        expect(angoma).toMatchObject({ enlaceToken: TOKEN, enlaceCreadoEn: new Date('2026-10-22T10:00:00.000Z'), enlaceUltimoAcceso: null })
        expect(barrera).not.toHaveProperty('enlaceToken')
    })
})

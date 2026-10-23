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
        padronSeccion: { findMany: jest.fn(), createMany: jest.fn() },
        asesor: { findMany: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
        enlaceCiclo: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
        inscripcion: { findMany: jest.fn() },
        $transaction: jest.fn(),
    }
    cliente.$transaction.mockImplementation(async (trabajo: (tx: typeof cliente) => Promise<unknown>) => trabajo(cliente))
    return { prisma: cliente }
})

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    padronEstudiante: { findMany: jest.Mock, deleteMany: jest.Mock, createMany: jest.Mock }
    padronSeccion: { findMany: jest.Mock, createMany: jest.Mock }
    asesor: { findMany: jest.Mock, findUnique: jest.Mock, deleteMany: jest.Mock, create: jest.Mock }
    enlaceCiclo: { findMany: jest.Mock, findUnique: jest.Mock, upsert: jest.Mock, update: jest.Mock, deleteMany: jest.Mock }
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

interface FilaEnlace { id: number, eventoId: number, ciclo: string, token: string, creadoEn: Date, ultimoAcceso: Date | null }
/** El ciclo I ya tiene enlace; el II no. */
let enlaces: FilaEnlace[]
let siguienteId: number

const mismo = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

beforeEach(() => {
    jest.clearAllMocks()
    siguienteId = 2
    enlaces = [{ id: 1, eventoId: 2, ciclo: 'I', token: TOKEN, creadoEn: new Date('2026-10-22T10:00:00.000Z'), ultimoAcceso: null }]
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? { id: 2, codigo: 'ciisic-viii', nombre: 'CIISIC VIII', estado: 'PUBLICADO' } : null))
    m.padronEstudiante.findMany.mockResolvedValue([
        alumno(1), alumno(2), alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', nombre: 'CÁRDENAS RÍOS DIEGO' }),
    ])
    // Spec 033: los ciclos y su cantidad de alumnos salen de las secciones (alumno y ciclo distintos)
    m.padronSeccion.findMany.mockResolvedValue([{ codigo: '2621010001', ciclo: 'I' }, { codigo: '2621010002', ciclo: 'I' }, { codigo: '2621010003', ciclo: 'II' }])
    m.asesor.findMany.mockResolvedValue([
        { id: 7, eventoId: 2, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ asesorId: 7, eventoId: 2, ciclo: 'I', seccion: 'A' }] },
        { id: 8, eventoId: 2, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', secciones: [{ asesorId: 8, eventoId: 2, ciclo: 'II', seccion: 'B' }] },
        { id: 9, eventoId: 2, nombre: 'MG. MARIA LAURA BARRERA CAJACHAGUA', secciones: [{ asesorId: 9, eventoId: 2, ciclo: 'I', seccion: 'A' }] },
    ])
    m.asesor.findUnique.mockResolvedValue(null)
    m.enlaceCiclo.findMany.mockImplementation(() => Promise.resolve(enlaces.map((e) => ({ ...e }))))
    m.enlaceCiclo.upsert.mockImplementation(({ where, create, update }: { where: { eventoId_ciclo: { eventoId: number, ciclo: string } }, create: Partial<FilaEnlace>, update: Partial<FilaEnlace> }) => {
        const existente = enlaces.find((e) => mismo(e.ciclo, where.eventoId_ciclo.ciclo))
        if (existente) {
            Object.assign(existente, update)
            return Promise.resolve(existente)
        }
        const nuevo = { id: siguienteId++, eventoId: 2, ciclo: where.eventoId_ciclo.ciclo, token: String(create.token), creadoEn: new Date(), ultimoAcceso: null }
        enlaces.push(nuevo)
        return Promise.resolve(nuevo)
    })
    m.enlaceCiclo.deleteMany.mockImplementation(({ where }: { where: { eventoId: number, ciclo: string } }) => {
        const antes = enlaces.length
        enlaces = enlaces.filter((e) => !mismo(e.ciclo, where.ciclo))
        return Promise.resolve({ count: antes - enlaces.length })
    })
    m.enlaceCiclo.findUnique.mockImplementation(({ where }: { where: { token: string } }) => {
        const fila = enlaces.find((e) => e.token === where.token)
        return Promise.resolve(fila ? { id: fila.id, ciclo: fila.ciclo, ultimoAcceso: fila.ultimoAcceso, evento: { id: 2, nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' } } : null)
    })
    m.enlaceCiclo.update.mockImplementation(({ where, data }: { where: { id: number }, data: Partial<FilaEnlace> }) => {
        const fila = enlaces.find((e) => e.id === where.id)
        if (fila) Object.assign(fila, data)
        return Promise.resolve(fila)
    })
    m.inscripcion.findMany.mockResolvedValue([
        inscripcion(10, 'APROBADO', '2621010001', 40),
        inscripcion(11, 'PENDIENTE', '2621010002', 40),
        inscripcion(12, 'APROBADO', '2621010003', 100),
    ])
})

describe('enlaces por ciclo: administración', () => {
    it('crea solo los enlaces que faltan, con tokens de 43 caracteres', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(admin())).send({})
        expect(r.status).toBe(201)
        expect(r.headers['cache-control']).toBe('no-store')
        // El ciclo I ya tenía enlace y no se toca; el II recibe uno nuevo
        expect(m.enlaceCiclo.upsert.mock.calls.map((c) => c[0].where.eventoId_ciclo.ciclo)).toEqual(['II'])
        const lista = r.body.data as Array<{ ciclo: string, alumnos: number, token: string | null }>
        expect(lista.map((c) => [c.ciclo, c.alumnos])).toEqual([['I', 2], ['II', 1]])
        expect(lista[0].token).toBe(TOKEN)
        expect(lista[1].token).toMatch(REGEX_TOKEN)
    })

    it('regenerar renueva también los existentes: el enlace anterior deja de valer', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(admin())).send({ regenerar: true })
        expect(r.status).toBe(201)
        expect(m.enlaceCiclo.upsert).toHaveBeenCalledTimes(2)
        expect(r.body.data.find((c: { ciclo: string }) => c.ciclo === 'I').token).not.toBe(TOKEN)
        expect((await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)).status).toBe(404)
    })

    it('crea los de los ciclos indicados (sin importar mayúsculas) y rechaza ciclos ajenos al padrón o cuerpos inválidos', async () => {
        const uno = await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(admin())).send({ ciclos: [' ii '] })
        expect(uno.status).toBe(201)
        // Se guarda el ciclo como viene en el padrón, no como se escribió
        expect(m.enlaceCiclo.upsert.mock.calls.map((c) => c[0].where.eventoId_ciclo.ciclo)).toEqual(['II'])

        const ajeno = await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(admin())).send({ ciclos: ['II', 'X'] })
        expect(ajeno.status).toBe(404)
        expect(ajeno.body.code).toBe('CYCLE_NOT_FOUND')

        for (const cuerpo of [{ ciclos: [] }, { ciclos: [''] }, { ciclos: ['ABCDEFGHIJK'] }, { ciclos: 'II' }, { regenerar: 'quizá' }]) {
            expect((await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(admin())).send(cuerpo)).status).toBe(422)
        }
    })

    it('lista cada ciclo del padrón con su enlace y su último acceso, y muestra un enlace cuyo ciclo ya no está en el padrón', async () => {
        enlaces.push({ id: 5, eventoId: 2, ciclo: 'IX', token: OTRO, creadoEn: new Date('2026-10-20T10:00:00.000Z'), ultimoAcceso: new Date('2026-10-21T10:00:00.000Z') })
        const r = await request(app).get('/api/v1/events/2/advisory/cycle-links').set(con(admin()))
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data).toEqual([
            { ciclo: 'I', alumnos: 2, token: TOKEN, creadoEn: '2026-10-22T10:00:00.000Z', ultimoAcceso: null },
            { ciclo: 'II', alumnos: 1, token: null, creadoEn: null, ultimoAcceso: null },
            { ciclo: 'IX', alumnos: 0, token: OTRO, creadoEn: '2026-10-20T10:00:00.000Z', ultimoAcceso: '2026-10-21T10:00:00.000Z' },
        ])
    })

    it('solo quien gestiona el padrón ve, crea o desactiva enlaces (ni el Tesorero ni la Comisión)', async () => {
        expect((await request(app).get('/api/v1/events/2/advisory/cycle-links')).status).toBe(401)
        for (const token of [tesorero(), comision()]) {
            expect((await request(app).get('/api/v1/events/2/advisory/cycle-links').set(con(token))).status).toBe(403)
            expect((await request(app).post('/api/v1/events/2/advisory/cycle-links').set(con(token)).send({})).status).toBe(403)
            expect((await request(app).delete('/api/v1/events/2/advisory/cycle-links/I').set(con(token))).status).toBe(403)
        }
        expect(m.enlaceCiclo.upsert).not.toHaveBeenCalled()
        expect(m.enlaceCiclo.deleteMany).not.toHaveBeenCalled()
    })

    it('desactivar el enlace lo borra y el token deja de abrir la vista', async () => {
        const r = await request(app).delete('/api/v1/events/2/advisory/cycle-links/I').set(con(admin()))
        expect(r.status).toBe(200)
        expect(m.enlaceCiclo.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2, ciclo: 'I' } })
        expect(r.body.data.find((c: { ciclo: string }) => c.ciclo === 'I').token).toBeNull()
        expect((await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)).status).toBe(404)
    })

    it('desactivar un ciclo sin enlace es válido; uno que no existe o es inválido, no', async () => {
        expect((await request(app).delete('/api/v1/events/2/advisory/cycle-links/II').set(con(admin()))).status).toBe(200)
        const ajeno = await request(app).delete('/api/v1/events/2/advisory/cycle-links/X').set(con(admin()))
        expect(ajeno.status).toBe(404)
        expect(ajeno.body.code).toBe('CYCLE_NOT_FOUND')
        expect((await request(app).delete('/api/v1/events/2/advisory/cycle-links/ABCDEFGHIJK').set(con(admin()))).status).toBe(422)
    })
})

describe('enlaces por ciclo: vista pública', () => {
    it('muestra a todos los estudiantes del ciclo y solo lo necesario para el seguimiento', async () => {
        const r = await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.headers['x-robots-tag']).toBe('noindex, nofollow')
        const d = r.body.data
        expect(d.ciclo).toBe('I')
        expect(d.evento).toEqual({ nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026' })
        expect(d.semestre).toBe('2026-2')
        expect(d.totales).toEqual({ alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5 })
        // Cada sección lleva el nombre de sus asesores
        expect(d.secciones).toEqual([{
            ciclo: 'I', seccion: 'A', turnos: ['M'], asesores: ['DRA. ANGOMA ASTUCURI MIRIAM', 'MG. MARIA LAURA BARRERA CAJACHAGUA'],
            alumnos: 2, pagaron: 1, enRevision: 1, rechazados: 0, sinInscripcion: 0, noPagaron: 1, avance: 0.5,
        }])
        // Los estudiantes de otro ciclo (II) no salen; y sin celular
        expect(d.alumnos.map((a: { codigo: string }) => a.codigo)).toEqual(['2621010001', '2621010002'])
        expect(d.alumnos[0]).toEqual({ nombre: 'ALUMNO 1', codigo: '2621010001', ciclo: 'I', seccion: 'A', turno: 'M', secciones: ['I-A'], situacion: 'PAGADO' })
    })

    it('nunca expone DNI, correo, celular, montos, recaudado, inscripciones ni a otros ciclos', async () => {
        const texto = JSON.stringify((await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)).body)
        for (const prohibido of ['documento', 'correo', 'celular', 'monto', 'recaudado', 'fechaPago', 'inscripcionId', 'coincidencia', '920301747', '60000001', '@undc.edu.pe', 'CÁRDENAS']) {
            expect({ prohibido, aparece: texto.includes(prohibido) }).toEqual({ prohibido, aparece: false })
        }
    })

    it('un token faltante, mal formado, desconocido o desactivado responde exactamente igual', async () => {
        const respuestas = await Promise.all([
            request(app).get('/api/v1/public/cycle'),
            request(app).get('/api/v1/public/cycle').set('X-Link-Token', 'corto'),
            request(app).get('/api/v1/public/cycle').set('X-Link-Token', `${TOKEN}x`),
            request(app).get('/api/v1/public/cycle').set('X-Link-Token', OTRO),
        ])
        for (const r of respuestas) expect({ status: r.status, code: r.body.code }).toEqual({ status: 404, code: 'LINK_NOT_FOUND' })
        expect(new Set(respuestas.map((r) => r.body.message)).size).toBe(1)
        // Un token mal formado ni siquiera consulta la base
        expect(m.enlaceCiclo.findUnique).toHaveBeenCalledTimes(1)
    })

    it('el enlace de un ciclo no abre la vista de un docente ni al revés', async () => {
        const comoDocente = await request(app).get('/api/v1/public/advisor').set('X-Link-Token', TOKEN)
        expect({ status: comoDocente.status, code: comoDocente.body.code }).toEqual({ status: 404, code: 'LINK_NOT_FOUND' })
        // Un token de docente (que aquí no existe en `enlaces_ciclo`) tampoco abre el ciclo
        m.enlaceCiclo.findUnique.mockResolvedValueOnce(null)
        const comoCiclo = await request(app).get('/api/v1/public/cycle').set('X-Link-Token', OTRO)
        expect({ status: comoCiclo.status, code: comoCiclo.body.code }).toEqual({ status: 404, code: 'LINK_NOT_FOUND' })
    })

    it('anota el último acceso como máximo cada 5 minutos', async () => {
        await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)
        expect(m.enlaceCiclo.update).toHaveBeenCalledTimes(1)
        expect(enlaces[0].ultimoAcceso).toBeInstanceOf(Date)
        await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)
        expect(m.enlaceCiclo.update).toHaveBeenCalledTimes(1)
        enlaces[0].ultimoAcceso = new Date(Date.now() - 6 * 60 * 1000)
        await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)
        expect(m.enlaceCiclo.update).toHaveBeenCalledTimes(2)
    })

    it('si no se puede anotar el acceso, igual se ve el avance', async () => {
        m.enlaceCiclo.update.mockRejectedValueOnce(new Error('BD ocupada'))
        expect((await request(app).get('/api/v1/public/cycle').set('X-Link-Token', TOKEN)).status).toBe(200)
    })
})

describe('enlaces por ciclo: descarga', () => {
    const binario = (res: RespuestaHttp, cb: (error: Error | null, cuerpo: Buffer) => void) => {
        const partes: Buffer[] = []
        res.on('data', (parte: Buffer) => partes.push(parte))
        res.on('end', () => cb(null, Buffer.concat(partes)))
    }

    it('el Excel lleva el ciclo y los asesores de cada sección, sin DNI, correo, celular ni montos', async () => {
        const r = await request(app).get('/api/v1/public/cycle/export?formato=xlsx').set('X-Link-Token', TOKEN).buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(r.headers['content-disposition']).toContain(encodeURIComponent('Seguimiento ciclo I.xlsx'))
        expect(r.headers['cache-control']).toBe('no-store')
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(r.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Alumnos', 'Pagaron', 'No pagaron'])
        const cabecera = libro.getWorksheet('Alumnos')?.getRow(1).values as unknown[]
        expect(cabecera).toEqual(expect.arrayContaining(['Ciclo', 'Sección', 'Turno', 'Código', 'Alumno', 'Situación', 'Asesores']))
        for (const oculto of ['DNI', 'Correo', 'Celular', 'Monto (S/)', 'Fecha de pago']) expect(cabecera).not.toContain(oculto)
        expect(libro.getWorksheet('Alumnos')?.rowCount).toBe(3)
        const resumen: string[] = []
        libro.getWorksheet('Resumen')?.eachRow((fila) => fila.eachCell((celda) => { resumen.push(String(celda.value)) }))
        const texto = resumen.join('|')
        expect(texto).toContain('BARRERA')
        expect(texto).not.toMatch(/Recaudado|CÁRDENAS|sin asesor/)
    })

    it('entrega el PDF y valida el formato y el token', async () => {
        const pdf = await request(app).get('/api/v1/public/cycle/export?formato=pdf').set('X-Link-Token', TOKEN).buffer(true).parse(binario)
        expect(pdf.status).toBe(200)
        expect(pdf.headers['content-type']).toBe('application/pdf')
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        expect((await request(app).get('/api/v1/public/cycle/export?formato=csv').set('X-Link-Token', TOKEN)).status).toBe(422)
        expect((await request(app).get('/api/v1/public/cycle/export')).status).toBe(404)
        expect((await request(app).get('/api/v1/public/cycle/export?formato=xlsx').set('X-Link-Token', OTRO)).status).toBe(404)
    })
})

describe('enlaces por ciclo: al recargar el padrón', () => {
    it('los enlaces de los ciclos no se tocan (viven aparte del padrón)', async () => {
        const wb = new ExcelJS.Workbook()
        const hoja = wb.addWorksheet('ESTUDIANTES 2026-2')
        hoja.addRow(['SEMESTRE', 'DNI', 'CODIGO', 'EMAIL', 'ALUMNO', 'CELULAR', 'CARRERA', 'CICLO', 'TURNO', 'SECCIÓN'])
        hoja.addRow(['2026-2', 60344947, 2621010003, '2621010003@undc.edu.pe', 'ALBITES REYNALDO', 920301747, 'INGENIERÍA DE SISTEMAS', 'I', 'M', 'A'])
        const resumen = wb.addWorksheet('RESUMEN')
        resumen.addRow(['CICLO', 'SECCIÓN', 'ASESORES'])
        resumen.addRow(['I', 'A', 'DRA. ANGOMA ASTUCURI MIRIAM'])
        const libro = Buffer.from(await wb.xlsx.writeBuffer())
        m.asesor.findMany.mockResolvedValue([])

        const r = await request(app).post('/api/v1/events/2/advisory/import').set(con(admin())).attach('file', libro, 'padron.xlsx')
        expect(r.status).toBe(201)
        expect(m.padronEstudiante.deleteMany).toHaveBeenCalled()
        expect(m.enlaceCiclo.deleteMany).not.toHaveBeenCalled()
        expect(m.enlaceCiclo.upsert).not.toHaveBeenCalled()
        expect(enlaces.map((e) => e.token)).toEqual([TOKEN])
    })
})

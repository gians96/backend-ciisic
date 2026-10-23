import ExcelJS from 'exceljs'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const cliente = {
        evento: { findUnique: jest.fn() },
        padronEstudiante: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
        padronSeccion: { createMany: jest.fn() },
        padronCurso: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
        padronMatricula: { createMany: jest.fn() },
        asesor: { findMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() },
        inscripcion: { findMany: jest.fn() },
        $transaction: jest.fn(),
    }
    cliente.$transaction.mockImplementation(async (trabajo: (tx: typeof cliente) => Promise<unknown>) => trabajo(cliente))
    return { prisma: cliente }
})

const m = prisma as unknown as {
    evento: { findUnique: jest.Mock }
    padronEstudiante: { findMany: jest.Mock, deleteMany: jest.Mock, createMany: jest.Mock }
    padronSeccion: { createMany: jest.Mock }
    asesor: { findMany: jest.Mock, deleteMany: jest.Mock, create: jest.Mock }
    inscripcion: { findMany: jest.Mock }
}

const owner = () => tokenDeRol('SUPERADMIN', 1)
const admin = () => tokenDeRol('ADMIN', 2)
const tesorero = (eventoIds = [2]) => tokenDeRol('TESORERO', 30, { eventoIds })
const comision = (permisos: string[]) => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })
const con = (token: string) => ({ Authorization: `Bearer ${token}` })

const alumno = (id: number, extra: Record<string, unknown> = {}) => ({
    id, eventoId: 2, semestre: '2026-2', documento: `6000000${id}`, codigo: `262101000${id}`, correo: `262101000${id}@undc.edu.pe`,
    nombre: `ALUMNO ${id}`, celular: '920301747', carrera: 'INGENIERÍA DE SISTEMAS', ciclo: 'I', turno: 'M', seccion: 'A',
    distrito: null, provincia: null, departamento: null, creadoEn: new Date('2026-10-21T12:00:00.000Z'), ...extra,
})
const inscripcion = (id: number, estado: string, codigoEstudiante: string, monto = 40) => ({
    id, monto, fechaPago: new Date('2026-10-19T00:00:00.000Z'), codigoEstudiante, estado: { codigo: estado },
    participante: { tipoDocumentoId: 'dni', numeroDocumento: '00000000', correo: `otro${id}@gmail.com` },
})

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? { id: 2, codigo: 'ciisic-viii', nombre: 'CIISIC VIII', estado: 'PUBLICADO' } : null))
    m.padronEstudiante.findMany.mockResolvedValue([
        alumno(1), alumno(2), alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', nombre: 'CÁRDENAS RÍOS DIEGO' }), alumno(4, { ciclo: 'III', seccion: 'C' }),
    ])
    m.asesor.findMany.mockResolvedValue([
        { id: 7, eventoId: 2, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ asesorId: 7, eventoId: 2, ciclo: 'I', seccion: 'A' }] },
        { id: 8, eventoId: 2, nombre: 'MG. CÁRDENAS LINO CÉSAR ANDY', secciones: [{ asesorId: 8, eventoId: 2, ciclo: 'II', seccion: 'B' }] },
    ])
    m.inscripcion.findMany.mockResolvedValue([
        inscripcion(10, 'APROBADO', '2621010001'),
        inscripcion(11, 'PENDIENTE', '2621010002'),
        inscripcion(12, 'APROBADO', '2621010003', 100),
    ])
})

describe('resumen del seguimiento', () => {
    it('el Tesorero ve indicadores, cuadros y recaudado', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/summary').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({
            semestre: '2026-2', hayPadron: true, conPago: true, alumnosSinAsesor: 1,
            totales: { alumnos: 4, pagaron: 2, enRevision: 1, rechazados: 0, sinInscripcion: 1, noPagaron: 2, avance: 0.5, recaudado: 140 },
        })
        expect(r.body.data.porCiclo.map((c: { ciclo: string }) => c.ciclo)).toEqual(['I', 'II', 'III'])
        expect(r.body.data.porAsesor.map((a: { id: number, alumnos: number, pagaron: number }) => [a.id, a.alumnos, a.pagaron])).toEqual([[7, 2, 1], [8, 1, 1]])
        expect(r.body.data.opciones.asesores).toHaveLength(2)
        expect(r.body.data.importadoEn).toBe('2026-10-21T12:00:00.000Z')
    })

    it('al elegir un asesor, el resumen es solo de sus alumnos pero las opciones siguen completas', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/summary?asesorId=7').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data.totales).toMatchObject({ alumnos: 2, pagaron: 1, enRevision: 1 })
        expect(r.body.data.porAsesor.map((a: { id: number }) => a.id)).toEqual([7])
        expect(r.body.data.opciones.ciclos).toEqual(['I', 'II', 'III'])
    })

    it('sin «pagos.ver» (Comisión) llegan las cuentas pero no los montos', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/summary').set(con(comision(['reportes.ver'])))
        expect(r.status).toBe(200)
        expect(r.body.data.conPago).toBe(false)
        expect(r.body.data.totales).toMatchObject({ pagaron: 2, recaudado: null })
        const lista = await request(app).get('/api/v1/events/2/advisory/students').set(con(comision(['reportes.ver'])))
        expect(lista.body.data.every((f: { monto: number | null, fechaPago: string | null }) => f.monto === null && f.fechaPago === null)).toBe(true)
    })

    it('sin padrón cargado responde vacío para que el panel ofrezca importarlo', async () => {
        m.padronEstudiante.findMany.mockResolvedValue([])
        m.asesor.findMany.mockResolvedValue([])
        const r = await request(app).get('/api/v1/events/2/advisory/summary').set(con(admin()))
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ hayPadron: false, semestre: null, totales: { alumnos: 0, avance: 0 } })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('exige el permiso y el evento asignado', async () => {
        expect((await request(app).get('/api/v1/events/2/advisory/summary')).status).toBe(401)
        expect((await request(app).get('/api/v1/events/2/advisory/summary').set(con(comision(['asistencia.marcar'])))).status).toBe(403)
        const otroEvento = await request(app).get('/api/v1/events/2/advisory/summary').set(con(tesorero([3])))
        expect(otroEvento.status).toBe(403)
        expect(otroEvento.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect((await request(app).get('/api/v1/events/9/advisory/summary').set(con(admin()))).status).toBe(404)
    })
})

describe('listado de alumnos', () => {
    it('filtra por situación y por asesor, y pagina', async () => {
        const noPagaron = await request(app).get('/api/v1/events/2/advisory/students?situacion=no_pagado').set(con(tesorero()))
        expect(noPagaron.status).toBe(200)
        expect(noPagaron.body.data.map((f: { id: number }) => f.id)).toEqual([2, 4])
        expect(noPagaron.body.meta).toEqual({ page: 1, pageSize: 50, total: 2 })

        const delAsesor = await request(app).get('/api/v1/events/2/advisory/students?asesorId=8').set(con(tesorero()))
        expect(delAsesor.body.data).toHaveLength(1)
        expect(delAsesor.body.data[0]).toMatchObject({ nombre: 'CÁRDENAS RÍOS DIEGO', situacion: 'PAGADO', monto: 100, asesores: [{ id: 8 }] })

        const pagina = await request(app).get('/api/v1/events/2/advisory/students?page=2&pageSize=3').set(con(tesorero()))
        expect(pagina.body.data).toHaveLength(1)
        expect(pagina.body.meta).toEqual({ page: 2, pageSize: 3, total: 4 })

        const busqueda = await request(app).get('/api/v1/events/2/advisory/students?q=cardenas').set(con(tesorero()))
        expect(busqueda.body.data.map((f: { id: number }) => f.id)).toEqual([3])
    })

    it('un filtro inválido responde 422 en lugar de ignorarse', async () => {
        const situacion = await request(app).get('/api/v1/events/2/advisory/students?situacion=PAGO').set(con(tesorero()))
        expect(situacion.status).toBe(422)
        expect(Object.keys(situacion.body.fields)).toEqual(['situacion'])
        const asesor = await request(app).get('/api/v1/events/2/advisory/students?asesorId=abc').set(con(tesorero()))
        expect(asesor.status).toBe(422)
        expect(Object.keys(asesor.body.fields)).toEqual(['asesorId'])
    })
})

describe('descarga del reporte', () => {
    it('entrega el Excel del asesor con su nombre y el contenido de sus alumnos', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/export?formato=xlsx&asesorId=7').set(con(tesorero())).buffer(true).parse((res, cb) => {
            const partes: Buffer[] = []
            res.on('data', (parte: Buffer) => partes.push(parte))
            res.on('end', () => cb(null, Buffer.concat(partes)))
        })
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toContain('spreadsheetml.sheet')
        expect(r.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('DRA. ANGOMA ASTUCURI MIRIAM.xlsx')}`)
        expect(r.headers['cache-control']).toBe('no-store')

        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(r.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Alumnos', 'Pagaron', 'No pagaron'])
        expect(libro.getWorksheet('Alumnos')?.rowCount).toBe(3) // cabecera + 2 alumnos de I-A
        expect(libro.getWorksheet('Pagaron')?.rowCount).toBe(2)
        expect(libro.getWorksheet('No pagaron')?.rowCount).toBe(2)
        expect(libro.getWorksheet('Alumnos')?.getRow(1).values).toContain('Monto (S/)')
    })

    it('el reporte de una cuenta sin «pagos.ver» no lleva columnas de dinero', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/export?formato=xlsx').set(con(comision(['reportes.exportar']))).buffer(true).parse((res, cb) => {
            const partes: Buffer[] = []
            res.on('data', (parte: Buffer) => partes.push(parte))
            res.on('end', () => cb(null, Buffer.concat(partes)))
        })
        expect(r.status).toBe(200)
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(r.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        const cabecera = libro.getWorksheet('Alumnos')?.getRow(1).values as unknown[]
        expect(cabecera).not.toContain('Monto (S/)')
        expect(cabecera).not.toContain('Fecha de pago')
    })

    it('entrega el PDF', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/export?formato=pdf&ciclo=I').set(con(tesorero())).buffer(true).parse((res, cb) => {
            const partes: Buffer[] = []
            res.on('data', (parte: Buffer) => partes.push(parte))
            res.on('end', () => cb(null, Buffer.concat(partes)))
        })
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('application/pdf')
        expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        expect(r.headers['content-disposition']).toContain('Seguimiento ciisic-viii I ')
    })

    it('valida formato y asesor, exige el padrón y el permiso de exportar', async () => {
        expect((await request(app).get('/api/v1/events/2/advisory/export?formato=csv').set(con(tesorero()))).status).toBe(422)
        const sinAsesor = await request(app).get('/api/v1/events/2/advisory/export?asesorId=99').set(con(tesorero()))
        expect(sinAsesor.status).toBe(404)
        expect(sinAsesor.body.code).toBe('ADVISOR_NOT_FOUND')
        // Ver no basta para descargar
        expect((await request(app).get('/api/v1/events/2/advisory/export').set(con(comision(['reportes.ver'])))).status).toBe(403)
        m.padronEstudiante.findMany.mockResolvedValue([])
        const sinPadron = await request(app).get('/api/v1/events/2/advisory/export').set(con(admin()))
        expect(sinPadron.status).toBe(409)
        expect(sinPadron.body.code).toBe('PADRON_NOT_LOADED')
    })
})

describe('carga del padrón', () => {
    async function libro(opciones: { nombreHoja?: string } = {}): Promise<Buffer> {
        const wb = new ExcelJS.Workbook()
        const hoja = wb.addWorksheet(opciones.nombreHoja ?? 'ESTUDIANTES 2026-2')
        hoja.addRow(['SEMESTRE', 'DNI', 'CODIGO', 'EMAIL', 'ALUMNO', 'CELULAR', 'CARRERA', 'CICLO', 'TURNO', 'SECCIÓN'])
        hoja.addRow(['2026-2', 60344947, 2621010003, '2621010003@undc.edu.pe', 'ALBITES REYNALDO', 920301747, 'INGENIERÍA DE SISTEMAS', 'I', 'M', 'A'])
        hoja.addRow(['2026-2', 60344948, 2621010004, '2621010004@undc.edu.pe', 'BLANCAS DIEGO', 920301748, 'INGENIERÍA DE SISTEMAS', 'II', 'T', 'B'])
        const resumen = wb.addWorksheet('RESUMEN')
        resumen.addRow(['CICLO', 'SECCIÓN', 'CANTIDAD PAGARON', 'TOTAL POR CICLO', 'RECAUDADO', 'ASESORES'])
        resumen.addRow(['I', 'A', 0, 0, 0, 'DRA. ANGOMA ASTUCURI MIRIAM\nMG. MARIA LAURA BARRERA CAJACHAGUA'])
        resumen.addRow(['II', 'B', 0, 0, 0, 'MG. MARIA LAURA BARRERA CAJACHAGUA'])
        return Buffer.from(await wb.xlsx.writeBuffer())
    }

    it('con «simular» solo valida y cuenta: no guarda nada', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).field('asesores', 'reemplazar').attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ semestre: '2026-2', estudiantes: 2, asesores: 2, secciones: 2, advertencias: [], aplicado: false, asesoresConservados: false })
        expect(m.padronEstudiante.deleteMany).not.toHaveBeenCalled()
        expect(m.padronEstudiante.createMany).not.toHaveBeenCalled()
        expect(m.padronSeccion.createMany).not.toHaveBeenCalled()
    })

    it('con «reemplazar» reemplaza el padrón y los asesores del evento en una sola transacción', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/import').set(con(owner())).field('asesores', 'reemplazar').attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ aplicado: true, estudiantes: 2, asesores: 2, asesoresConservados: false })
        expect(m.asesor.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2 } })
        expect(m.padronEstudiante.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2 } })
        const guardados = m.padronEstudiante.createMany.mock.calls[0][0].data
        expect(guardados).toHaveLength(2)
        expect(guardados[0]).toMatchObject({ eventoId: 2, semestre: '2026-2', documento: '60344947', codigo: '2621010003', ciclo: 'I', seccion: 'A', turno: 'M' })
        // Spec 033: cada alumno del Excel queda con su única sección en `padron_secciones` (y la columna `secciones` no va a `padron_estudiantes`)
        expect(guardados[0]).not.toHaveProperty('secciones')
        expect(m.padronSeccion.createMany).toHaveBeenCalledWith({
            data: [
                { eventoId: 2, codigo: '2621010003', ciclo: 'I', seccion: 'A', turno: 'M', cursos: 1 },
                { eventoId: 2, codigo: '2621010004', ciclo: 'II', seccion: 'B', turno: 'T', cursos: 1 },
            ],
        })
        expect(m.asesor.create).toHaveBeenCalledTimes(2)
        const barrera = m.asesor.create.mock.calls.map((c) => c[0].data).find((d: { nombre: string }) => d.nombre.includes('BARRERA'))
        expect(barrera.secciones.create).toEqual([{ eventoId: 2, ciclo: 'I', seccion: 'A' }, { eventoId: 2, ciclo: 'II', seccion: 'B' }])
    })

    it('sin indicar nada conserva los docentes que ya hay (spec 028): solo se reemplazan los estudiantes', async () => {
        const simulada = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).attach('file', await libro(), 'padron.xlsx')
        expect(simulada.status).toBe(200)
        // Los 2 docentes y las 2 secciones son los que ya había, no los del Excel
        expect(simulada.body.data).toMatchObject({ estudiantes: 2, asesores: 2, secciones: 2, aplicado: false, asesoresConservados: true })
        expect(simulada.body.data.advertencias[0]).toMatch(/Se conservaron los docentes/)

        const r = await request(app).post('/api/v1/events/2/advisory/import').set(con(owner())).attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ aplicado: true, asesoresConservados: true })
        expect(m.padronEstudiante.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2 } })
        expect(m.padronEstudiante.createMany).toHaveBeenCalledTimes(1)
        expect(m.padronSeccion.createMany).toHaveBeenCalledTimes(1)
        expect(m.asesor.deleteMany).not.toHaveBeenCalled()
        expect(m.asesor.create).not.toHaveBeenCalled()
    })

    it('avisa de la sección que un docente conserva y que el padrón nuevo ya no trae', async () => {
        m.asesor.findMany.mockResolvedValue([{ id: 7, eventoId: 2, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ asesorId: 7, eventoId: 2, ciclo: 'V', seccion: 'Z' }] }])
        const r = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).attach('file', await libro(), 'padron.xlsx')
        expect(r.body.data.advertencias).toContain('DRA. ANGOMA ASTUCURI MIRIAM tiene la sección V-Z, que no está en este padrón.')
    })

    it('la primera carga (sin docentes) toma los del Excel, aunque se pida conservar', async () => {
        m.asesor.findMany.mockResolvedValue([])
        const r = await request(app).post('/api/v1/events/2/advisory/import').set(con(owner())).field('asesores', 'conservar').attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ aplicado: true, asesores: 2, asesoresConservados: false })
        expect(m.asesor.create).toHaveBeenCalledTimes(2)
    })

    it('rechaza un valor de «asesores» que no sea conservar o reemplazar', async () => {
        const r = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).field('asesores', 'borrar').attach('file', await libro(), 'padron.xlsx')
        expect(r.status).toBe(422)
        expect(r.body.fields.asesores).toBeDefined()
    })

    it('pide el semestre cuando no se puede deducir y acepta el que escribe la persona', async () => {
        const sinSemestre = await libro({ nombreHoja: 'ESTUDIANTES' })
        // La columna SEMESTRE trae «2026-2» como texto, así que se deduce; se prueba el reemplazo explícito
        const r = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).field('semestre', '2026-1').attach('file', sinSemestre, 'padron.xlsx')
        expect(r.body.data.semestre).toBe('2026-1')
        const invalido = await request(app).post('/api/v1/events/2/advisory/import?simular=true').set(con(admin())).field('semestre', 'verano').attach('file', sinSemestre, 'padron.xlsx')
        expect(invalido.status).toBe(422)
        expect(invalido.body.code).toBe('PADRON_SEMESTER_REQUIRED')
    })

    it('rechaza lo que no es un Excel y exige el permiso de gestionar', async () => {
        const noExcel = await request(app).post('/api/v1/events/2/advisory/import').set(con(admin())).attach('file', Buffer.from('hola'), 'padron.csv')
        expect(noExcel.status).toBe(422)
        expect(noExcel.body.code).toBe('INVALID_FILE_TYPE')
        const falso = await request(app).post('/api/v1/events/2/advisory/import').set(con(admin())).attach('file', Buffer.from('no soy un zip'), 'padron.xlsx')
        expect(falso.status).toBe(422)
        expect(falso.body.code).toBe('INVALID_FILE_CONTENT')
        const sinArchivo = await request(app).post('/api/v1/events/2/advisory/import').set(con(admin()))
        expect(sinArchivo.status).toBe(422)
        // Ni el Tesorero ni la Comisión cargan el padrón
        expect((await request(app).post('/api/v1/events/2/advisory/import').set(con(tesorero())).attach('file', await libro(), 'padron.xlsx')).status).toBe(403)
        expect((await request(app).post('/api/v1/events/2/advisory/import').set(con(comision(['reportes.exportar']))).attach('file', await libro(), 'padron.xlsx')).status).toBe(403)
        expect(m.padronEstudiante.createMany).not.toHaveBeenCalled()
        expect(m.padronSeccion.createMany).not.toHaveBeenCalled()
    })
})

describe('cursos de SIVIRENO (spec 034)', () => {
    const docente = (id: number, nombre: string) => ({ id, nombre })
    const matricula = (id: number, nombre: string, ciclo: string, seccion: string, asesor: { id: number, nombre: string } | null) =>
        ({ curso: { id, codigo: `ISES${id}`, nombre, ciclo, seccion, turno: 'M', asesor } })
    const PROGRAMACION = matricula(1, 'PROGRAMACIÓN WEB', 'I', 'A', docente(7, 'DRA. ANGOMA ASTUCURI MIRIAM'))
    const REDES = matricula(2, 'REDES', 'II', 'B', docente(8, 'MG. CÁRDENAS LINO CÉSAR ANDY'))

    beforeEach(() => {
        // El 1 cursa PROGRAMACIÓN y REDES, el 2 solo PROGRAMACIÓN, el 3 solo REDES
        m.padronEstudiante.findMany.mockResolvedValue([
            alumno(1, { matriculas: [REDES, PROGRAMACION] }),
            alumno(2, { matriculas: [PROGRAMACION] }),
            alumno(3, { ciclo: 'II', seccion: 'B', turno: 'T', matriculas: [REDES] }),
        ])
    })

    it('el resumen trae cada curso con su docente y cuántos de sus matriculados pagaron, y los cursos como opción de filtro', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/summary').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data.totales).toMatchObject({ alumnos: 3, pagaron: 2, enRevision: 1 })
        expect(r.body.data.porCurso.map((c: { id: number, nombre: string, alumnos: number, pagaron: number, enRevision: number, docente: { id: number } }) => [c.id, c.nombre, c.alumnos, c.pagaron, c.enRevision, c.docente.id]))
            .toEqual([[1, 'PROGRAMACIÓN WEB', 2, 1, 1, 7], [2, 'REDES', 2, 2, 0, 8]])
        expect(r.body.data.opciones.cursos.map((c: { id: number }) => c.id)).toEqual([1, 2])
    })

    it('con cursos, quien no tiene curso queda sin docente aunque su sección tenga uno: el docente es el de los cursos', async () => {
        m.padronEstudiante.findMany.mockResolvedValue([
            alumno(1, { matriculas: [PROGRAMACION] }),
            // Del Excel o sin matrícula en SIVIRENO: su sección I-A tiene a la docente 7, pero no está en ninguno de sus cursos
            alumno(4, { matriculas: [] }),
        ])
        const r = await request(app).get('/api/v1/events/2/advisory/students?q=ALUMNO').set(con(tesorero()))
        const sinCurso = r.body.data.find((f: { id: number }) => f.id === 4)
        expect(sinCurso).toMatchObject({ cursos: [], asesores: [] })
        const resumen = await request(app).get('/api/v1/events/2/advisory/summary').set(con(tesorero()))
        expect(resumen.body.data.alumnosSinAsesor).toBe(1)
        // El docente 7 solo cuenta al alumno de su curso
        expect(resumen.body.data.porAsesor.find((a: { id: number }) => a.id === 7)).toMatchObject({ alumnos: 1 })
    })

    it('el listado de alumnos se filtra por curso y cada alumno sale solo con ese curso; un curso inválido es 422', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/students?cursoId=2').set(con(tesorero()))
        expect(r.status).toBe(200)
        expect(r.body.data.map((f: { id: number }) => f.id).sort()).toEqual([1, 3])
        expect(r.body.data.every((f: { cursos: Array<{ id: number }> }) => f.cursos.length === 1 && f.cursos[0].id === 2)).toBe(true)
        const mala = await request(app).get('/api/v1/events/2/advisory/students?cursoId=abc').set(con(tesorero()))
        expect(mala.status).toBe(422)
        expect(mala.body.fields.cursoId).toBeDefined()
    })

    it('el Excel lleva la hoja «Listado completo» (una fila por alumno y curso) y el reporte de un curso es el de sus alumnos', async () => {
        const todo = await request(app).get('/api/v1/events/2/advisory/export').set(con(tesorero())).buffer(true).parse((res, cb) => {
            const partes: Buffer[] = []
            res.on('data', (p: Buffer) => partes.push(p))
            res.on('end', () => cb(null, Buffer.concat(partes)))
        })
        const libro = new ExcelJS.Workbook()
        await libro.xlsx.load(todo.body as unknown as Parameters<typeof libro.xlsx.load>[0])
        expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Alumnos', 'Pagaron', 'No pagaron', 'Listado completo'])
        const listado = libro.getWorksheet('Listado completo')
        expect(listado?.rowCount).toBe(5) // cabecera + 4 matrículas (2 + 1 + 1)
        const cabecera = listado?.getRow(1).values as unknown[]
        expect(cabecera).toEqual(expect.arrayContaining(['Curso', 'Docente', 'Alumno', 'Situación']))

        const delCurso = await request(app).get('/api/v1/events/2/advisory/export?cursoId=1').set(con(tesorero())).buffer(true).parse((res, cb) => {
            const partes: Buffer[] = []
            res.on('data', (p: Buffer) => partes.push(p))
            res.on('end', () => cb(null, Buffer.concat(partes)))
        })
        const libro2 = new ExcelJS.Workbook()
        await libro2.xlsx.load(delCurso.body as unknown as Parameters<typeof libro2.xlsx.load>[0])
        expect(libro2.getWorksheet('Listado completo')?.rowCount).toBe(3) // cabecera + los 2 matriculados de PROGRAMACIÓN WEB
        expect(libro2.getWorksheet('Resumen')?.getCell('A1').value).toBe('PROGRAMACIÓN WEB · I-A')
    })

    it('un curso que no existe es 404 al descargar', async () => {
        const r = await request(app).get('/api/v1/events/2/advisory/export?cursoId=99').set(con(tesorero()))
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('COURSE_NOT_FOUND')
    })
})

import ExcelJS from 'exceljs'
import { leerLibroDePadron } from '../../src/api/advisory/services/lector-excel'

const CABECERA = ['SEMESTRE', 'DNI', 'CODIGO', 'EMAIL', 'ALUMNO', 'CELULAR', 'CARRERA', 'CICLO', 'TURNO', 'SECCIÓN', 'DISTRITO', 'PROVINCIA', 'DEPARTAMENTO', '¿Pago?', 'RECAUDO']

type Fila = Array<string | number | Date | null | { formula: string, result?: string | number }>

function alumno(dni: string | number, codigo: string | number, nombre: string, ciclo = 'I', seccion = 'A', extra: Partial<Record<string, string>> = {}): Fila {
    return [new Date('2026-02-01T00:00:00.000Z'), dni, codigo, extra.email ?? `${codigo}@UNDC.edu.pe`, nombre, 920301747, 'INGENIERÍA DE SISTEMAS', ciclo, 'm', seccion, 'SAN LUIS', 'CAÑETE', 'LIMA', 'NO PAGO', { formula: 'XLOOKUP(C2,...)', result: '' }]
}

async function construir(opciones: { estudiantes?: Fila[], nombreHoja?: string, resumen?: Fila[] | null, cabecera?: string[] }): Promise<Buffer> {
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet(opciones.nombreHoja ?? 'ESTUDIANTES 2026-2')
    hoja.addRow(opciones.cabecera ?? CABECERA)
    for (const fila of opciones.estudiantes ?? []) hoja.addRow(fila)
    if (opciones.resumen !== null) {
        const resumen = libro.addWorksheet('RESUMEN')
        resumen.addRow(['CICLO', 'CANTIDAD', 'TOTAL POR CICLO', 'RECAUDADO'])
        resumen.addRow(['I', 15, 39, 0])
        resumen.addRow([])
        resumen.addRow(['CICLO', 'SECCIÓN', 'CANTIDAD PAGARON', 'TOTAL POR CICLO', 'RECAUDADO', 'ASESORES'])
        for (const fila of opciones.resumen ?? []) resumen.addRow(fila)
    }
    return Buffer.from(await libro.xlsx.writeBuffer())
}

describe('lector del Excel del padrón', () => {
    it('lee alumnos y asesores, normaliza los datos y deduce el semestre del nombre de la hoja', async () => {
        const buffer = await construir({
            estudiantes: [alumno(60344947, 2621010003, '  ALBITES  REYNALDO GERALDINE '), alumno(2442123, '2621010004', 'BLANCAS DIEGO', 'II', 'b1')],
            resumen: [
                ['I', 'A', 15, 39, 0, 'DRA. ANGOMA ASTUCURI MIRIAM\nMG. MARIA LAURA BARRERA CAJACHAGUA'],
                ['II', 'B1', 1, 2, 0, '"MG. MARIA LAURA BARRERA CAJACHAGUA\nDR. ELEAZAR OBED TORRES JIMÉNEZ"'],
                ['II', 'B1', 1, 2, 0, 'mg. maría laura barrera cajachagua'],
            ],
        })
        const padron = await leerLibroDePadron(buffer)
        expect(padron.semestre).toBe('2026-2')
        expect(padron.estudiantes).toHaveLength(2)
        expect(padron.estudiantes[0]).toMatchObject({
            documento: '60344947', codigo: '2621010003', correo: '2621010003@undc.edu.pe', nombre: 'ALBITES REYNALDO GERALDINE',
            celular: '920301747', ciclo: 'I', seccion: 'A', turno: 'M', distrito: 'SAN LUIS', provincia: 'CAÑETE', departamento: 'LIMA',
        })
        // El DNI al que Excel le quitó el cero se completa y la sección se pasa a mayúsculas
        expect(padron.estudiantes[1]).toMatchObject({ documento: '02442123', ciclo: 'II', seccion: 'B1' })
        // Las comillas se quitan y «Barrera» (escrita de tres maneras) es un solo asesor con sus dos secciones
        expect(padron.asesores.map((a) => a.nombre).sort()).toEqual([
            'DR. ELEAZAR OBED TORRES JIMÉNEZ', 'DRA. ANGOMA ASTUCURI MIRIAM', 'MG. MARIA LAURA BARRERA CAJACHAGUA',
        ])
        const barrera = padron.asesores.find((a) => a.nombre.includes('BARRERA'))
        expect(barrera?.secciones).toEqual([{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B1' }])
        expect(padron.advertencias).toEqual([])
    })

    it('avisa de códigos repetidos, filas incompletas, DNI inválidos y secciones sin asesor o sin alumnos', async () => {
        const buffer = await construir({
            estudiantes: [
                alumno(60344947, 2621010003, 'UNO'),
                alumno(60344948, 2621010003, 'REPETIDO'),
                alumno('abc', 2621010005, 'DNI RARO'),
                alumno(60344950, 2621010006, 'SIN ASESOR', 'IV', 'C'),
                alumno(60344951, '', 'SIN CODIGO'),
            ],
            resumen: [
                ['I', 'A', 0, 0, 0, 'DRA. ANGOMA ASTUCURI MIRIAM'],
                ['IX', 'Z', 0, 0, 0, 'MG. FANTASMA'],
                ['V', 'A', 0, 0, 0, ''],
            ],
        })
        const { advertencias, estudiantes } = await leerLibroDePadron(buffer)
        expect(estudiantes.map((e) => e.nombre)).toEqual(['UNO', 'DNI RARO', 'SIN ASESOR'])
        const texto = advertencias.join('\n')
        expect(texto).toMatch(/código 2621010003 está repetido/)
        expect(texto).toMatch(/DNI «abc»/)
        expect(texto).toMatch(/falta el código/)
        expect(texto).toMatch(/sección IV-C tiene 1 alumno\(s\) pero ningún asesor/)
        expect(texto).toMatch(/sección IX-Z de la hoja RESUMEN no tiene alumnos/)
        expect(texto).toMatch(/sección V-A no tiene asesores/)
    })

    it('sin hoja RESUMEN lee los alumnos y avisa que nadie quedó con asesor', async () => {
        const padron = await leerLibroDePadron(await construir({ estudiantes: [alumno(60344947, 2621010003, 'UNO')], resumen: null }))
        expect(padron.asesores).toEqual([])
        expect(padron.advertencias.join(' ')).toMatch(/no tiene la hoja RESUMEN/)
    })

    it('usa la columna SEMESTRE cuando el nombre de la hoja no lo trae y deja vacío si no hay de dónde', async () => {
        const conTexto = alumno(60344947, 2621010003, 'UNO')
        conTexto[0] = '2026-1'
        expect((await leerLibroDePadron(await construir({ nombreHoja: 'ESTUDIANTES', estudiantes: [conTexto], resumen: null }))).semestre).toBe('2026-1')
        expect((await leerLibroDePadron(await construir({ nombreHoja: 'ESTUDIANTES', estudiantes: [alumno(60344947, 2621010003, 'UNO')], resumen: null }))).semestre).toBe('')
    })

    it('rechaza un archivo que no es un Excel, sin hoja de estudiantes, sin columnas o sin alumnos', async () => {
        const intentos: Array<[Promise<Buffer> | Buffer, string]> = [
            [Buffer.from('no soy un excel'), 'PADRON_FILE_INVALID'],
            [construir({ nombreHoja: 'OTRA', estudiantes: [alumno(1, 2, 'X')] }), 'PADRON_SHEET_NOT_FOUND'],
            [construir({ cabecera: ['A', 'B', 'C'], estudiantes: [] }), 'PADRON_COLUMNS_MISSING'],
            [construir({ cabecera: ['DNI', 'CODIGO', 'ALUMNO'], estudiantes: [] }), 'PADRON_COLUMNS_MISSING'],
            [construir({ estudiantes: [] }), 'PADRON_EMPTY'],
        ]
        for (const [contenido, codigo] of intentos) {
            await expect(leerLibroDePadron(await contenido)).rejects.toMatchObject({ status: 422, code: codigo })
        }
    })
})

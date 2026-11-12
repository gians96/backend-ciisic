import ExcelJS from 'exceljs'
import { leerExcelCertificados } from '../../src/api/certificate/services/lector-excel'

/** Lectura del Excel de certificados con el formato del VIII CIISIC 2026 (dos columnas «Obs»). */
async function libro(filas: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    const hoja = wb.addWorksheet('Hoja1')
    for (const fila of filas) hoja.addRow(fila)
    return Buffer.from(await wb.xlsx.writeBuffer())
}

const CABECERA = ['N°', 'DNI', 'Nombres', 'Apellidos', 'Tipo', 'Correo', 'Telefono', 'Codigo', 'Obs', 'Obs']

describe('leerExcelCertificados', () => {
    it('lee las columnas por su encabezado y toma la primera «Obs»', async () => {
        const filas = await leerExcelCertificados(await libro([
            CABECERA,
            [1, 2442123, 'JAIR EMERSON', 'FERREYROS YUCRA', 'ASISTENTE', 'jferreyros@undc.edu.pe', 951881199, 'WBVTYDJEKq', 'Docente, egresados y administrativos', 'Generado'],
            [],
            [2, '15357430', ' JUAN  GUSTAVO ', 'HERNANDEZ PEVES', 'ASISTENTE', 'j_hernandez@undc.edu.pe', '988028491', ' zxDmUZLcC8 ', '', 'Generado'],
        ]))
        expect(filas).toEqual([
            { fila: 2, documento: '2442123', nombres: 'JAIR EMERSON', apellidos: 'FERREYROS YUCRA', tipo: 'ASISTENTE', correo: 'jferreyros@undc.edu.pe', celular: '951881199', codigo: 'WBVTYDJEKq', observacion: 'Docente, egresados y administrativos' },
            { fila: 4, documento: '15357430', nombres: 'JUAN GUSTAVO', apellidos: 'HERNANDEZ PEVES', tipo: 'ASISTENTE', correo: 'j_hernandez@undc.edu.pe', celular: '988028491', codigo: 'zxDmUZLcC8', observacion: '' },
        ])
    })

    it('falla si faltan columnas obligatorias', async () => {
        await expect(leerExcelCertificados(await libro([['DNI', 'Codigo'], ['1', 'ABCD1234']]))).rejects.toMatchObject({ status: 422, code: 'CERTIFICATE_COLUMNS_MISSING' })
        await expect(leerExcelCertificados(await libro([['Nombre', 'Correo']]))).rejects.toMatchObject({ code: 'CERTIFICATE_COLUMNS_MISSING' })
    })

    it('falla con un archivo que no es Excel', async () => {
        await expect(leerExcelCertificados(Buffer.from('PK\x03\x04 roto'))).rejects.toMatchObject({ status: 422 })
    })
})

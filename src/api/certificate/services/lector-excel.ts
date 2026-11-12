import type { CellValue, Worksheet } from 'exceljs'
import { unprocessable } from '../../../core/http-error'
import { claveDeTexto } from '../../advisory/services/seguimiento'

/**
 * Lectura del Excel de certificados (spec 015): una fila por certificado con las columnas
 * `N° | DNI | Nombres | Apellidos | Tipo | Correo | Telefono | Codigo | Obs | Obs`. Las columnas se reconocen por
 * su encabezado (sin acentos ni mayúsculas), en cualquier orden; se usa la primera hoja que las tenga.
 */

export interface FilaExcelCertificado {
    /** Número de fila en el Excel (para los mensajes). */
    fila: number
    documento: string
    nombres: string
    apellidos: string
    tipo: string
    correo: string
    celular: string
    codigo: string
    observacion: string
}

/** Filas que se procesan como máximo en una carga. */
export const MAXIMO_FILAS_CERTIFICADOS = 3000

const CAMPOS = {
    documento: ['DNI', 'DOCUMENTO', 'NUMERODOCUMENTO', 'NDOCUMENTO', 'NRODOCUMENTO'],
    nombres: ['NOMBRES', 'NOMBRE'],
    apellidos: ['APELLIDOS', 'APELLIDO'],
    tipo: ['TIPO', 'TIPOCERTIFICADO', 'CONDICION', 'ROL'],
    correo: ['CORREO', 'EMAIL', 'CORREOELECTRONICO'],
    celular: ['TELEFONO', 'CELULAR', 'TELF'],
    codigo: ['CODIGO', 'CODIGOCERTIFICADO', 'CODIGODECERTIFICADO'],
    observacion: ['OBS', 'OBSERVACION', 'OBSERVACIONES'],
} as const satisfies Record<string, readonly string[]>

type Campo = keyof typeof CAMPOS
const OBLIGATORIOS: readonly Campo[] = ['documento', 'nombres', 'apellidos', 'codigo']

function cabecera(valor: string): string {
    return claveDeTexto(valor).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function texto(valor: CellValue | undefined): string {
    if (valor === null || valor === undefined) return ''
    if (typeof valor === 'string') return valor.trim()
    if (typeof valor === 'number') return Number.isInteger(valor) ? String(valor) : String(valor)
    if (typeof valor === 'boolean') return String(valor)
    if (valor instanceof Date) return valor.toISOString().slice(0, 10)
    if ('richText' in valor) return valor.richText.map((parte) => parte.text).join('').trim()
    if ('result' in valor) return texto(valor.result as CellValue)
    if ('text' in valor) return String(valor.text).trim()
    return ''
}

function indiceDe(hoja: Worksheet): { fila: number, indice: Partial<Record<Campo, number>> } | null {
    for (let r = 1; r <= Math.min(hoja.rowCount, 10); r++) {
        const encontrados: Partial<Record<Campo, number>> = {}
        hoja.getRow(r).eachCell({ includeEmpty: false }, (celda, columna) => {
            const nombre = cabecera(texto(celda.value))
            for (const campo of Object.keys(CAMPOS) as Campo[]) {
                // Con dos columnas «Obs» se toma la primera
                if (encontrados[campo] === undefined && (CAMPOS[campo] as readonly string[]).includes(nombre)) encontrados[campo] = columna
            }
        })
        if (encontrados.documento !== undefined && encontrados.codigo !== undefined) return { fila: r, indice: encontrados }
    }
    return null
}

/** Lee el libro y devuelve sus filas con datos (sin validar aún contra la BD). */
export async function leerExcelCertificados(contenido: Buffer): Promise<FilaExcelCertificado[]> {
    const ExcelJS = await import('exceljs')
    const libro = new ExcelJS.Workbook()
    try {
        await libro.xlsx.load(contenido as unknown as Parameters<typeof libro.xlsx.load>[0])
    } catch {
        throw unprocessable('INVALID_FILE_CONTENT', 'No se pudo leer el Excel. Guárdalo como .xlsx e inténtalo de nuevo.')
    }

    let hoja: Worksheet | undefined
    let encabezado: { fila: number, indice: Partial<Record<Campo, number>> } | null = null
    for (const candidata of libro.worksheets) {
        encabezado = indiceDe(candidata)
        if (encabezado) {
            hoja = candidata
            break
        }
    }
    if (!hoja || !encabezado) {
        throw unprocessable('CERTIFICATE_COLUMNS_MISSING', 'El Excel no tiene las columnas esperadas.', { file: 'Faltan las columnas DNI y Codigo' })
    }
    const { indice } = encabezado
    const faltantes = OBLIGATORIOS.filter((campo) => indice[campo] === undefined)
    if (faltantes.length) {
        throw unprocessable('CERTIFICATE_COLUMNS_MISSING', 'El Excel no tiene las columnas esperadas.', {
            file: `Faltan las columnas: ${faltantes.map((campo) => CAMPOS[campo][0]).join(', ')}`,
        })
    }

    const filas: FilaExcelCertificado[] = []
    for (let r = encabezado.fila + 1; r <= hoja.rowCount; r++) {
        const fila = hoja.getRow(r)
        const dato = (campo: Campo) => {
            const columna = indice[campo]
            return columna ? texto(fila.getCell(columna).value).replace(/\s+/g, ' ').trim() : ''
        }
        const leida: FilaExcelCertificado = {
            fila: r,
            documento: dato('documento'),
            nombres: dato('nombres'),
            apellidos: dato('apellidos'),
            tipo: dato('tipo'),
            correo: dato('correo'),
            celular: dato('celular'),
            codigo: dato('codigo').replace(/\s+/g, ''),
            observacion: dato('observacion'),
        }
        if (!leida.documento && !leida.codigo && !leida.nombres && !leida.apellidos) continue
        filas.push(leida)
        if (filas.length > MAXIMO_FILAS_CERTIFICADOS) {
            throw unprocessable('IMPORT_TOO_LARGE', `El Excel tiene más de ${MAXIMO_FILAS_CERTIFICADOS} filas. Pártelo en varias cargas.`)
        }
    }
    if (!filas.length) throw unprocessable('IMPORT_EMPTY', 'El Excel no tiene filas con datos.')
    return filas
}

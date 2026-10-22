import type { Evento } from '@prisma/client'
import type { SituacionCongreso } from '../../../core/ponencias-especializadas'
import { marcaDeTiempo } from '../../advisory/exports/reporte'
import { resumir, type FiltrosResumen, type PersonaResumen } from './resumen'

/** Cómo se llama cada situación en el reporte (y en el panel). */
export const ETIQUETA_SITUACION: Readonly<Record<SituacionCongreso, string>> = {
    APROBADO: 'Inscrito al congreso con el pago aprobado',
    PAGO_PENDIENTE: 'Inscrito al congreso, pago en revisión',
    RECHAZADO: 'Inscripción al congreso rechazada o cancelada',
    NO_INSCRITO: 'No está inscrito al congreso',
}

const AZUL = 'FF1E3A5F'
const COLORES: Readonly<Record<SituacionCongreso, { fondo: string, texto: string }>> = {
    APROBADO: { fondo: 'FFDCFCE7', texto: 'FF166534' },
    PAGO_PENDIENTE: { fondo: 'FFFEF3C7', texto: 'FF92400E' },
    RECHAZADO: { fondo: 'FFFEE2E2', texto: 'FF991B1B' },
    NO_INSCRITO: { fondo: 'FFF3F4F6', texto: 'FF4B5563' },
}

function descripcionDeFiltros(filtros: FiltrosResumen): string[] {
    return [
        ...(filtros.situacion ? [`Situación: ${ETIQUETA_SITUACION[filtros.situacion]}`] : []),
        ...(filtros.puede ? [filtros.puede === 'si' ? 'Pueden asistir' : 'No pueden asistir'] : []),
        ...(filtros.validacion ? [filtros.validacion === 'si' ? 'Validadas' : 'Sin validar'] : []),
        ...(filtros.modo ? [`Asisten de forma ${filtros.modo === 'VIRTUAL' ? 'virtual' : 'presencial'}`] : []),
        ...(filtros.aviso ? [filtros.aviso === 'si' ? 'Ya avisadas' : 'Sin avisar'] : []),
        ...(filtros.q ? [`Búsqueda: «${filtros.q}»`] : []),
    ]
}

/**
 * Excel del resumen por persona: una hoja «Resumen» con los totales de todo el evento y una hoja «Personas» con las
 * filas que dejan los filtros. `exceljs` se carga solo aquí (pesa y casi nunca se usa).
 */
export async function generarExcelResumen(evento: Pick<Evento, 'nombre'>, todas: readonly PersonaResumen[], filas: readonly PersonaResumen[], filtros: FiltrosResumen, accesoLibre: boolean, generadoEn = new Date()): Promise<Buffer> {
    const { Workbook } = await import('exceljs')
    const libro = new Workbook()
    libro.creator = 'CIISIC'
    const totales = resumir(todas)

    const hoja = libro.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
    hoja.getColumn(1).width = 52
    hoja.getColumn(2).width = 14
    hoja.getCell('A1').value = 'Inscritos a ponencias especializadas y su situación en el congreso'
    hoja.getCell('A1').font = { bold: true, size: 15, color: { argb: AZUL } }
    hoja.getCell('A2').value = evento.nombre
    hoja.getCell('A3').value = `Generado el ${marcaDeTiempo(generadoEn)} (hora de Lima)`
    hoja.getCell('A3').font = { color: { argb: 'FF6B7280' } }
    hoja.getCell('A4').value = accesoLibre
        ? 'Acceso libre ENCENDIDO: cualquiera puede inscribirse; la situación es solo informativa.'
        : 'Solo pueden estar inscritas las personas con inscripción al congreso aprobada (pago validado).'
    hoja.getCell('A4').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } }
    const lineas: Array<[string, number]> = [
        ['Personas inscritas a ponencias', totales.personas],
        ['Inscripciones vigentes a ponencias', totales.inscripciones],
        ['Pueden asistir', totales.pueden],
        ['No pueden asistir', totales.noPueden],
        ...((['APROBADO', 'PAGO_PENDIENTE', 'RECHAZADO', 'NO_INSCRITO'] as const).map((s): [string, number] => [`   ${ETIQUETA_SITUACION[s]}`, totales.porSituacion[s]])),
        ['Sin validar al inscribirse', totales.sinValidar],
        ['Con comunicado enviado', totales.avisadas],
    ]
    lineas.forEach(([titulo, valor], i) => {
        hoja.getCell(`A${6 + i}`).value = titulo
        hoja.getCell(`B${6 + i}`).value = valor
        hoja.getCell(`B${6 + i}`).alignment = { horizontal: 'center' }
    })
    const filtrosTexto = descripcionDeFiltros(filtros)
    if (filtrosTexto.length) {
        hoja.getCell(`A${7 + lineas.length}`).value = `Filtros de la hoja «Personas»: ${filtrosTexto.join(' · ')}`
        hoja.getCell(`A${7 + lineas.length}`).font = { color: { argb: 'FF6B7280' } }
    }

    const personas = libro.addWorksheet('Personas', { views: [{ state: 'frozen', ySplit: 1 }] })
    const columnas: Array<[string, number]> = [
        ['Documento', 16], ['Apellidos', 26], ['Nombres', 24], ['Correo', 30], ['Celular', 14], ['Procedencia', 14],
        ['Ponencias inscritas', 12], ['Asistencias', 12], ['Situación en el congreso', 42], ['Tipo de inscripción', 28],
        ['Categoría', 22], ['Modo', 12], ['¿Puede asistir?', 14], ['Validada', 10], ['Comunicado enviado', 20],
    ]
    personas.columns = columnas.map(([header, width]) => ({ header, width }))
    const cabecera = personas.getRow(1)
    cabecera.height = 30
    cabecera.eachCell((celda) => {
        celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
        celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    })
    for (const p of filas) {
        const a = p.asistente
        const fila = personas.addRow([
            `${a.tipoDocumentoId.toUpperCase()} ${a.numeroDocumento}`,
            a.apellidos,
            a.nombres,
            a.correo ?? '',
            a.celular ?? '',
            a.procedencia === 'INTERNO' ? 'Interno (UNDC)' : a.procedencia === 'EXTERNO' ? 'Externo' : '',
            p.ponencias,
            p.asistencias,
            ETIQUETA_SITUACION[p.situacion],
            p.congreso?.tipo ?? '',
            p.congreso?.categoria ?? '',
            p.congreso ? (p.congreso.modo === 'VIRTUAL' ? 'Virtual' : 'Presencial') : '',
            p.puede ? 'Sí' : 'No',
            p.validada ? 'Sí' : 'No',
            p.avisadoEn ? marcaDeTiempo(p.avisadoEn) : '',
        ])
        const color = COLORES[p.situacion]
        const celdaSituacion = fila.getCell(9)
        celdaSituacion.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.fondo } }
        celdaSituacion.font = { color: { argb: color.texto } }
        for (const c of [7, 8, 12, 13, 14]) fila.getCell(c).alignment = { horizontal: 'center' }
    }
    if (filas.length) personas.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + filas.length, column: columnas.length } }
    return Buffer.from(await libro.xlsx.writeBuffer())
}

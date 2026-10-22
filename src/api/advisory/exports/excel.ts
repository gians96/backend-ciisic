import type { Workbook, Worksheet } from 'exceljs'
import { etiquetaSeccion, type FilaSeguimiento, type Situacion } from '../services/seguimiento'
import { asesoresDe, columnasDeContadores, etiquetaDeSituacion, marcaDeTiempo, type DatosReporte } from './reporte'

const AZUL = 'FF1E3A5F'
const COLORES_SITUACION: Readonly<Record<Situacion, { fondo: string, texto: string }>> = {
    PAGADO: { fondo: 'FFDCFCE7', texto: 'FF166534' },
    EN_REVISION: { fondo: 'FFFEF3C7', texto: 'FF92400E' },
    RECHAZADO: { fondo: 'FFFEE2E2', texto: 'FF991B1B' },
    SIN_INSCRIPCION: { fondo: 'FFF3F4F6', texto: 'FF4B5563' },
}

function estiloCabecera(hoja: Worksheet, fila: number, columnas: number): void {
    for (let c = 1; c <= columnas; c++) {
        const celda = hoja.getRow(fila).getCell(c)
        celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
        celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    }
    hoja.getRow(fila).height = 22
}

/** Agrega una tabla con título a la hoja de resumen y devuelve la fila siguiente libre. */
function tabla(hoja: Worksheet, desde: number, titulo: string, cabeceras: string[], filas: Array<Array<string | number>>, centradas: number[], dinero: number[]): number {
    hoja.getRow(desde).getCell(1).value = titulo
    hoja.getRow(desde).getCell(1).font = { bold: true, size: 12, color: { argb: AZUL } }
    const cabecera = desde + 1
    cabeceras.forEach((texto, i) => { hoja.getRow(cabecera).getCell(i + 1).value = texto })
    estiloCabecera(hoja, cabecera, cabeceras.length)
    filas.forEach((valores, i) => {
        const fila = hoja.getRow(cabecera + 1 + i)
        valores.forEach((valor, c) => {
            const celda = fila.getCell(c + 1)
            celda.value = valor
            celda.alignment = { vertical: 'top', wrapText: true, horizontal: centradas.includes(c) ? 'center' : 'left' }
            if (dinero.includes(c)) celda.numFmt = '#,##0.00'
        })
    })
    return cabecera + filas.length + 2
}

function hojaResumen(libro: Workbook, datos: DatosReporte): void {
    const hoja = libro.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
    const contadores = columnasDeContadores(datos.conPago)
    // Columna de dinero de cada tabla: es la última de los contadores, tras las columnas que la preceden
    const dineroDespues = (previas: number) => (datos.conPago ? [previas + contadores.length - 1] : [])

    hoja.getCell('A1').value = datos.titulo
    hoja.getCell('A1').font = { bold: true, size: 16, color: { argb: AZUL } }
    hoja.getCell('A2').value = `${datos.evento.nombre}${datos.semestre ? ` · Semestre ${datos.semestre}` : ''}`
    hoja.getCell('A3').value = `Generado el ${marcaDeTiempo(datos.generadoEn)} (hora de Lima)`
    hoja.getCell('A3').font = { color: { argb: 'FF6B7280' } }
    let fila = 4
    if (datos.filtros.length) {
        hoja.getCell('A4').value = `Filtros: ${datos.filtros.join(' · ')}`
        hoja.getCell('A4').font = { color: { argb: 'FF6B7280' } }
        fila = 5
    }
    hoja.getCell(`A${fila}`).value = 'Pagó = inscripción aprobada. En revisión = voucher enviado que aún no se valida. Rechazados incluye las canceladas.'
    hoja.getCell(`A${fila}`).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } }

    let siguiente = tabla(hoja, fila + 2, 'Total', contadores.map((c) => c.titulo), [contadores.map((c) => c.valor(datos.resumen.totales))], contadores.map((_, i) => i), dineroDespues(0))
    siguiente = tabla(
        hoja, siguiente, 'Por ciclo', ['Ciclo', ...contadores.map((c) => c.titulo)],
        datos.resumen.porCiclo.map((r) => [r.ciclo, ...contadores.map((c) => c.valor(r))]),
        contadores.map((_, i) => i + 1), dineroDespues(1),
    )
    siguiente = tabla(
        hoja, siguiente, 'Por ciclo y sección', ['Ciclo', 'Sección', 'Turno', ...contadores.map((c) => c.titulo), 'Asesores'],
        datos.resumen.porSeccion.map((r) => [r.ciclo, r.seccion, r.turnos.join(', '), ...contadores.map((c) => c.valor(r)), r.asesores.map((a) => a.nombre).join('\n')]),
        contadores.map((_, i) => i + 3), dineroDespues(3),
    )
    if (datos.conTablaDeAsesores) {
        siguiente = tabla(
            hoja, siguiente, 'Por asesor', ['Asesor', 'Ciclos y secciones', ...contadores.map((c) => c.titulo)],
            datos.resumen.porAsesor.map((r) => [r.nombre, r.secciones.map((s) => etiquetaSeccion(s.ciclo, s.seccion)).join(', '), ...contadores.map((c) => c.valor(r))]),
            contadores.map((_, i) => i + 2), dineroDespues(2),
        )
    }
    if (datos.resumen.alumnosSinAsesor) {
        hoja.getCell(`A${siguiente}`).value = `${datos.resumen.alumnosSinAsesor} alumno(s) están en una sección que no tiene asesor asignado.`
        hoja.getCell(`A${siguiente}`).font = { bold: true, color: { argb: 'FF991B1B' } }
    }

    hoja.getColumn(1).width = 34
    hoja.getColumn(2).width = 24
    for (let c = 3; c <= 12; c++) hoja.getColumn(c).width = 14
    hoja.getColumn(3 + contadores.length).width = 44
}

function hojaDeAlumnos(libro: Workbook, nombre: string, filas: readonly FilaSeguimiento[], conPago: boolean): void {
    const hoja = libro.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] })
    const columnas: Array<{ titulo: string, ancho: number, valor: (f: FilaSeguimiento) => string | number | null }> = [
        { titulo: 'Ciclo', ancho: 8, valor: (f) => f.ciclo },
        { titulo: 'Sección', ancho: 9, valor: (f) => f.seccion },
        { titulo: 'Turno', ancho: 8, valor: (f) => f.turno },
        { titulo: 'Código', ancho: 14, valor: (f) => f.codigo },
        { titulo: 'DNI', ancho: 11, valor: (f) => f.documento },
        { titulo: 'Alumno', ancho: 42, valor: (f) => f.nombre },
        { titulo: 'Correo', ancho: 34, valor: (f) => f.correo },
        { titulo: 'Celular', ancho: 12, valor: (f) => f.celular },
        { titulo: 'Situación', ancho: 16, valor: (f) => etiquetaDeSituacion(f.situacion) },
        ...(conPago
            ? [
                { titulo: 'Monto (S/)', ancho: 12, valor: (f: FilaSeguimiento) => f.monto },
                { titulo: 'Fecha de pago', ancho: 14, valor: (f: FilaSeguimiento) => f.fechaPago },
            ]
            : []),
        { titulo: 'Asesores', ancho: 46, valor: (f) => asesoresDe(f).replace(/; /g, '\n') },
    ]
    hoja.columns = columnas.map((c) => ({ header: c.titulo, width: c.ancho }))
    estiloCabecera(hoja, 1, columnas.length)
    const columnaSituacion = columnas.findIndex((c) => c.titulo === 'Situación') + 1
    const columnaMonto = columnas.findIndex((c) => c.titulo === 'Monto (S/)') + 1

    filas.forEach((fila, i) => {
        const excel = hoja.getRow(i + 2)
        columnas.forEach((columna, c) => { excel.getCell(c + 1).value = columna.valor(fila) })
        excel.alignment = { vertical: 'top', wrapText: true }
        const color = COLORES_SITUACION[fila.situacion]
        const celda = excel.getCell(columnaSituacion)
        celda.font = { bold: true, color: { argb: color.texto } }
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.fondo } }
        if (columnaMonto) excel.getCell(columnaMonto).numFmt = '#,##0.00'
    })
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } }
    hoja.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
}

/** Libro con cuatro hojas: Resumen, Alumnos (el listado filtrado), Pagaron y No pagaron (del alcance). */
export async function generarExcel(datos: DatosReporte): Promise<Buffer> {
    const { Workbook: Libro } = await import('exceljs')
    const libro = new Libro()
    libro.creator = 'CIISIC · Panel del congreso'
    libro.created = datos.generadoEn

    hojaResumen(libro, datos)
    hojaDeAlumnos(libro, 'Alumnos', datos.filas, datos.conPago)
    hojaDeAlumnos(libro, 'Pagaron', datos.alcance.filter((f) => f.situacion === 'PAGADO'), datos.conPago)
    hojaDeAlumnos(libro, 'No pagaron', datos.alcance.filter((f) => f.situacion !== 'PAGADO'), datos.conPago)

    return Buffer.from(await libro.xlsx.writeBuffer())
}

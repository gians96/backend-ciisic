import PDFDocument from 'pdfkit'
import { etiquetaSeccion, type Situacion } from '../services/seguimiento'
import { asesoresDe, columnasDeContadores, columnasOcultas, etiquetaDeSituacion, marcaDeTiempo, otrasSeccionesDe, textoAvance, type DatosReporte } from './reporte'

const AZUL = '#1e3a5f'
const GRIS = '#6b7280'
const COLORES_SITUACION: Readonly<Record<Situacion, { fondo: string, texto: string }>> = {
    PAGADO: { fondo: '#dcfce7', texto: '#166534' },
    EN_REVISION: { fondo: '#fef3c7', texto: '#92400e' },
    RECHAZADO: { fondo: '#fee2e2', texto: '#991b1b' },
    SIN_INSCRIPCION: { fondo: '#f3f4f6', texto: '#4b5563' },
}

const TAMANO = 8
const RELLENO = 3

/** Las fuentes estándar de PDF solo cubren Latin-1: lo demás se reduce a su letra base. */
function seguro(valor: unknown): string {
    return Array.from(String(valor ?? ''), (c) => {
        if (c.charCodeAt(0) <= 0xff) return c
        const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '')
        return base.charCodeAt(0) <= 0xff ? base : '?'
    }).join('')
}

interface Columna {
    titulo: string
    ancho: number
    centrar?: boolean
}

interface Celda {
    texto: string
    situacion?: Situacion
}

class Dibujante {
    constructor(private readonly doc: PDFKit.PDFDocument, private readonly datos: DatosReporte) {}

    private get izquierda(): number { return this.doc.page.margins.left }
    private get ancho(): number { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right }
    private get limiteInferior(): number { return this.doc.page.height - this.doc.page.margins.bottom }

    encabezado(): void {
        const { doc, datos } = this
        doc.font('Helvetica-Bold').fontSize(15).fillColor(AZUL).text(seguro(datos.titulo), this.izquierda, doc.page.margins.top, { width: this.ancho })
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(seguro(`${datos.evento.nombre}${datos.semestre ? ` · Semestre ${datos.semestre}` : ''}`), { width: this.ancho })
        doc.fillColor(GRIS).text(seguro(`Generado el ${marcaDeTiempo(datos.generadoEn)} (hora de Lima)`), { width: this.ancho })
        if (datos.filtros.length) doc.text(seguro(`Filtros: ${datos.filtros.join(' · ')}`), { width: this.ancho })
        doc.moveDown(0.6)
    }

    /** Recuadros con los totales. */
    indicadores(): void {
        const { doc, datos } = this
        const t = datos.resumen.totales
        const cajas = [
            ['Alumnos', String(t.alumnos)],
            ['Pagaron', String(t.pagaron)],
            ['En revisión', String(t.enRevision)],
            ['Rechazados', String(t.rechazados)],
            ['Sin inscripción', String(t.sinInscripcion)],
            ['Avance', textoAvance(t.avance)],
            ...(datos.conPago ? [['Recaudado', `S/ ${(t.recaudado ?? 0).toFixed(2)}`]] : []),
        ]
        const ancho = (this.ancho - 6 * (cajas.length - 1)) / cajas.length
        const y = doc.y
        cajas.forEach(([titulo, valor], i) => {
            const x = this.izquierda + i * (ancho + 6)
            doc.roundedRect(x, y, ancho, 38, 4).fillAndStroke('#f8fafc', '#e5e7eb')
            doc.fillColor(GRIS).font('Helvetica').fontSize(7.5).text(seguro(titulo), x + 6, y + 6, { width: ancho - 12, lineBreak: false })
            doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(13).text(seguro(valor), x + 6, y + 18, { width: ancho - 12, lineBreak: false })
        })
        doc.y = y + 38 + 12
        doc.x = this.izquierda
    }

    titulo(texto: string): void {
        if (this.doc.y + 40 > this.limiteInferior) this.nuevaPagina()
        this.doc.font('Helvetica-Bold').fontSize(11).fillColor(AZUL).text(seguro(texto), this.izquierda, this.doc.y, { width: this.ancho })
        this.doc.moveDown(0.3)
    }

    nuevaPagina(): void {
        this.doc.addPage()
        this.doc.x = this.izquierda
        this.doc.y = this.doc.page.margins.top
    }

    /** Tabla con cabecera repetida en cada página. */
    tabla(columnas: Columna[], filas: Celda[][]): void {
        const { doc } = this
        const cabecera = () => {
            const y = doc.y
            doc.rect(this.izquierda, y, columnas.reduce((suma, c) => suma + c.ancho, 0), 16).fill(AZUL)
            let x = this.izquierda
            doc.font('Helvetica-Bold').fontSize(TAMANO).fillColor('#ffffff')
            for (const columna of columnas) {
                doc.text(seguro(columna.titulo), x + RELLENO, y + 4, { width: columna.ancho - 2 * RELLENO, align: columna.centrar ? 'center' : 'left', lineBreak: false })
                x += columna.ancho
            }
            doc.y = y + 16
        }
        cabecera()
        filas.forEach((fila, i) => {
            doc.font('Helvetica').fontSize(TAMANO)
            const alto = Math.max(...fila.map((celda, c) => doc.heightOfString(seguro(celda.texto), { width: columnas[c].ancho - 2 * RELLENO }))) + 2 * RELLENO
            if (doc.y + alto > this.limiteInferior) {
                this.nuevaPagina()
                cabecera()
            }
            const y = doc.y
            const anchoTotal = columnas.reduce((suma, c) => suma + c.ancho, 0)
            if (i % 2 === 1) doc.rect(this.izquierda, y, anchoTotal, alto).fill('#f9fafb')
            let x = this.izquierda
            fila.forEach((celda, c) => {
                const columna = columnas[c]
                const color = celda.situacion ? COLORES_SITUACION[celda.situacion] : null
                if (color) doc.rect(x + 1, y + 1, columna.ancho - 2, alto - 2).fill(color.fondo)
                doc.font(color ? 'Helvetica-Bold' : 'Helvetica').fontSize(TAMANO).fillColor(color?.texto ?? '#111827')
                doc.text(seguro(celda.texto), x + RELLENO, y + RELLENO, { width: columna.ancho - 2 * RELLENO, align: columna.centrar ? 'center' : 'left' })
                x += columna.ancho
            })
            doc.moveTo(this.izquierda, y + alto).lineTo(this.izquierda + anchoTotal, y + alto).lineWidth(0.3).stroke('#e5e7eb')
            doc.y = y + alto
        })
        doc.x = this.izquierda
        doc.moveDown(0.8)
    }

    pie(): void {
        const { doc } = this
        const rango = doc.bufferedPageRange()
        for (let i = 0; i < rango.count; i++) {
            doc.switchToPage(rango.start + i)
            // El pie queda en el margen inferior: sin esto pdfkit abre una página nueva para escribirlo
            const margenInferior = doc.page.margins.bottom
            doc.page.margins.bottom = 0
            doc.font('Helvetica').fontSize(8).fillColor(GRIS)
            doc.text(seguro(`${this.datos.evento.codigo} · Página ${i + 1} de ${rango.count}`), this.izquierda, doc.page.height - 22, { width: this.ancho, align: 'right', lineBreak: false })
            doc.page.margins.bottom = margenInferior
        }
    }
}

/** PDF apaisado A4 con los indicadores, el resumen por sección (y asesor) y el listado de alumnos. */
export function generarPdf(datos: DatosReporte): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true, info: { Title: seguro(datos.titulo), Author: 'CIISIC' } })
        const partes: Buffer[] = []
        doc.on('data', (parte: Buffer) => partes.push(parte))
        doc.on('end', () => resolve(Buffer.concat(partes)))
        doc.on('error', reject)

        try {
            const dibujante = new Dibujante(doc, datos)
            const contadores = columnasDeContadores(datos.conPago).filter((c) => c.titulo !== 'No pagaron')
            const abreviadas: Record<string, string> = { 'En revisión': 'En rev.', Rechazados: 'Rechaz.', 'Sin inscripción': 'Sin insc.', 'Recaudado (S/)': 'Recaudado' }
            const columnasNumericas = contadores.map((c): Columna => ({ titulo: abreviadas[c.titulo] ?? c.titulo, ancho: c.titulo.startsWith('Recaudado') ? 56 : 40, centrar: true }))

            dibujante.encabezado()
            dibujante.indicadores()

            // Un reporte público omite las columnas de datos que no necesita (ver `columnasOcultas`)
            const ocultas = columnasOcultas(datos.publico)
            const ver = (titulo: string) => !ocultas.includes(titulo)

            dibujante.titulo('Por ciclo y sección')
            const ocupado = 28 + 34 + 28 + columnasNumericas.reduce((suma, c) => suma + c.ancho, 0)
            dibujante.tabla(
                [{ titulo: 'Ciclo', ancho: 28, centrar: true }, { titulo: 'Sección', ancho: 34, centrar: true }, { titulo: 'Turno', ancho: 28, centrar: true }, ...columnasNumericas, ...(ver('Asesores') ? [{ titulo: 'Asesores', ancho: 782 - ocupado }] : [])],
                datos.resumen.porSeccion.map((r) => [
                    { texto: r.ciclo }, { texto: r.seccion }, { texto: r.turnos.join(', ') },
                    ...contadores.map((c) => ({ texto: String(c.valor(r)) })),
                    ...(ver('Asesores') ? [{ texto: r.asesores.map((a) => a.nombre).join('; ') }] : []),
                ]),
            )

            if (datos.conTablaDeAsesores) {
                dibujante.titulo('Por asesor')
                const anchoNumerico = columnasNumericas.reduce((suma, c) => suma + c.ancho, 0)
                dibujante.tabla(
                    [{ titulo: 'Asesor', ancho: 250 }, { titulo: 'Ciclos y secciones', ancho: 782 - 250 - anchoNumerico }, ...columnasNumericas],
                    datos.resumen.porAsesor.map((r) => [
                        { texto: r.nombre },
                        { texto: r.secciones.map((s) => etiquetaSeccion(s.ciclo, s.seccion)).join(', ') },
                        ...contadores.map((c) => ({ texto: String(c.valor(r)) })),
                    ]),
                )
            }

            dibujante.titulo(`Alumnos (${datos.filas.length})`)
            // El nombre ocupa lo que dejan las demás columnas (con asesores se reparte el resto con ellos)
            // «Otras secciones» (spec 033) solo aparece si algún alumno cursa en más de una dentro del alcance; su ancho sale del de Alumno
            const hayOtras = datos.filas.some((f) => f.secciones.length > 1)
            const anchoAlumno = (ver('Asesores') ? (ver('DNI') ? 190 : 250) : 330) - (hayOtras ? 56 : 0)
            const fijas: Columna[] = [
                { titulo: 'Ciclo', ancho: 28, centrar: true }, { titulo: 'Sec.', ancho: 28, centrar: true }, { titulo: 'Turno', ancho: 30, centrar: true },
                ...(hayOtras ? [{ titulo: 'Otras', ancho: 56 }] : []),
                { titulo: 'Código', ancho: 62 }, ...(ver('DNI') ? [{ titulo: 'DNI', ancho: 52 }] : []), { titulo: 'Alumno', ancho: anchoAlumno }, ...(ver('Celular') ? [{ titulo: 'Celular', ancho: 58 }] : []),
                { titulo: 'Situación', ancho: 72, centrar: true }, ...(datos.conPago ? [{ titulo: 'Monto', ancho: 44, centrar: true }] : []),
            ]
            const resto = 782 - fijas.reduce((suma, c) => suma + c.ancho, 0)
            dibujante.tabla(
                [...fijas, ...(ver('Asesores') ? [{ titulo: 'Asesores', ancho: resto }] : [])],
                datos.filas.map((f) => [
                    { texto: f.ciclo }, { texto: f.seccion }, { texto: f.turno ?? '' }, ...(hayOtras ? [{ texto: otrasSeccionesDe(f) }] : []), { texto: f.codigo }, ...(ver('DNI') ? [{ texto: f.documento }] : []), { texto: f.nombre }, ...(ver('Celular') ? [{ texto: f.celular ?? '' }] : []),
                    { texto: etiquetaDeSituacion(f.situacion), situacion: f.situacion },
                    ...(datos.conPago ? [{ texto: f.monto === null ? '' : f.monto.toFixed(2) }] : []),
                    ...(ver('Asesores') ? [{ texto: asesoresDe(f) }] : []),
                ]),
            )

            dibujante.pie()
            doc.end()
        } catch (error) {
            reject(error)
        }
    })
}

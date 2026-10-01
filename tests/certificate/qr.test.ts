import QRCode from 'qrcode'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFOperator } from 'pdf-lib'
import { estampar } from '../../src/api/certificate/pdf/estampar'
import { MARGEN_QR_MODULOS, dibujarQr, matrizQr, rectangulosQr, tamanoModulo, type Rectangulo } from '../../src/api/certificate/pdf/qr'
import { disenoDePrueba } from '../helpers/pdf'

const URL = 'https://admin-ciisic.example.pe/verificar/CIISIC-2026-000123-7KQ2XM'

/** Matriz esperada, directamente de la biblioteca `qrcode` (nivel M). */
function esperada(texto: string): boolean[][] {
    const { modules } = QRCode.create(texto, { errorCorrectionLevel: 'M' })
    return Array.from({ length: modules.size }, (_, fila) => Array.from({ length: modules.size }, (_, columna) => modules.get(fila, columna) === 1))
}

/** Reconstruye la matriz a partir de los rectángulos dibujados (sin rasterizar). */
function reconstruir(rectangulos: Rectangulo[], tamano: number, x: number, y: number, lado: number): boolean[][] {
    const modulo = lado / (tamano + 2 * MARGEN_QR_MODULOS)
    const matriz = Array.from({ length: tamano }, () => Array<boolean>(tamano).fill(false))
    for (const r of rectangulos) {
        const fila = Math.round((y + lado - r.y) / modulo) - MARGEN_QR_MODULOS - 1
        const columna = Math.round((r.x - x) / modulo) - MARGEN_QR_MODULOS
        const ancho = Math.round(r.ancho / modulo)
        expect(r.alto).toBeCloseTo(modulo, 6)
        for (let c = columna; c < columna + ancho; c++) {
            expect(matriz[fila][c]).toBe(false) // sin rectángulos superpuestos
            matriz[fila][c] = true
        }
    }
    return matriz
}

/** `x y w h re` → rectángulo. */
function aRectangulo(operador: string): Rectangulo {
    const [x, y, ancho, alto] = operador.split(/\s+/).slice(0, 4).map(Number)
    return { x, y, ancho, alto }
}

describe('QR vectorial', () => {
    it('matrizQr es la de QRCode.create con corrección M', () => {
        const matriz = matrizQr(URL)
        const referencia = esperada(URL)
        expect(matriz.tamano).toBe(referencia.length)
        for (let f = 0; f < matriz.tamano; f++) for (let c = 0; c < matriz.tamano; c++) expect(matriz.oscuro(f, c)).toBe(referencia[f][c])
    })

    it('los rectángulos reproducen exactamente los módulos oscuros, dentro del cuadrado y con margen de 2 módulos', () => {
        const opciones = { x: 650, y: 40, lado: 120 }
        const matriz = matrizQr(URL)
        const rectangulos = rectangulosQr(matriz, opciones)
        expect(reconstruir(rectangulos, matriz.tamano, opciones.x, opciones.y, opciones.lado)).toEqual(esperada(URL))
        const modulo = tamanoModulo(matriz, opciones.lado)
        for (const r of rectangulos) {
            expect(r.x).toBeGreaterThanOrEqual(opciones.x + MARGEN_QR_MODULOS * modulo - 1e-9)
            expect(r.y).toBeGreaterThanOrEqual(opciones.y + MARGEN_QR_MODULOS * modulo - 1e-9)
            expect(r.x + r.ancho).toBeLessThanOrEqual(opciones.x + opciones.lado - MARGEN_QR_MODULOS * modulo + 1e-9)
            expect(r.y + r.alto).toBeLessThanOrEqual(opciones.y + opciones.lado - MARGEN_QR_MODULOS * modulo + 1e-9)
        }
        // Une los módulos consecutivos de cada fila: menos rectángulos que módulos oscuros
        const oscuros = esperada(URL).flat().filter(Boolean).length
        expect(rectangulos.length).toBeLessThan(oscuros)
    })

    it('dibujarQr: fondo blanco del lado completo y los módulos con operadores re y un solo relleno', () => {
        const operadores: string[] = []
        const lienzo = { pushOperators: (...ops: PDFOperator[]) => operadores.push(...ops.map((op) => op.toString())) }
        const opciones = { x: 100, y: 200, lado: 90 }
        dibujarQr(lienzo, URL, opciones)

        expect(operadores[0]).toBe('q')
        expect(operadores[1]).toBe('1 1 1 rg')
        expect(operadores[2]).toBe('100 200 90 90 re')
        expect(operadores[3]).toBe('f')
        expect(operadores[4]).toBe('0 0 0 rg')
        expect(operadores.slice(-2)).toEqual(['f', 'Q'])
        const modulos = operadores.slice(5, -2)
        expect(modulos.every((op) => op.endsWith(' re'))).toBe(true)
        const matriz = matrizQr(URL)
        expect(reconstruir(modulos.map(aRectangulo), matriz.tamano, opciones.x, opciones.y, opciones.lado)).toEqual(esperada(URL))
    })

    it('estampar escribe el QR como vectores en el contenido de la página (sin imágenes)', async () => {
        const { bytes } = await estampar({
            diseno: await disenoDePrueba(),
            campos: [{ id: 'qr', tipo: 'QR', pagina: 1, x: 650, y: 40, lado: 120 }],
            datos: {
                nombre: 'Ana', tipo: 'PARTICIPANTE', codigo: 'CIISIC-2026-000123-7KQ2XM', fechaEmision: new Date('2026-10-31T00:00:00Z'), horas: null,
                evento: 'VIII CIISIC', eventoCorto: 'VIII', documento: 'DNI 12345678', detalle: null, urlVerificacion: URL,
            },
            codigo: 'CIISIC-2026-000123-7KQ2XM',
            generacion: 'AB12CD34',
        })
        const doc = await PDFDocument.load(bytes)
        const contenidos = doc.getPage(0).node.Contents()
        const flujos = contenidos instanceof PDFArray ? contenidos.asArray().map((ref) => doc.context.lookup(ref)) : [contenidos]
        const texto = flujos.map((flujo) => Buffer.from(decodePDFRawStream(flujo as PDFRawStream).decode()).toString('latin1')).join('\n')
        const matriz = matrizQr(URL)
        const rectangulos = rectangulosQr(matriz, { x: 650, y: 40, lado: 120 })
        // Fondo blanco + módulos (el diseño de prueba no usa `re`: su marco se dibuja como trayecto)
        expect((texto.match(/ re\b/g) ?? []).length).toBe(1 + rectangulos.length)
        expect(texto).toContain('650 40 120 120 re')
        const recursos = doc.getPage(0).node.Resources()
        const imagenes = recursos?.lookupMaybe(PDFName.of('XObject'), PDFDict)
        expect(imagenes?.keys() ?? []).toEqual([])
    })

    it('admite una URL larga (versión de QR mayor)', () => {
        const larga = `${URL}?${'x'.repeat(200)}`
        const matriz = matrizQr(larga)
        expect(matriz.tamano).toBeGreaterThan(matrizQr(URL).tamano)
        expect(reconstruir(rectangulosQr(matriz, { x: 0, y: 0, lado: 300 }), matriz.tamano, 0, 0, 300)).toEqual(esperada(larga))
    })
})

import QRCode from 'qrcode'
import { fill, popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingColor, type Color, type PDFOperator } from 'pdf-lib'

/**
 * QR vectorial para el estampado (spec 015): la matriz de `QRCode.create(url, M)` se dibuja como
 * rectángulos (`re`) llenados de una sola vez (`f`), sin imagen rasterizada y sin costuras entre
 * módulos. Corrección de errores M; margen blanco de 2 módulos dentro del lado pedido.
 */
export const NIVEL_CORRECCION_QR = 'M'
export const MARGEN_QR_MODULOS = 2

export interface MatrizQr {
    /** Módulos por lado. */
    tamano: number
    oscuro(fila: number, columna: number): boolean
}

export function matrizQr(texto: string): MatrizQr {
    const { modules } = QRCode.create(texto, { errorCorrectionLevel: NIVEL_CORRECCION_QR })
    return { tamano: modules.size, oscuro: (fila, columna) => modules.get(fila, columna) === 1 }
}

export interface Rectangulo {
    x: number
    y: number
    ancho: number
    alto: number
}

export interface OpcionesQr {
    /** Esquina inferior izquierda del cuadrado (incluido el margen). */
    x: number
    y: number
    lado: number
}

/** Módulo en PDF de lado `lado`: fila 0 arriba (el eje y del PDF crece hacia arriba). */
export function tamanoModulo(matriz: MatrizQr, lado: number): number {
    return lado / (matriz.tamano + 2 * MARGEN_QR_MODULOS)
}

/**
 * Rectángulos de los módulos oscuros, uniendo los consecutivos de cada fila. Puro: la prueba
 * reconstruye la matriz a partir de ellos.
 */
export function rectangulosQr(matriz: MatrizQr, { x, y, lado }: OpcionesQr): Rectangulo[] {
    const modulo = tamanoModulo(matriz, lado)
    const rectangulos: Rectangulo[] = []
    for (let fila = 0; fila < matriz.tamano; fila++) {
        const yFila = y + lado - (MARGEN_QR_MODULOS + fila + 1) * modulo
        let inicio = -1
        for (let columna = 0; columna <= matriz.tamano; columna++) {
            const oscuro = columna < matriz.tamano && matriz.oscuro(fila, columna)
            if (oscuro && inicio < 0) inicio = columna
            if (!oscuro && inicio >= 0) {
                rectangulos.push({ x: x + (MARGEN_QR_MODULOS + inicio) * modulo, y: yFila, ancho: (columna - inicio) * modulo, alto: modulo })
                inicio = -1
            }
        }
    }
    return rectangulos
}

/** Lo único que el QR necesita de la página (la prueba la simula). */
export interface LienzoQr {
    pushOperators(...operadores: PDFOperator[]): void
}

/** Dibuja el QR de `texto`: fondo blanco del lado completo y módulos en `color` (negro por defecto). */
export function dibujarQr(lienzo: LienzoQr, texto: string, opciones: OpcionesQr & { color?: Color }): void {
    const matriz = matrizQr(texto)
    const { x, y, lado } = opciones
    lienzo.pushOperators(
        pushGraphicsState(),
        setFillingColor(rgb(1, 1, 1)),
        rectangle(x, y, lado, lado),
        fill(),
        setFillingColor(opciones.color ?? rgb(0, 0, 0)),
        ...rectangulosQr(matriz, opciones).map((r) => rectangle(r.x, r.y, r.ancho, r.alto)),
        fill(),
        popGraphicsState(),
    )
}

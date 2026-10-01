import type { Alineacion, Capitalizacion, FormatoFecha, Marcador } from './tipos'

/**
 * Funciones puras de texto del estampado (spec 015). El panel replica `capitalizarTitulo` y
 * `reemplazarMarcadores` con los mismos casos de prueba.
 */

/** Unicode NFC (tildes compuestas) y espacios horizontales colapsados; conserva los saltos de línea. */
export function normalizarTexto(texto: string): string {
    return texto
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((linea) => linea.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .trim()
}

/** Partículas que van en minúscula dentro de un nombre (salvo al inicio). */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der'])

function mayusculaInicial(palabra: string): string {
    if (!palabra) return palabra
    const primera = String.fromCodePoint(palabra.codePointAt(0) as number)
    return primera.toLocaleUpperCase('es') + palabra.slice(primera.length)
}

/**
 * «MARÍA JOSÉ DE LA CRUZ ñahuinlla» → «María José de la Cruz Ñahuinlla». Las partículas (de, del,
 * la…) quedan en minúscula salvo al inicio; los compuestos con guion capitalizan cada parte.
 */
export function capitalizarTitulo(texto: string): string {
    return texto
        .toLocaleLowerCase('es')
        .split(/(\s+)/)
        .map((parte, indice) => {
            if (/^\s+$/.test(parte) || parte === '') return parte
            if (indice > 0 && PARTICULAS.has(parte)) return parte
            return parte.split('-').map(mayusculaInicial).join('-')
        })
        .join('')
}

export function aplicarCapitalizacion(texto: string, modo: Capitalizacion | null | undefined): string {
    if (modo === 'MAYUSCULAS') return texto.toLocaleUpperCase('es')
    if (modo === 'TITULO') return capitalizarTitulo(texto)
    return texto
}

/** Reemplaza `{marcador}` por su valor; un marcador desconocido queda tal cual. */
export function reemplazarMarcadores(plantilla: string, valores: Partial<Record<Marcador, string>>): string {
    return plantilla.replace(/\{([A-Za-z]+)\}/g, (completo, nombre: string) => {
        const valor = (valores as Record<string, string | undefined>)[nombre]
        return Object.prototype.hasOwnProperty.call(valores, nombre) && valor !== undefined ? valor : completo
    })
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Fecha de una columna DATE (medianoche UTC): LARGO «1 de octubre de 2026», CORTO «01/10/2026». */
export function formatearFecha(fecha: Date, formato: FormatoFecha | null | undefined): string {
    const dia = fecha.getUTCDate()
    const mes = fecha.getUTCMonth()
    const anio = fecha.getUTCFullYear()
    if (formato === 'CORTO') return `${String(dia).padStart(2, '0')}/${String(mes + 1).padStart(2, '0')}/${anio}`
    return `${dia} de ${MESES[mes]} de ${anio}`
}

/** Ancho de un texto a un tamaño dado (en pt). */
export type Medidor = (texto: string, tamano: number) => number

/**
 * Parte el texto en líneas que no pasen de `anchoMax` (palabra por palabra; los `\n` fuerzan salto).
 * Una palabra más ancha que la caja queda sola en su línea (desborda).
 */
export function partirEnLineas(texto: string, anchoMax: number, tamano: number, medir: Medidor): string[] {
    const lineas: string[] = []
    for (const parrafo of texto.split('\n')) {
        let actual = ''
        for (const palabra of parrafo.split(' ').filter(Boolean)) {
            const candidata = actual ? `${actual} ${palabra}` : palabra
            if (!actual || medir(candidata, tamano) <= anchoMax) {
                actual = candidata
            } else {
                lineas.push(actual)
                actual = palabra
            }
        }
        lineas.push(actual)
    }
    return lineas
}

export interface TextoAjustado {
    lineas: string[]
    tamano: number
    /** No entró ni al tamaño mínimo en `lineasMax` líneas: la última línea lleva el resto y sale de la caja. */
    desborda: boolean
}

export interface OpcionesAjuste {
    texto: string
    tamano: number
    /** Por defecto, `tamano` (no se reduce). */
    tamanoMinimo?: number | null
    /** Sin ancho no se parte ni se reduce. */
    anchoMax?: number | null
    /** Por defecto 1. */
    lineasMax?: number | null
    medir: Medidor
}

/** Paso con el que se reduce el tamaño (pt). */
const PASO_TAMANO = 0.5

function juntarSobrantes(lineas: string[], lineasMax: number): string[] {
    if (lineas.length <= lineasMax) return lineas
    return [...lineas.slice(0, lineasMax - 1), lineas.slice(lineasMax - 1).join(' ')]
}

/**
 * Elige el mayor tamaño entre `tamano` y `tamanoMinimo` (de 0,5 en 0,5) con el que el texto entra en
 * `lineasMax` líneas de `anchoMax`. Si no entra ni al mínimo, usa el mínimo, junta el resto en la
 * última línea y marca `desborda`.
 */
export function ajustarTexto(opciones: OpcionesAjuste): TextoAjustado {
    const { texto, tamano, medir } = opciones
    const lineasMax = Math.max(1, Math.floor(opciones.lineasMax ?? 1))
    const minimo = Math.min(tamano, opciones.tamanoMinimo ?? tamano)
    const anchoMax = opciones.anchoMax ?? null

    if (anchoMax === null || anchoMax <= 0) {
        const lineas = texto.split('\n')
        return { lineas: juntarSobrantes(lineas, lineasMax), tamano, desborda: lineas.length > lineasMax }
    }

    const cabe = (lineas: string[], s: number) => lineas.length <= lineasMax && lineas.every((linea) => medir(linea, s) <= anchoMax)
    for (let s = tamano; s >= minimo; s = Math.round((s - PASO_TAMANO) * 100) / 100) {
        const lineas = partirEnLineas(texto, anchoMax, s, medir)
        if (cabe(lineas, s)) return { lineas, tamano: s, desborda: false }
    }
    const lineas = partirEnLineas(texto, anchoMax, minimo, medir)
    if (cabe(lineas, minimo)) return { lineas, tamano: minimo, desborda: false }
    return { lineas: juntarSobrantes(lineas, lineasMax), tamano: minimo, desborda: true }
}

/** X donde empieza una línea de `anchoTexto` según la alineación (con caja [x, x + ancho] o ancla en x). */
export function posicionX(alineacion: Alineacion | null | undefined, x: number, ancho: number | null | undefined, anchoTexto: number): number {
    const caja = ancho && ancho > 0 ? ancho : null
    if (alineacion === 'CENTRO') return caja ? x + (caja - anchoTexto) / 2 : x - anchoTexto / 2
    if (alineacion === 'DERECHA') return caja ? x + caja - anchoTexto : x - anchoTexto
    return x
}

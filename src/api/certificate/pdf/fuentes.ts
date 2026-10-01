import * as fontkit from '@pdf-lib/fontkit'
import fs from 'fs'
import path from 'path'

/**
 * Catálogo de fuentes TTF incluidas para estampar certificados (spec 015). Los archivos están en
 * `fuentes/` junto a este módulo; en la imagen Docker los copia el `Dockerfile` a `dist` (tsc no
 * copia binarios). Origen: paquetes npm `@expo-google-fonts/*` (SIL OFL 1.1, `OFL-<familia>.txt`) y
 * `dejavu-fonts-ttf` (licencia Bitstream Vera/DejaVu, `LICENSE-DejaVu.txt`).
 *
 * Toda fuente del catálogo debe embeberse bien como subconjunto (lo prueba estampado.test.ts): Great
 * Vibes y Allura no se incluyen porque el subconjunto de fontkit pierde sus glifos.
 *
 * DejaVu Sans es el respaldo: cuando la fuente elegida no tiene un carácter, ese tramo se escribe
 * con DejaVu Sans (o DejaVu Sans Bold si la fuente es negrita) y el estampado devuelve un aviso.
 */
export const DIRECTORIO_FUENTES = path.join(__dirname, 'fuentes')

interface DefinicionFuente {
    nombre: string
    archivo: string
    negrita: boolean
}

export const FUENTES = {
    MONTSERRAT: { nombre: 'Montserrat', archivo: 'Montserrat-Regular.ttf', negrita: false },
    MONTSERRAT_SEMIBOLD: { nombre: 'Montserrat SemiBold', archivo: 'Montserrat-SemiBold.ttf', negrita: true },
    MONTSERRAT_BOLD: { nombre: 'Montserrat Bold', archivo: 'Montserrat-Bold.ttf', negrita: true },
    POPPINS: { nombre: 'Poppins', archivo: 'Poppins-Regular.ttf', negrita: false },
    POPPINS_BOLD: { nombre: 'Poppins Bold', archivo: 'Poppins-Bold.ttf', negrita: true },
    BARLOW: { nombre: 'Barlow', archivo: 'Barlow-Regular.ttf', negrita: false },
    BARLOW_BOLD: { nombre: 'Barlow Bold', archivo: 'Barlow-Bold.ttf', negrita: true },
    PLAYFAIR_DISPLAY: { nombre: 'Playfair Display', archivo: 'PlayfairDisplay-Regular.ttf', negrita: false },
    PLAYFAIR_DISPLAY_BOLD: { nombre: 'Playfair Display Bold', archivo: 'PlayfairDisplay-Bold.ttf', negrita: true },
    PLAYFAIR_DISPLAY_ITALICA: { nombre: 'Playfair Display Itálica', archivo: 'PlayfairDisplay-Italic.ttf', negrita: false },
    PINYON_SCRIPT: { nombre: 'Pinyon Script (caligráfica)', archivo: 'PinyonScript-Regular.ttf', negrita: false },
    PARISIENNE: { nombre: 'Parisienne (caligráfica)', archivo: 'Parisienne-Regular.ttf', negrita: false },
    DEJAVU_SANS: { nombre: 'DejaVu Sans', archivo: 'DejaVuSans.ttf', negrita: false },
    DEJAVU_SANS_BOLD: { nombre: 'DejaVu Sans Bold', archivo: 'DejaVuSans-Bold.ttf', negrita: true },
} as const satisfies Record<string, DefinicionFuente>

export type CodigoFuente = keyof typeof FUENTES
export const CODIGOS_FUENTE = Object.keys(FUENTES) as CodigoFuente[]
export const FUENTE_POR_DEFECTO: CodigoFuente = 'MONTSERRAT'

/** Archivos de licencia que acompañan a las fuentes (deben viajar con ellas). */
export const LICENCIAS_FUENTES = ['OFL-Montserrat.txt', 'OFL-Poppins.txt', 'OFL-Barlow.txt', 'OFL-PlayfairDisplay.txt', 'OFL-PinyonScript.txt', 'OFL-Parisienne.txt', 'LICENSE-DejaVu.txt'] as const

export function esCodigoFuente(valor: unknown): valor is CodigoFuente {
    return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(FUENTES, valor)
}

/** Fuente de respaldo para los caracteres que la elegida no tiene. */
export function respaldoDe(codigo: CodigoFuente): CodigoFuente {
    return FUENTES[codigo].negrita ? 'DEJAVU_SANS_BOLD' : 'DEJAVU_SANS'
}

/** Lo que muestra el panel al elegir la fuente de un campo (`GET /v1/certificate-fonts`). */
export function catalogoFuentes(): { codigo: CodigoFuente, nombre: string }[] {
    return CODIGOS_FUENTE.map((codigo) => ({ codigo, nombre: FUENTES[codigo].nombre }))
}

export function rutaFuente(codigo: CodigoFuente): string {
    return path.join(DIRECTORIO_FUENTES, FUENTES[codigo].archivo)
}

const bytesCache = new Map<CodigoFuente, Uint8Array>()
const fontkitCache = new Map<CodigoFuente, fontkit.Font>()

/** Bytes del TTF (se leen una vez por proceso). */
export function bytesFuente(codigo: CodigoFuente): Uint8Array {
    let bytes = bytesCache.get(codigo)
    if (!bytes) {
        bytes = new Uint8Array(fs.readFileSync(rutaFuente(codigo)))
        bytesCache.set(codigo, bytes)
    }
    return bytes
}

/** La fuente abierta con fontkit, para saber qué caracteres tiene (`hasGlyphForCodePoint`). */
export function fuenteFontkit(codigo: CodigoFuente): fontkit.Font {
    let fuente = fontkitCache.get(codigo)
    if (!fuente) {
        fuente = fontkit.create(bytesFuente(codigo))
        fontkitCache.set(codigo, fuente)
    }
    return fuente
}

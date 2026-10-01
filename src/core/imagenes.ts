import zlib from 'zlib'
import { unprocessable } from './http-error'

/**
 * Imágenes subidas por los usuarios (QR de pago, fotos del fotocheck): tipo real por la firma de
 * bytes y limpieza de metadatos sin librerías de terceros.
 */
export type TipoImagen = 'png' | 'jpg' | 'webp'

/** Tipos admitidos para la foto del fotocheck (spec 014). */
export type TipoFoto = Extract<TipoImagen, 'png' | 'jpg'>

export const TIPO_POR_MIME: Record<string, TipoImagen> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
export const MIME_POR_TIPO: Record<TipoImagen, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/**
 * Dimensiones máximas de una foto. Pesar 2 MB no basta: una imagen comprimida de pocos KB puede
 * declarar 25 000 × 25 000 píxeles y ocupar gigabytes al decodificarla (en Chromium al generar el
 * PDF, en el celular del escáner). El panel ya reduce la foto antes de subirla.
 */
export const MAX_LADO_FOTO = 4096
export const MAX_PIXELES_FOTO = 4096 * 4096
/** Escaneos de un JPEG progresivo (uno normal trae unos 10): muchos encarecen decodificarlo. */
const MAX_ESCANEOS_JPEG = 64

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Tipo real de la imagen según sus primeros bytes (no según el nombre ni el MIME declarado). */
export function tipoDeImagen(bytes: Buffer): TipoImagen | null {
    if (bytes.subarray(0, 8).equals(FIRMA_PNG)) return 'png'
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
    return null
}

const imagenDanada = () => unprocessable('INVALID_FILE_CONTENT', 'La imagen está dañada o no es una imagen PNG o JPG válida.')

/** 422 `IMAGE_TOO_LARGE` si la imagen declara más de 4096 px por lado (o 16,7 MP); 422 dañada si declara 0. */
function exigirDimensiones(ancho: number, alto: number) {
    if (!ancho || !alto) throw imagenDanada()
    if (ancho > MAX_LADO_FOTO || alto > MAX_LADO_FOTO || ancho * alto > MAX_PIXELES_FOTO) {
        throw unprocessable('IMAGE_TOO_LARGE', `La foto es demasiado grande: como máximo ${MAX_LADO_FOTO} × ${MAX_LADO_FOTO} píxeles. Redúcela e intenta otra vez.`)
    }
}

// ─── JPEG ───────────────────────────────────────────────────────────────────

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
/** Tablas y parámetros necesarios para decodificar: DHT, DAC, DQT y DRI. */
const SEGMENTOS_JPEG_CONSERVADOS = new Set([0xc4, 0xcc, 0xdb, 0xdd])
const esRst = (marcador: number) => marcador >= 0xd0 && marcador <= 0xd7
/** SOF0–SOF15 salvo DHT (C4), JPG (C8) y DAC (CC). */
const esSof = (marcador: number) => marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc

/**
 * Copia del JPEG con solo lo necesario para decodificarlo: SOFn, DHT, DAC, DQT, DRI, los escaneos y
 * EOI. Descarta todo segmento APPn (también APP0/JFIF, que puede traer una miniatura), COM y los
 * desconocidos, y lo que sigue a EOI. Exige un único SOFn antes del primer escaneo y sus dimensiones
 * dentro del máximo.
 */
function limpiarJpeg(bytes: Buffer): Buffer {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) throw imagenDanada()
    const partes: Buffer[] = [bytes.subarray(0, 2)]
    let marcos = 0
    let escaneos = 0
    let i = 2
    while (i < bytes.length) {
        if (bytes[i] !== 0xff) throw imagenDanada()
        // Bytes de relleno 0xFF antes del marcador
        while (i + 1 < bytes.length && bytes[i + 1] === 0xff) i++
        if (i + 1 >= bytes.length) throw imagenDanada()
        const marcador = bytes[i + 1]
        if (marcador === EOI) {
            if (!escaneos) throw imagenDanada()
            partes.push(bytes.subarray(i, i + 2))
            return Buffer.concat(partes)
        }
        // Un reinicio fuera de los datos se ignora; otro SOI o un marcador sin longitud no es válido aquí
        if (esRst(marcador)) {
            i += 2
            continue
        }
        if (marcador === SOI || marcador === 0x01 || marcador === 0x00) throw imagenDanada()
        if (i + 4 > bytes.length) throw imagenDanada()
        const largo = bytes.readUInt16BE(i + 2)
        const fin = i + 2 + largo
        if (largo < 2 || fin > bytes.length) throw imagenDanada()

        if (esSof(marcador)) {
            // FF Cn | largo (2) | precisión (1) | alto (2) | ancho (2) | componentes (1) | …
            if (largo < 8 || ++marcos > 1 || escaneos) throw imagenDanada()
            exigirDimensiones(bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5))
            partes.push(bytes.subarray(i, fin))
        } else if (marcador === SOS) {
            if (!marcos || ++escaneos > MAX_ESCANEOS_JPEG) throw imagenDanada()
            partes.push(bytes.subarray(i, fin))
        } else if (SEGMENTOS_JPEG_CONSERVADOS.has(marcador)) {
            partes.push(bytes.subarray(i, fin))
        }
        i = fin
        if (marcador === SOS) {
            // Datos comprimidos hasta el siguiente marcador real (0xFF00 y RSTn son parte de los datos)
            const inicio = i
            while (i < bytes.length) {
                if (bytes[i] === 0xff && i + 1 < bytes.length) {
                    const siguiente = bytes[i + 1]
                    if (siguiente === 0x00 || esRst(siguiente)) {
                        i += 2
                        continue
                    }
                    if (siguiente !== 0xff) break
                }
                i++
            }
            partes.push(bytes.subarray(inicio, i))
        }
    }
    // Sin EOI (archivo truncado tras los datos): se conserva lo decodificable
    if (!escaneos) throw imagenDanada()
    return Buffer.concat(partes)
}

// ─── PNG ────────────────────────────────────────────────────────────────────

/**
 * Chunks que se conservan: los críticos y los de color y tamaño de pixel. Se descartan los de texto,
 * EXIF y fecha, los perfiles ICC, los de animación (APNG: acTL, fcTL, fdAT) y cualquier otro o privado.
 */
const CHUNKS_PNG_CONSERVADOS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs'])

/**
 * Copia del PNG con solo los chunks conservados y nada después de IEND. Exige IHDR como primer
 * chunk (con las dimensiones dentro del máximo), el CRC correcto en cada chunk y al menos un IDAT.
 */
function limpiarPng(bytes: Buffer): Buffer {
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(FIRMA_PNG)) throw imagenDanada()
    const partes: Buffer[] = [bytes.subarray(0, 8)]
    let conDatos = false
    let i = 8
    while (i + 12 <= bytes.length) {
        const largo = bytes.readUInt32BE(i)
        const tipo = bytes.subarray(i + 4, i + 8).toString('latin1')
        const fin = i + 12 + largo
        if (!/^[A-Za-z]{4}$/.test(tipo) || fin > bytes.length) throw imagenDanada()
        if (zlib.crc32(bytes.subarray(i + 4, fin - 4)) !== bytes.readUInt32BE(fin - 4)) throw imagenDanada()
        const primero = i === 8
        if (primero !== (tipo === 'IHDR')) throw imagenDanada()
        if (primero) {
            // IHDR: ancho (4) | alto (4) | profundidad | tipo de color | compresión | filtro | entrelazado
            if (largo !== 13) throw imagenDanada()
            exigirDimensiones(bytes.readUInt32BE(i + 8), bytes.readUInt32BE(i + 12))
        }
        if (tipo === 'IDAT') conDatos = true
        if (CHUNKS_PNG_CONSERVADOS.has(tipo)) partes.push(bytes.subarray(i, fin))
        i = fin
        if (tipo === 'IEND') {
            if (!conDatos) throw imagenDanada()
            return Buffer.concat(partes)
        }
    }
    throw imagenDanada()
}

/**
 * Copia de la foto sin metadatos ni datos ajenos a la imagen (spec 014): JPEG solo con lo necesario
 * para decodificarlo; PNG solo con los chunks críticos y de color. Los datos de la imagen no se
 * recodifican. Una estructura dañada responde 422 `INVALID_FILE_CONTENT`; más de 4096 px por lado,
 * 422 `IMAGE_TOO_LARGE`.
 */
export function limpiarMetadatos(bytes: Buffer, tipo: TipoFoto): Buffer {
    return tipo === 'png' ? limpiarPng(bytes) : limpiarJpeg(bytes)
}

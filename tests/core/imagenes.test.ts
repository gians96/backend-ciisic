import zlib from 'zlib'
import QRCode from 'qrcode'
import { limpiarMetadatos, tipoDeImagen } from '../../src/core/imagenes'
import { HttpError } from '../../src/core/http-error'

// ─── JPEG construido a mano ────────────────────────────────────────────────

const bytes = (datos: Buffer | string) => (Buffer.isBuffer(datos) ? datos : Buffer.from(datos, 'latin1'))

/** Segmento JPEG con longitud: FF <marcador> <largo de 2 bytes> <datos>. */
function segmento(marcador: number, datos: Buffer | string): Buffer {
    const cuerpo = bytes(datos)
    const cabecera = Buffer.from([0xff, marcador, 0, 0])
    cabecera.writeUInt16BE(cuerpo.length + 2, 2)
    return Buffer.concat([cabecera, cuerpo])
}

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const APP0 = segmento(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0')
const EXIF = segmento(0xe1, 'Exif\0\0GPS -12.0464 -77.0428 secreto')
const ICC = segmento(0xe2, 'ICC_PROFILE\0perfil secreto')
const IPTC = segmento(0xed, 'Photoshop 3.0\0iptc secreto')
const COM = segmento(0xfe, 'comentario secreto')
const DQT = segmento(0xdb, Buffer.alloc(65, 1))
const SOF0 = segmento(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]))
const DHT = segmento(0xc4, Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7]))
const SOS = segmento(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]))
// Datos comprimidos con un 0xFF escapado (FF 00) y un marcador de reinicio (FF D0): son parte de los datos
const DATOS = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])

const jpeg = (...partes: Buffer[]) => Buffer.concat(partes)
const errorDe = (fn: () => unknown) => {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error('Se esperaba un error')
}

describe('tipoDeImagen', () => {
    it('reconoce PNG, JPEG y WebP por sus bytes y nada más', () => {
        expect(tipoDeImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png')
        expect(tipoDeImagen(jpeg(SOI, APP0))).toBe('jpg')
        expect(tipoDeImagen(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('webp')
        expect(tipoDeImagen(Buffer.from('%PDF-1.4'))).toBeNull()
        expect(tipoDeImagen(Buffer.from('<svg></svg>'))).toBeNull()
    })
})

/** SOF0 con las dimensiones dadas (8 bits, 1 componente). */
function sof0(ancho: number, alto: number): Buffer {
    const datos = Buffer.from([8, 0, 0, 0, 0, 1, 1, 0x11, 0])
    datos.writeUInt16BE(alto, 1)
    datos.writeUInt16BE(ancho, 3)
    return segmento(0xc0, datos)
}

describe('limpiarMetadatos · JPEG', () => {
    it('quita todo APPn (EXIF, ICC, IPTC y también APP0) y COM, conserva los datos y descarta lo que sigue a EOI', () => {
        const original = jpeg(SOI, APP0, EXIF, ICC, COM, DQT, SOF0, IPTC, DHT, SOS, DATOS, EOI, Buffer.from('basura secreta'))
        const limpio = limpiarMetadatos(original, 'jpg')
        expect(limpio.equals(jpeg(SOI, DQT, SOF0, DHT, SOS, DATOS, EOI))).toBe(true)
        expect(limpio.toString('latin1')).not.toMatch(/secret|GPS|ICC_PROFILE|Photoshop|JFIF/)
    })

    it('APP0 con miniatura, varios APP0 y marcadores desconocidos (JPGn) no pasan: no se pueden guardar datos arbitrarios', () => {
        const app0ConMiniatura = segmento(0xe0, Buffer.concat([Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\x02\x02', 'latin1'), Buffer.from('datos arbitrarios')]))
        const jpgn = segmento(0xf3, 'carga util escondida')
        const original = jpeg(SOI, app0ConMiniatura, APP0, jpgn, DQT, SOF0, DHT, SOS, DATOS, EOI)
        const limpio = limpiarMetadatos(original, 'jpg')
        expect(limpio.equals(jpeg(SOI, DQT, SOF0, DHT, SOS, DATOS, EOI))).toBe(true)
        expect(limpio.toString('latin1')).not.toMatch(/arbitrarios|escondida/)
    })

    it('JPEG progresivo: limpia también los segmentos entre escaneos', () => {
        const original = jpeg(SOI, APP0, DQT, SOF0, DHT, SOS, DATOS, EXIF, DHT, SOS, DATOS, COM, EOI)
        expect(limpiarMetadatos(original, 'jpg').equals(jpeg(SOI, DQT, SOF0, DHT, SOS, DATOS, DHT, SOS, DATOS, EOI))).toBe(true)
    })

    it('admite bytes de relleno antes de un marcador y un archivo truncado después de los datos', () => {
        const relleno = Buffer.from([0xff, 0xff])
        const original = jpeg(SOI, APP0, relleno, EXIF, DQT, SOF0, SOS, DATOS)
        expect(limpiarMetadatos(original, 'jpg').equals(jpeg(SOI, DQT, SOF0, SOS, DATOS))).toBe(true)
    })

    it('rechaza una bomba de descompresión: más de 4096 px por lado (422 IMAGE_TOO_LARGE)', () => {
        expect(limpiarMetadatos(jpeg(SOI, DQT, sof0(4096, 4096), SOS, DATOS, EOI), 'jpg').length).toBeGreaterThan(0)
        for (const [ancho, alto] of [[25000, 25000], [4097, 1], [1, 4097]]) {
            const error = errorDe(() => limpiarMetadatos(jpeg(SOI, DQT, sof0(ancho, alto), SOS, DATOS, EOI), 'jpg'))
            expect(error).toMatchObject({ status: 422, code: 'IMAGE_TOO_LARGE' })
        }
    })

    it('una estructura dañada responde 422 INVALID_FILE_CONTENT', () => {
        const largoFalso = Buffer.from([0xff, 0xe1, 0x40, 0x00, 0x01])
        const muchosEscaneos = Array.from({ length: 65 }, () => [SOS, DATOS]).flat()
        for (const danado of [
            jpeg(SOI, APP0, largoFalso),
            jpeg(SOI, APP0, Buffer.from([0x00, 0x01])),
            jpeg(SOI, APP0, DQT),
            // Escaneo sin SOFn, dos SOFn, alto 0 (DNL) y otro SOI
            jpeg(SOI, DQT, SOS, DATOS, EOI),
            jpeg(SOI, DQT, SOF0, SOF0, SOS, DATOS, EOI),
            jpeg(SOI, DQT, sof0(10, 0), SOS, DATOS, EOI),
            jpeg(SOI, DQT, SOF0, SOI, SOS, DATOS, EOI),
            jpeg(SOI, DQT, SOF0, ...muchosEscaneos, EOI),
            Buffer.from('no es una imagen'),
        ]) {
            const error = errorDe(() => limpiarMetadatos(danado, 'jpg'))
            expect(error).toBeInstanceOf(HttpError)
            expect(error).toMatchObject({ status: 422, code: 'INVALID_FILE_CONTENT' })
        }
    })
})

// ─── PNG construido a mano ─────────────────────────────────────────────────

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(tipo: string, datos: Buffer | string): Buffer {
    const cuerpo = bytes(datos)
    const cabecera = Buffer.alloc(8)
    cabecera.writeUInt32BE(cuerpo.length, 0)
    cabecera.write(tipo, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([cabecera.subarray(4), cuerpo])), 0)
    return Buffer.concat([cabecera, cuerpo, crc])
}

const IHDR = chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]))
const PHYS = chunk('pHYs', Buffer.alloc(9))
const IDAT = chunk('IDAT', Buffer.from([1, 2, 3]))
const IEND = chunk('IEND', '')
const METADATOS_PNG = [
    chunk('tEXt', 'Author\0secreto'),
    chunk('iTXt', 'XML:com.adobe.xmp\0\0\0\0\0secreto'),
    chunk('zTXt', 'Comment\0\0secreto'),
    chunk('eXIf', 'MM\0*GPS secreto'),
    chunk('tIME', Buffer.from([7, 234, 10, 1, 12, 0, 0])),
]

describe('limpiarMetadatos · PNG', () => {
    it('quita tEXt, iTXt, zTXt, eXIf y tIME, conserva el resto y descarta lo que sigue a IEND', () => {
        const original = Buffer.concat([FIRMA_PNG, IHDR, METADATOS_PNG[0], PHYS, ...METADATOS_PNG.slice(1), IDAT, IEND, Buffer.from('basura secreta')])
        const limpio = limpiarMetadatos(original, 'png')
        expect(limpio.equals(Buffer.concat([FIRMA_PNG, IHDR, PHYS, IDAT, IEND]))).toBe(true)
        expect(limpio.toString('latin1')).not.toMatch(/secret|GPS|xmp/)
    })

    it('un PNG real queda idéntico salvo los chunks de metadatos', async () => {
        const real = await QRCode.toBuffer('K7Q2M9X4TB')
        const fin = real.length - IEND.length
        const conTexto = Buffer.concat([real.subarray(0, 33), METADATOS_PNG[0], real.subarray(33, fin), METADATOS_PNG[3], real.subarray(fin)])
        expect(limpiarMetadatos(conTexto, 'png').equals(real)).toBe(true)
        expect(limpiarMetadatos(real, 'png').equals(real)).toBe(true)
    })

    it('descarta los chunks de animación (APNG), los perfiles ICC y los privados: no se pueden guardar datos arbitrarios', () => {
        const extra = [
            chunk('acTL', Buffer.alloc(8)), chunk('fcTL', Buffer.alloc(26)), chunk('iCCP', 'perfil\0\0datos'), chunk('prVt', 'carga util escondida'),
        ]
        const original = Buffer.concat([FIRMA_PNG, IHDR, extra[0], extra[2], PHYS, extra[1], IDAT, chunk('fdAT', 'cuadro escondido'), extra[3], IEND])
        const limpio = limpiarMetadatos(original, 'png')
        expect(limpio.equals(Buffer.concat([FIRMA_PNG, IHDR, PHYS, IDAT, IEND]))).toBe(true)
        expect(limpio.toString('latin1')).not.toMatch(/escondid|perfil/)
    })

    it('rechaza una bomba de descompresión: más de 4096 px por lado (422 IMAGE_TOO_LARGE)', () => {
        const ihdr = (ancho: number, alto: number) => {
            const datos = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0])
            datos.writeUInt32BE(ancho, 0)
            datos.writeUInt32BE(alto, 4)
            return chunk('IHDR', datos)
        }
        expect(limpiarMetadatos(Buffer.concat([FIRMA_PNG, ihdr(4096, 4096), IDAT, IEND]), 'png').length).toBeGreaterThan(0)
        for (const [ancho, alto] of [[25000, 25000], [4097, 1], [1, 4097]]) {
            const error = errorDe(() => limpiarMetadatos(Buffer.concat([FIRMA_PNG, ihdr(ancho, alto), IDAT, IEND]), 'png'))
            expect(error).toMatchObject({ status: 422, code: 'IMAGE_TOO_LARGE' })
        }
        expect(errorDe(() => limpiarMetadatos(Buffer.concat([FIRMA_PNG, ihdr(0, 10), IDAT, IEND]), 'png'))).toMatchObject({ code: 'INVALID_FILE_CONTENT' })
    })

    it('una estructura dañada responde 422 INVALID_FILE_CONTENT', () => {
        const largoFalso = Buffer.from([0, 0, 0x10, 0, 0x49, 0x44, 0x41, 0x54, 1, 2])
        const crcMalo = Buffer.from(IDAT)
        crcMalo[crcMalo.length - 1] ^= 0xff
        for (const danado of [
            Buffer.concat([FIRMA_PNG, IHDR, IDAT]),
            Buffer.concat([FIRMA_PNG, IHDR, largoFalso]),
            Buffer.concat([FIRMA_PNG, Buffer.from([0, 0, 0, 0, 0x31, 0x32, 0x33, 0x34, 0, 0, 0, 0]), IEND]),
            // CRC incorrecto, IHDR que no es el primero o repetido, y sin IDAT
            Buffer.concat([FIRMA_PNG, IHDR, crcMalo, IEND]),
            Buffer.concat([FIRMA_PNG, PHYS, IHDR, IDAT, IEND]),
            Buffer.concat([FIRMA_PNG, IHDR, IHDR, IDAT, IEND]),
            Buffer.concat([FIRMA_PNG, IHDR, PHYS, IEND]),
            jpeg(SOI, APP0),
        ]) {
            expect(errorDe(() => limpiarMetadatos(danado, 'png'))).toMatchObject({ status: 422, code: 'INVALID_FILE_CONTENT' })
        }
    })
})

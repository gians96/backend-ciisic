import crypto from 'crypto'

/**
 * Firmas digitales reales para las pruebas (spec 015): certificado X.509 autofirmado y CMS
 * `SignedData` desprendido (como `adbe.pkcs7.detached`), codificados en DER sin dependencias.
 * Las claves se generan en memoria; nada sale de la prueba.
 */

function longitud(n: number): Buffer {
    if (n < 0x80) return Buffer.from([n])
    const bytes: number[] = []
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
    return Buffer.from([0x80 | bytes.length, ...bytes])
}

export const der = (etiqueta: number, contenido: Buffer) => Buffer.concat([Buffer.from([etiqueta]), longitud(contenido.length), contenido])
export const sec = (...partes: Buffer[]) => der(0x30, Buffer.concat(partes))
/** SET OF en DER: los elementos ordenados por su codificación. */
export const conjunto = (...partes: Buffer[]) => der(0x31, Buffer.concat([...partes].sort(Buffer.compare)))
export const octetos = (b: Buffer) => der(0x04, b)
export const nulo = () => Buffer.from([0x05, 0x00])
export const explicito = (n: number, contenido: Buffer) => der(0xa0 + n, contenido)

export function entero(valor: number | Buffer): Buffer {
    let bytes = typeof valor === 'number' ? Buffer.from(valor.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex') : valor
    if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes])
    return der(0x02, bytes)
}

export function oid(texto: string): Buffer {
    const [a, b, ...resto] = texto.split('.').map(Number)
    const bytes = [a * 40 + b]
    for (const n of resto) {
        const grupo = [n & 0x7f]
        for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) grupo.unshift((v & 0x7f) | 0x80)
        bytes.push(...grupo)
    }
    return der(0x06, Buffer.from(bytes))
}

const utc = (fecha: Date) => der(0x17, Buffer.from(fecha.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z', 'latin1'))
const utf8 = (texto: string) => der(0x0c, Buffer.from(texto, 'utf8'))
const nombreX500 = (cn: string) => sec(conjunto(sec(oid('2.5.4.3'), utf8(cn))))

const OID = {
    sha256: '2.16.840.1.101.3.4.2.1',
    ecdsaSha256: '1.2.840.10045.4.3.2',
    rsa: '1.2.840.113549.1.1.1',
    rsaSha256: '1.2.840.113549.1.1.11',
    data: '1.2.840.113549.1.7.1',
    signedData: '1.2.840.113549.1.7.2',
    contentType: '1.2.840.113549.1.9.3',
    messageDigest: '1.2.840.113549.1.9.4',
    signingTime: '1.2.840.113549.1.9.5',
}

export interface Firmante {
    nombre: string
    clave: crypto.KeyObject
    certificado: Buffer
    emisor: Buffer
    serie: Buffer
    tipo: 'ec' | 'rsa'
}

let serieSiguiente = 0x1001

/** Certificado autofirmado (P-256 por rapidez; `rsa` para probar RSA). */
export function nuevoFirmante(nombre = 'Firmante de Prueba', tipo: 'ec' | 'rsa' = 'ec'): Firmante {
    const { privateKey, publicKey } = tipo === 'ec'
        ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
        : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    const algoritmo = tipo === 'ec' ? sec(oid(OID.ecdsaSha256)) : sec(oid(OID.rsaSha256), nulo())
    const serie = Buffer.from((serieSiguiente++).toString(16).padStart(4, '0'), 'hex')
    const emisor = nombreX500(nombre)
    const desde = new Date(Date.now() - 86_400_000)
    const hasta = new Date(Date.now() + 365 * 86_400_000)
    const tbs = sec(explicito(0, entero(2)), entero(serie), algoritmo, emisor, sec(utc(desde), utc(hasta)), emisor, spki)
    const firma = crypto.sign('sha256', tbs, privateKey)
    const certificado = sec(tbs, algoritmo, der(0x03, Buffer.concat([Buffer.from([0]), firma])))
    return { nombre, clave: privateKey, certificado, emisor, serie, tipo }
}

export interface OpcionesCms {
    /** `messageDigest` de otros bytes (como si el documento cambiara después de firmar). */
    resumenAjeno?: boolean
    /** Firma con otra clave que la del certificado. */
    otraClave?: crypto.KeyObject
}

/** CMS `SignedData` desprendido sobre `contenido` (los bytes del `/ByteRange`). */
export function crearCms(contenido: Buffer, firmante: Firmante, opciones: OpcionesCms = {}): Buffer {
    const resumen = crypto.createHash('sha256').update(opciones.resumenAjeno ? Buffer.concat([contenido, Buffer.from('x')]) : contenido).digest()
    const atributos = conjunto(
        sec(oid(OID.contentType), conjunto(oid(OID.data))),
        sec(oid(OID.signingTime), conjunto(utc(new Date('2026-11-01T17:00:00Z')))),
        sec(oid(OID.messageDigest), conjunto(octetos(resumen))),
    )
    const firma = crypto.sign('sha256', atributos, opciones.otraClave ?? firmante.clave)
    const implicitos = Buffer.from(atributos)
    implicitos[0] = 0xa0
    const algoritmoFirma = firmante.tipo === 'ec' ? sec(oid(OID.ecdsaSha256)) : sec(oid(OID.rsa), nulo())
    const infoFirmante = sec(entero(1), sec(firmante.emisor, entero(firmante.serie)), sec(oid(OID.sha256), nulo()), implicitos, algoritmoFirma, octetos(firma))
    const signedData = sec(
        entero(1),
        conjunto(sec(oid(OID.sha256), nulo())),
        sec(oid(OID.data)),
        der(0xa0, firmante.certificado),
        conjunto(infoFirmante),
    )
    return sec(oid(OID.signedData), explicito(0, signedData))
}

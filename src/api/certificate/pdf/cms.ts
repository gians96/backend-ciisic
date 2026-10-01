import crypto from 'crypto'

/**
 * Verificación criptográfica de las firmas de un PDF (spec 015): `/Contents` de un diccionario de
 * firma es un CMS `SignedData` (RFC 5652) desprendido (`adbe.pkcs7.detached`, `ETSI.CAdES.detached`)
 * o con el SHA-1 del contenido (`adbe.pkcs7.sha1`). Se comprueba que:
 * - el atributo firmado `messageDigest` sea el hash de los bytes que cubre el `/ByteRange`;
 * - la firma de los atributos firmados (o del contenido, si no los hay) verifique con la clave del
 *   certificado del firmante que trae el propio CMS (RSA PKCS#1 v1.5, RSA-PSS o ECDSA).
 *
 * No se encadena el certificado a una raíz de confianza (RENIEC, FirmaPerú): queda pendiente. Por
 * eso el firmante (nombre, emisor, serie, vigencia) se guarda y se muestra en el panel.
 *
 * Lector DER propio (sin dependencias): solo lo necesario para `SignedData`, con límites de
 * profundidad y de nodos. Acepta longitudes indefinidas (BER) en lo que no se firma.
 */

export interface Firmante {
    /** CN del certificado (o el sujeto completo si no tiene CN). */
    nombre: string
    /** CN del emisor. */
    emisor: string
    /** Número de serie del certificado (hexadecimal). */
    serie: string
    validoDesde: string | null
    validoHasta: string | null
    /** `signingTime` del CMS, si lo trae (ISO). */
    fechaFirma: string | null
}

export type ResultadoCms = { valida: true, firmante: Firmante } | { valida: false, motivo: string }

// ─── DER ────────────────────────────────────────────────────────────────────

interface Nodo {
    /** Primer byte del identificador (clase, construido y etiqueta). */
    id: number
    etiqueta: number
    clase: number
    construido: boolean
    inicio: number
    inicioContenido: number
    /** Fin del contenido (sin el EOC de una longitud indefinida). */
    finContenido: number
    /** Fin del TLV completo. */
    fin: number
}

class ErrorDer extends Error {}

const PROFUNDIDAD_MAX = 40
const NODOS_MAX = 200_000

class LectorDer {
    private nodos = 0

    constructor(readonly datos: Buffer) {}

    leer(pos: number, limite: number, profundidad = 0): Nodo {
        if (++this.nodos > NODOS_MAX || profundidad > PROFUNDIDAD_MAX) throw new ErrorDer('estructura demasiado grande')
        if (pos + 2 > limite) throw new ErrorDer('fin inesperado')
        const id = this.datos[pos]
        if ((id & 0x1f) === 0x1f) throw new ErrorDer('etiqueta extendida no admitida')
        let p = pos + 1
        const primero = this.datos[p++]
        const construido = (id & 0x20) !== 0
        let finContenido: number
        let fin: number
        if (primero === 0x80) {
            if (!construido) throw new ErrorDer('longitud indefinida en un primitivo')
            let q = p
            for (;;) {
                if (q + 2 > limite) throw new ErrorDer('longitud indefinida sin fin')
                if (this.datos[q] === 0 && this.datos[q + 1] === 0) break
                q = this.leer(q, limite, profundidad + 1).fin
            }
            finContenido = q
            fin = q + 2
        } else {
            let longitud = primero
            if (primero & 0x80) {
                const n = primero & 0x7f
                if (n > 4 || p + n > limite) throw new ErrorDer('longitud inválida')
                longitud = 0
                for (let i = 0; i < n; i++) longitud = longitud * 256 + this.datos[p++]
            }
            finContenido = p + longitud
            fin = finContenido
            if (fin > limite) throw new ErrorDer('longitud fuera de rango')
        }
        return { id, etiqueta: id & 0x1f, clase: id & 0xc0, construido, inicio: pos, inicioContenido: p, finContenido, fin }
    }

    hijos(nodo: Nodo, profundidad = 1): Nodo[] {
        if (!nodo.construido) throw new ErrorDer('se esperaba un valor construido')
        const lista: Nodo[] = []
        for (let p = nodo.inicioContenido; p < nodo.finContenido;) {
            const hijo = this.leer(p, nodo.finContenido, profundidad)
            lista.push(hijo)
            p = hijo.fin
        }
        return lista
    }

    contenido(nodo: Nodo): Buffer {
        return this.datos.subarray(nodo.inicioContenido, nodo.finContenido)
    }

    tlv(nodo: Nodo): Buffer {
        return this.datos.subarray(nodo.inicio, nodo.fin)
    }
}

const UNIVERSAL = 0x00
const CONTEXTO = 0x80
const T = { INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, OID: 0x06, UTC_TIME: 0x17, GENERALIZED_TIME: 0x18, SEQUENCE: 0x10, SET: 0x11 }

function exigir(nodo: Nodo | undefined, etiqueta: number, clase = UNIVERSAL): Nodo {
    if (!nodo || nodo.etiqueta !== etiqueta || nodo.clase !== clase) throw new ErrorDer('estructura CMS inesperada')
    return nodo
}

function oid(bytes: Buffer): string {
    if (!bytes.length) throw new ErrorDer('OID vacío')
    const partes: number[] = []
    let valor = 0
    for (const byte of bytes) {
        valor = valor * 128 + (byte & 0x7f)
        if (!(byte & 0x80)) {
            if (!partes.length) partes.push(valor < 80 ? Math.floor(valor / 40) : 2, valor < 80 ? valor % 40 : valor - 80)
            else partes.push(valor)
            valor = 0
        }
    }
    return partes.join('.')
}

/** Entero DER sin los ceros de signo a la izquierda (para comparar números de serie). */
function enteroNormalizado(bytes: Buffer): string {
    let i = 0
    while (i < bytes.length - 1 && bytes[i] === 0) i++
    return bytes.subarray(i).toString('hex')
}

// ─── Algoritmos ─────────────────────────────────────────────────────────────

const HASHES: Record<string, string> = {
    '1.3.14.3.2.26': 'sha1',
    '2.16.840.1.101.3.4.2.4': 'sha224',
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512',
}

/** Algoritmos de firma con el hash implícito (`null`: el del `digestAlgorithm`). */
const FIRMAS: Record<string, { tipo: 'rsa' | 'ecdsa' | 'pss', hash: string | null }> = {
    '1.2.840.113549.1.1.1': { tipo: 'rsa', hash: null },
    '1.2.840.113549.1.1.5': { tipo: 'rsa', hash: 'sha1' },
    '1.2.840.113549.1.1.14': { tipo: 'rsa', hash: 'sha224' },
    '1.2.840.113549.1.1.11': { tipo: 'rsa', hash: 'sha256' },
    '1.2.840.113549.1.1.12': { tipo: 'rsa', hash: 'sha384' },
    '1.2.840.113549.1.1.13': { tipo: 'rsa', hash: 'sha512' },
    '1.2.840.113549.1.1.10': { tipo: 'pss', hash: null },
    '1.2.840.10045.2.1': { tipo: 'ecdsa', hash: null },
    '1.2.840.10045.4.1': { tipo: 'ecdsa', hash: 'sha1' },
    '1.2.840.10045.4.3.1': { tipo: 'ecdsa', hash: 'sha224' },
    '1.2.840.10045.4.3.2': { tipo: 'ecdsa', hash: 'sha256' },
    '1.2.840.10045.4.3.3': { tipo: 'ecdsa', hash: 'sha384' },
    '1.2.840.10045.4.3.4': { tipo: 'ecdsa', hash: 'sha512' },
}

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2'
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4'
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5'
const OID_SKI = '2.5.29.14'

// ─── Certificados ───────────────────────────────────────────────────────────

interface Certificado {
    der: Buffer
    serie: string
    emisorDer: Buffer
    ski: string | null
}

function leerCertificado(lector: LectorDer, nodo: Nodo): Certificado {
    const [tbs] = lector.hijos(nodo)
    const campos = lector.hijos(exigir(tbs, T.SEQUENCE))
    let i = 0
    if (campos[0]?.clase === CONTEXTO && campos[0].etiqueta === 0) i++ // [0] versión
    const serie = enteroNormalizado(lector.contenido(exigir(campos[i], T.INTEGER)))
    const emisorDer = lector.tlv(exigir(campos[i + 2], T.SEQUENCE))
    let ski: string | null = null
    const extensiones = campos.slice(i + 6).find((c) => c.clase === CONTEXTO && c.etiqueta === 3)
    if (extensiones) {
        const [lista] = lector.hijos(extensiones)
        for (const ext of lector.hijos(exigir(lista, T.SEQUENCE))) {
            const partes = lector.hijos(ext)
            if (oid(lector.contenido(exigir(partes[0], T.OID))) !== OID_SKI) continue
            const valor = exigir(partes[partes.length - 1], T.OCTET_STRING)
            const interno = lector.leer(valor.inicioContenido, valor.finContenido)
            ski = lector.contenido(exigir(interno, T.OCTET_STRING)).toString('hex')
        }
    }
    return { der: lector.tlv(nodo), serie, emisorDer, ski }
}

function cnDe(nombre: string): string | null {
    const linea = nombre.split('\n').find((l) => l.startsWith('CN='))
    return linea ? linea.slice(3) : null
}

function fechaIso(texto: string): string | null {
    const fecha = new Date(texto)
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

function tiempoAsn1(lector: LectorDer, nodo: Nodo): string | null {
    const texto = lector.contenido(nodo).toString('latin1')
    let m: RegExpExecArray | null
    if (nodo.etiqueta === T.UTC_TIME && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(texto))) {
        const anio = Number(m[1]) < 50 ? 2000 + Number(m[1]) : 1900 + Number(m[1])
        return new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))).toISOString()
    }
    if (nodo.etiqueta === T.GENERALIZED_TIME && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(texto))) {
        return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))).toISOString()
    }
    return null
}

function firmanteDe(cert: Certificado, fechaFirma: string | null): Firmante {
    const x509 = new crypto.X509Certificate(cert.der)
    return {
        nombre: (cnDe(x509.subject) ?? x509.subject.replace(/\n/g, ', ')).slice(0, 200),
        emisor: (cnDe(x509.issuer) ?? x509.issuer.replace(/\n/g, ', ')).slice(0, 200),
        serie: x509.serialNumber.toLowerCase().slice(0, 64),
        validoDesde: fechaIso(x509.validFrom),
        validoHasta: fechaIso(x509.validTo),
        fechaFirma,
    }
}

// ─── Verificación ───────────────────────────────────────────────────────────

function verificarFirma(tipo: 'rsa' | 'ecdsa' | 'pss', hash: string, datos: Buffer, cert: Certificado, firma: Buffer, saltLength: number): boolean {
    const clave = new crypto.X509Certificate(cert.der).publicKey
    try {
        if (tipo === 'pss') {
            return crypto.verify(hash, datos, { key: clave, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength }, firma)
        }
        return crypto.verify(hash, datos, clave, firma)
    } catch {
        return false
    }
}

/** Parámetros RSASSA-PSS: hash y largo de la sal (por defecto SHA-1 y 20). */
function parametrosPss(lector: LectorDer, algoritmo: Nodo[]): { hash: string, sal: number } {
    let hash = 'sha1'
    let sal = 20
    const params = algoritmo[1]
    if (params && params.etiqueta === T.SEQUENCE && params.clase === UNIVERSAL) {
        for (const p of lector.hijos(params)) {
            if (p.clase !== CONTEXTO) continue
            const [interno] = lector.hijos(p)
            if (p.etiqueta === 0) {
                const nombre = HASHES[oid(lector.contenido(exigir(lector.hijos(interno)[0], T.OID)))]
                if (!nombre) throw new ErrorDer('hash de PSS no admitido')
                hash = nombre
            } else if (p.etiqueta === 2) {
                sal = Number.parseInt(enteroNormalizado(lector.contenido(exigir(interno, T.INTEGER))), 16)
            }
        }
    }
    return { hash, sal }
}

/**
 * Verifica el CMS de `/Contents` sobre `contenido` (los bytes del `/ByteRange`). `sha1Envuelto`:
 * subfiltro `adbe.pkcs7.sha1` (el contenido firmado es el SHA-1 de esos bytes, dentro del CMS).
 */
export function verificarCms(cms: Buffer, contenido: Buffer, opciones: { sha1Envuelto?: boolean } = {}): ResultadoCms {
    try {
        const lector = new LectorDer(cms)
        const info = lector.hijos(exigir(lector.leer(0, cms.length), T.SEQUENCE))
        if (oid(lector.contenido(exigir(info[0], T.OID))) !== OID_SIGNED_DATA) return { valida: false, motivo: 'No es un CMS SignedData' }
        const [signedData] = lector.hijos(exigir(info[1], 0, CONTEXTO))
        const partes = lector.hijos(exigir(signedData, T.SEQUENCE))

        const encap = lector.hijos(exigir(partes[2], T.SEQUENCE))
        let firmado = contenido
        if (encap[1]) {
            // Contenido dentro del CMS (`adbe.pkcs7.sha1`): debe ser el SHA-1 de los bytes cubiertos
            const [octetos] = lector.hijos(exigir(encap[1], 0, CONTEXTO))
            const dentro = octetos.construido
                ? Buffer.concat(lector.hijos(octetos).map((n) => lector.contenido(n)))
                : lector.contenido(exigir(octetos, T.OCTET_STRING))
            if (!opciones.sha1Envuelto || !dentro.equals(crypto.createHash('sha1').update(contenido).digest())) {
                return { valida: false, motivo: 'El contenido del CMS no corresponde al documento' }
            }
            firmado = dentro
        } else if (opciones.sha1Envuelto) {
            return { valida: false, motivo: 'Falta el contenido del CMS' }
        }

        const certificados: Certificado[] = []
        let firmantes: Nodo | undefined
        for (const parte of partes.slice(3)) {
            if (parte.clase === CONTEXTO && parte.etiqueta === 0) {
                for (const c of lector.hijos(parte)) if (c.clase === UNIVERSAL && c.etiqueta === T.SEQUENCE) certificados.push(leerCertificado(lector, c))
            } else if (parte.clase === UNIVERSAL && parte.etiqueta === T.SET) {
                firmantes = parte
            }
        }
        const infos = lector.hijos(exigir(firmantes, T.SET))
        if (infos.length !== 1) return { valida: false, motivo: 'El CMS debe tener un solo firmante' }
        const si = lector.hijos(exigir(infos[0], T.SEQUENCE))

        // Identificador del firmante: emisor y serie, o el identificador de la clave
        const sid = si[1]
        let candidatos: Certificado[]
        if (sid.clase === UNIVERSAL && sid.etiqueta === T.SEQUENCE) {
            const [emisor, serie] = lector.hijos(sid)
            const s = enteroNormalizado(lector.contenido(exigir(serie, T.INTEGER)))
            const e = lector.tlv(exigir(emisor, T.SEQUENCE))
            candidatos = certificados.filter((c) => c.serie === s && c.emisorDer.equals(e))
        } else {
            const ski = lector.contenido(exigir(sid, 0, CONTEXTO)).toString('hex')
            candidatos = certificados.filter((c) => c.ski === ski)
        }
        if (!candidatos.length) return { valida: false, motivo: 'El CMS no trae el certificado del firmante' }

        const digestNombre = HASHES[oid(lector.contenido(exigir(lector.hijos(exigir(si[2], T.SEQUENCE))[0], T.OID)))]
        if (!digestNombre) return { valida: false, motivo: 'Algoritmo de resumen no admitido' }

        let i = 3
        let atributos: Nodo | null = null
        if (si[i]?.clase === CONTEXTO && si[i].etiqueta === 0) atributos = si[i++]
        const algoritmo = lector.hijos(exigir(si[i++], T.SEQUENCE))
        const algOid = oid(lector.contenido(exigir(algoritmo[0], T.OID)))
        const firma = lector.contenido(exigir(si[i], T.OCTET_STRING))
        const alg = FIRMAS[algOid]
        if (!alg) return { valida: false, motivo: 'Algoritmo de firma no admitido' }

        const resumen = crypto.createHash(digestNombre).update(firmado).digest()
        let fechaFirma: string | null = null
        let datosFirmados: Buffer
        if (atributos) {
            let resumenFirmado: Buffer | null = null
            for (const atributo of lector.hijos(atributos)) {
                const [tipo, valores] = lector.hijos(exigir(atributo, T.SEQUENCE))
                const nombre = oid(lector.contenido(exigir(tipo, T.OID)))
                const [valor] = lector.hijos(exigir(valores, T.SET))
                if (nombre === OID_MESSAGE_DIGEST) resumenFirmado = lector.contenido(exigir(valor, T.OCTET_STRING))
                else if (nombre === OID_SIGNING_TIME && valor) fechaFirma = tiempoAsn1(lector, valor)
            }
            if (!resumenFirmado || !resumenFirmado.equals(resumen)) {
                return { valida: false, motivo: 'El documento cambió después de firmarse (messageDigest distinto)' }
            }
            // Se firma la codificación DER de los atributos como SET OF (etiqueta 0x31)
            datosFirmados = Buffer.from(lector.tlv(atributos))
            datosFirmados[0] = 0x31
        } else {
            datosFirmados = firmado
        }

        let hash = alg.hash ?? digestNombre
        let sal = 0
        if (alg.tipo === 'pss') ({ hash, sal } = parametrosPss(lector, algoritmo))
        for (const cert of candidatos) {
            if (verificarFirma(alg.tipo, hash, datosFirmados, cert, firma, sal)) return { valida: true, firmante: firmanteDe(cert, fechaFirma) }
        }
        return { valida: false, motivo: 'La firma no verifica con el certificado del firmante' }
    } catch (error) {
        if (error instanceof ErrorDer) return { valida: false, motivo: `CMS mal formado: ${error.message}` }
        return { valida: false, motivo: 'CMS mal formado' }
    }
}

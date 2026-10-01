import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream, degrees, rgb, type PDFObject } from 'pdf-lib'
import { crearCms, nuevoFirmante, type Firmante, type OpcionesCms } from './firma'

/**
 * PDF de prueba para el motor de certificados (spec 015): diseños hechos con pdf-lib y firmas
 * digitales reales (CMS con un certificado autofirmado de `firma.ts`) como actualización incremental,
 * igual que FirmaPerú o ReFirma.
 */

/** A4 horizontal, en pt. */
export const A4_HORIZONTAL: [number, number] = [841.89, 595.28]

export interface OpcionesDiseno {
    paginas?: number
    tamano?: [number, number]
    /** Rotación de la primera página (grados múltiplos de 90). */
    rotacion?: number
}

/** Diseño de certificado de prueba: un marco por página, guardado sin object streams. */
export async function disenoDePrueba(opciones: OpcionesDiseno = {}): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const [ancho, alto] = opciones.tamano ?? A4_HORIZONTAL
    for (let i = 0; i < (opciones.paginas ?? 1); i++) {
        const pagina = doc.addPage([ancho, alto])
        pagina.drawRectangle({ x: 24, y: 24, width: ancho - 48, height: alto - 48, borderColor: rgb(0.1, 0.3, 0.6), borderWidth: 4 })
        if (i === 0 && opciones.rotacion) pagina.setRotation(degrees(opciones.rotacion))
    }
    doc.setTitle('Diseño de prueba')
    return doc.save({ useObjectStreams: false })
}

/** Objetos nuevos o reescritos de una actualización incremental, ya como texto PDF. */
export type ObjetosTexto = [PDFRef, string][]

function ultimoStartxref(bytes: Uint8Array): number {
    const cola = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).toString('latin1')
    const coincidencias = [...cola.matchAll(/startxref\s+(\d+)/g)]
    const ultima = coincidencias[coincidencias.length - 1]
    if (!ultima) throw new Error('PDF sin startxref')
    return Number(ultima[1])
}

/**
 * Agrega al final del PDF los objetos dados, una tabla xref y un trailer con `/Prev` (actualización
 * incremental): los bytes originales quedan intactos al inicio del archivo. Devuelve también el
 * offset de cada objeto agregado.
 */
export function actualizacionIncremental(
    original: Uint8Array,
    doc: PDFDocument,
    objetos: ObjetosTexto,
    extraTrailer: Record<string, PDFObject> = {},
): { bytes: Uint8Array, offsets: Map<number, number> } {
    const partes: string[] = ['\n']
    let posicion = original.byteLength + 1
    const offsets = new Map<number, number>()
    const entradas: [PDFRef, number][] = []
    for (const [ref, cuerpo] of objetos) {
        const texto = `${ref.objectNumber} ${ref.generationNumber} obj\n${cuerpo}\nendobj\n`
        offsets.set(ref.objectNumber, posicion)
        entradas.push([ref, posicion])
        partes.push(texto)
        posicion += Buffer.byteLength(texto, 'latin1')
    }
    const inicioXref = posicion
    let xref = 'xref\n0 1\n0000000000 65535 f \n'
    for (const [ref, offset] of entradas) {
        xref += `${ref.objectNumber} 1\n${String(offset).padStart(10, '0')} ${String(ref.generationNumber).padStart(5, '0')} n \n`
    }
    const info = doc.context.trailerInfo
    const mayor = Math.max(doc.context.largestObjectNumber, ...objetos.map(([ref]) => ref.objectNumber))
    const trailer = doc.context.obj({
        Size: mayor + 1,
        Root: info.Root,
        ...(info.Info ? { Info: info.Info } : {}),
        ...(info.ID ? { ID: info.ID } : {}),
        Prev: ultimoStartxref(original),
        ...extraTrailer,
    })
    partes.push(xref, `trailer\n${trailer.toString()}\nstartxref\n${inicioXref}\n%%EOF\n`)
    return { bytes: new Uint8Array(Buffer.concat([Buffer.from(original), Buffer.from(partes.join(''), 'latin1')])), offsets }
}

/** Objetos crudos (número → texto PDF) agregados como actualización incremental, para armar ataques. */
export async function agregarObjetos(bytes: Uint8Array, objetos: [number, string][], extraTrailer: Record<string, PDFObject> = {}): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    return actualizacionIncremental(bytes, doc, objetos.map(([n, texto]) => [PDFRef.of(n), texto]), extraTrailer).bytes
}

export type TipoCampo = 'firma' | 'sello' | 'vacio'

export interface OpcionesCampo {
    firmante?: Firmante
    /** Recuadro de firma con área (por defecto, invisible: `/Rect [0 0 0 0]`). */
    visible?: boolean
    /** `/Contents` en ceros: un diccionario de firma sin firma real. */
    falsa?: boolean
    cms?: OpcionesCms
    /** Página del recuadro (0 = primera). */
    pagina?: number
}

const HUECO_HEX = 16384
const RANGO = '[0 ########## ########## ##########]'

let firmantePorDefecto: Firmante | null = null
/** Firmante de prueba compartido (crear claves es lo más lento). */
export function firmanteDePrueba(): Firmante {
    firmantePorDefecto ??= nuevoFirmante('Autoridad de Prueba UNDC')
    return firmantePorDefecto
}

/**
 * Agrega un campo de firma como lo hacen FirmaPerú o ReFirma: una actualización incremental con el
 * diccionario de firma, su widget (en el AcroForm y en `/Annots` de la página) y el AcroForm o el
 * catálogo reescritos. `firma` lleva un CMS real sobre el `/ByteRange`; `sello`, un sello de tiempo
 * del documento (no se valida ni cuenta); `vacio`, un campo sin `/V`.
 */
export async function agregarCampoFirma(bytes: Uint8Array, tipo: TipoCampo = 'firma', opciones: OpcionesCampo = {}): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const ctx = doc.context
    const pagina = doc.getPages()[opciones.pagina ?? 0]
    const catalogo = doc.catalog
    const refFormularioAnterior = catalogo.get(PDFName.of('AcroForm'))
    const formulario = catalogo.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    const anteriores = formulario?.lookupMaybe(PDFName.of('Fields'), PDFArray)?.asArray() ?? []
    let numero = ctx.largestObjectNumber + 1
    const refFirma = PDFRef.of(numero++)
    const refCampo = PDFRef.of(numero++)
    const objetos: ObjetosTexto = []

    if (tipo !== 'vacio') {
        const cabecera = tipo === 'firma'
            ? '/Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached'
            : '/Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161'
        objetos.push([refFirma, `<< ${cabecera} /ByteRange ${RANGO} /Contents <${'0'.repeat(HUECO_HEX)}> /M (D:20261101120000-05'00') >>`])
    }
    const campo = ctx.obj({
        FT: 'Sig', T: PDFString.of(`Firma${anteriores.length + 1}`), Type: 'Annot', Subtype: 'Widget',
        Rect: opciones.visible ? [560, 40, 800, 110] : [0, 0, 0, 0], F: 132, P: pagina.ref,
        ...(tipo !== 'vacio' ? { V: refFirma } : {}),
    })
    objetos.push([refCampo, campo.toString()])

    const nuevoFormulario = ctx.obj({ Fields: [...anteriores, refCampo], SigFlags: 3 })
    if (refFormularioAnterior instanceof PDFRef) {
        objetos.push([refFormularioAnterior, nuevoFormulario.toString()])
    } else {
        const refFormulario = PDFRef.of(numero++)
        objetos.push([refFormulario, nuevoFormulario.toString()])
        catalogo.set(PDFName.of('AcroForm'), refFormulario)
        objetos.push([ctx.trailerInfo.Root as PDFRef, catalogo.toString()])
    }
    const anotaciones = pagina.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? []
    pagina.node.set(PDFName.of('Annots'), ctx.obj([...anotaciones, refCampo]))
    objetos.push([pagina.ref, pagina.node.toString()])

    const { bytes: salida, offsets } = actualizacionIncremental(bytes, doc, objetos)
    if (tipo === 'vacio') return salida

    // /ByteRange: todo menos el hueco de /Contents; luego el CMS sobre esos bytes
    const buffer = Buffer.from(salida)
    const inicioObjeto = offsets.get(refFirma.objectNumber) as number
    const posRango = buffer.indexOf(RANGO, inicioObjeto, 'latin1')
    const b = buffer.indexOf('/Contents <', inicioObjeto, 'latin1') + '/Contents '.length
    const c = b + HUECO_HEX + 2
    const rango = `[0 ${String(b).padEnd(10)} ${String(c).padEnd(10)} ${String(buffer.length - c).padEnd(10)}]`
    buffer.write(rango, posRango, 'latin1')
    if (tipo === 'firma' && !opciones.falsa) {
        const cubierto = Buffer.concat([buffer.subarray(0, b), buffer.subarray(c)])
        const cms = crearCms(cubierto, opciones.firmante ?? firmanteDePrueba(), opciones.cms).toString('hex')
        if (cms.length > HUECO_HEX) throw new Error('El CMS no entra en el hueco de /Contents')
        buffer.write(cms, b + 1, 'latin1')
    }
    return new Uint8Array(buffer)
}

export interface OpcionesFirma extends OpcionesCampo {
    /** Firmas a agregar, una tras otra (por defecto 1). */
    firmas?: number
    /** Firmantes de cada firma (si no, el de prueba). */
    firmantes?: Firmante[]
    /** Agrega además un sello de tiempo del documento (`/DocTimeStamp`), que no cuenta como firma. */
    sello?: boolean
    /** Campo de firma vacío (sin `/V`), que tampoco cuenta. */
    campoVacio?: boolean
}

/** Firma el PDF (una actualización incremental por firma, como un firmante tras otro). */
export async function firmarPdf(bytes: Uint8Array, opciones: OpcionesFirma = {}): Promise<Uint8Array> {
    let actual = bytes
    for (let i = 0; i < (opciones.firmas ?? 1); i++) {
        actual = await agregarCampoFirma(actual, 'firma', { ...opciones, firmante: opciones.firmantes?.[i] ?? opciones.firmante })
    }
    if (opciones.sello) actual = await agregarCampoFirma(actual, 'sello')
    if (opciones.campoVacio) actual = await agregarCampoFirma(actual, 'vacio')
    return actual
}

/** Simula un PDF cifrado: actualización incremental con un diccionario `/Encrypt` en el trailer. */
export async function cifradoSimulado(bytes: Uint8Array): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const cifrado = doc.context.obj({
        Filter: 'Standard', V: 1, R: 2, P: -44,
        O: PDFHexString.of('11'.repeat(32)), U: PDFHexString.of('22'.repeat(32)),
    })
    const ref = doc.context.register(cifrado)
    return actualizacionIncremental(bytes, doc, [[ref, cifrado.toString()]], { Encrypt: ref }).bytes
}

/** Reescribe el PDF completo (como una herramienta de firma no incremental): cambian los bytes, se conservan los metadatos. */
export async function reescribir(bytes: Uint8Array): Promise<Uint8Array> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    return doc.save({ useObjectStreams: true })
}

/** Nombres de las fuentes embebidas de un PDF, sin la marca del subconjunto (`ABCDEF+` o el `-<n>` que agrega pdf-lib). */
export async function fuentesDelPdf(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const nombres = new Set<string>()
    for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
        if (!(objeto instanceof PDFDict) || objeto.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue
        const nombre = objeto.get(PDFName.of('FontName'))
        const embebida = objeto.has(PDFName.of('FontFile2')) || objeto.has(PDFName.of('FontFile3')) || objeto.has(PDFName.of('FontFile'))
        if (nombre instanceof PDFName && embebida) nombres.add(nombre.decodeText().replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''))
    }
    return [...nombres].sort()
}

/** Programas de fuente TrueType embebidos (`/FontFile2`, ya descomprimidos), para revisar sus glifos. */
export async function programasDeFuente(bytes: Uint8Array): Promise<{ nombre: string, datos: Uint8Array }[]> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const programas: { nombre: string, datos: Uint8Array }[] = []
    for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
        if (!(objeto instanceof PDFDict) || objeto.get(PDFName.of('Type')) !== PDFName.of('FontDescriptor')) continue
        const flujo = objeto.lookup(PDFName.of('FontFile2'))
        const nombre = objeto.get(PDFName.of('FontName'))
        if (flujo instanceof PDFRawStream && nombre instanceof PDFName) programas.push({ nombre: nombre.decodeText(), datos: decodePDFRawStream(flujo).decode() })
    }
    return programas
}

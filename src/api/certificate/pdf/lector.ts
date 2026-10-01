import { AsyncLocalStorage } from 'async_hooks'
import {
    ParseSpeeds,
    PDFContext,
    PDFDict,
    PDFDocument,
    PDFObjectStreamParser,
    PDFParser,
    PDFRef,
    PDFXRefStreamParser,
    type PDFObject,
} from 'pdf-lib'
import DecodeStream from 'pdf-lib/cjs/core/streams/DecodeStream'

/**
 * Lectura acotada de PDF con pdf-lib (spec 015) para lo que llega de afuera: diseños de plantillas y
 * firmados.
 *
 * - **Bomba de descompresión**: pdf-lib decodifica enteros los `/ObjStm` y `/XRef` al cargar (y los
 *   flujos que se lean después) sin tope de salida. Aquí ningún flujo decodificado por pdf-lib pasa
 *   de `MAX_BYTES_FLUJO` (en todo el proceso) y, dentro de una lectura, la suma no pasa de
 *   `MAX_BYTES_DECODIFICADOS`: si no, la lectura falla (`PdfIlegible`).
 * - **Registro de la lectura** (para revisar firmados): cada objeto que pdf-lib asigna, con el offset
 *   del objeto de nivel superior que lo contiene (si vino de un `/ObjStm`, el de ese flujo); los
 *   offsets de todos los objetos de nivel superior y su número; y las entradas de cada tabla o flujo
 *   xref con su offset. Con eso `firmas.ts` comprueba que lo que pdf-lib ve sea lo que ve un visor.
 *
 * Los ganchos se instalan una vez sobre los prototipos de pdf-lib (versión fija en package-lock) y
 * solo actúan dentro de `leerPdf` (AsyncLocalStorage): el resto del proceso usa pdf-lib igual que
 * siempre, salvo el tope por flujo.
 */

/** Tope de un flujo decodificado (32 MiB). */
export const MAX_BYTES_FLUJO = 32 * 1024 * 1024
/** Tope de bytes decodificados en una lectura (64 MiB). */
export const MAX_BYTES_DECODIFICADOS = 64 * 1024 * 1024
/** Objetos que se registran en una lectura; más es un PDF que no es un certificado. */
export const MAX_OBJETOS = 200_000

export class PdfIlegible extends Error {}

export interface ObjetoLeido {
    ref: PDFRef
    objeto: PDFObject
    /** Offset del objeto de nivel superior (o del `/ObjStm` que lo trajo). */
    offset: number
    enObjStm: boolean
}

export interface EntradaXref {
    /** Offset de la tabla `xref` o del flujo `/XRef`. */
    seccion: number
    numero: number
    /** Tipo 1: offset del objeto; tipo 2: número del `/ObjStm`. */
    offset: number
    borrada: boolean
    enObjStm: boolean
}

export interface LecturaPdf {
    doc: PDFDocument
    bytes: Uint8Array
    /** Objetos en el orden en que pdf-lib los asignó (todas las versiones). */
    objetos: ObjetoLeido[]
    /** Offset → número de objeto de cada objeto de nivel superior que pdf-lib leyó. */
    cabeceras: Map<number, number>
    xref: EntradaXref[]
    /** Objetos que pdf-lib no pudo leer (`PDFInvalidObject`). */
    invalidos: number
}

interface Registro {
    restante: number
    /** Se superó un tope de descompresión (pdf-lib lo trata como objeto inválido y sigue). */
    excedido: boolean
    actual: number
    enObjStm: number
    objetos: ObjetoLeido[]
    cabeceras: Map<number, number>
    xref: EntradaXref[]
    invalidos: number
}

const almacen = new AsyncLocalStorage<Registro>()

function nuevoRegistro(): Registro {
    return { restante: MAX_BYTES_DECODIFICADOS, excedido: false, actual: 0, enObjStm: 0, objetos: [], cabeceras: new Map(), xref: [], invalidos: 0 }
}

interface ConBytes { bytes: { offset(): number } }
type Metodo<R> = (this: unknown, ...args: unknown[]) => R

function demasiado(registro?: Registro): never {
    if (registro) registro.excedido = true
    throw new PdfIlegible('El PDF tiene flujos comprimidos demasiado grandes.')
}

let instalado = false

function instalarGanchos(): void {
    if (instalado) return
    instalado = true

    // Tope de los flujos decodificados (en todo el proceso) y del total de una lectura
    const decodificador = DecodeStream.prototype as unknown as { ensureBuffer: (this: { buffer: Uint8Array }, requested: number) => Uint8Array }
    const ensureBuffer = decodificador.ensureBuffer
    decodificador.ensureBuffer = function (requested: number) {
        const registro = almacen.getStore()
        if (requested > MAX_BYTES_FLUJO) demasiado(registro)
        const antes = this.buffer.byteLength
        const buffer = ensureBuffer.call(this, requested)
        // Se descuenta lo que de verdad se reservó (pdf-lib duplica el búfer)
        if (registro && buffer.byteLength > antes) {
            registro.restante -= buffer.byteLength - antes
            if (registro.restante < 0) demasiado(registro)
        }
        return buffer
    }

    const parser = PDFParser.prototype as unknown as Record<string, Metodo<unknown>>
    const parseIndirectObject = parser.parseIndirectObject as Metodo<Promise<PDFRef>>
    parser.parseIndirectObject = async function (this: unknown, ...args: unknown[]) {
        const registro = almacen.getStore()
        if (!registro) return parseIndirectObject.apply(this, args)
        const offset = (this as ConBytes).bytes.offset()
        registro.actual = offset
        const ref = await parseIndirectObject.apply(this, args)
        registro.cabeceras.set(offset, ref.objectNumber)
        return ref
    }
    const tryToParseInvalidIndirectObject = parser.tryToParseInvalidIndirectObject as Metodo<PDFRef>
    parser.tryToParseInvalidIndirectObject = function (this: unknown, ...args: unknown[]) {
        const registro = almacen.getStore()
        if (!registro) return tryToParseInvalidIndirectObject.apply(this, args)
        const offset = (this as ConBytes).bytes.offset()
        registro.actual = offset
        registro.invalidos++
        const ref = tryToParseInvalidIndirectObject.apply(this, args)
        registro.cabeceras.set(offset, ref.objectNumber)
        return ref
    }
    const maybeParseCrossRefSection = parser.maybeParseCrossRefSection as Metodo<unknown>
    parser.maybeParseCrossRefSection = function (this: unknown, ...args: unknown[]) {
        const registro = almacen.getStore()
        const seccion = (this as ConBytes).bytes.offset()
        const xref = maybeParseCrossRefSection.apply(this, args) as { subsections?: { ref: PDFRef, offset: number, deleted: boolean }[][] } | undefined
        if (registro && xref?.subsections) {
            for (const entrada of xref.subsections.flat()) {
                registro.xref.push({ seccion, numero: entrada.ref.objectNumber, offset: entrada.offset, borrada: entrada.deleted, enObjStm: false })
            }
        }
        return xref
    }

    const flujoXref = PDFXRefStreamParser.prototype as unknown as { parseIntoContext: Metodo<{ ref: PDFRef, offset: number, deleted: boolean, inObjectStream: boolean }[]> }
    const parseXref = flujoXref.parseIntoContext
    flujoXref.parseIntoContext = function (...args: unknown[]) {
        const entradas = parseXref.apply(this, args)
        const registro = almacen.getStore()
        if (registro) {
            for (const e of entradas) {
                registro.xref.push({ seccion: registro.actual, numero: e.ref.objectNumber, offset: e.offset, borrada: e.deleted, enObjStm: e.inObjectStream })
            }
        }
        return entradas
    }

    const flujoObjetos = PDFObjectStreamParser.prototype as unknown as { parseIntoContext: Metodo<Promise<void>> }
    const parseObjetos = flujoObjetos.parseIntoContext
    flujoObjetos.parseIntoContext = async function (...args: unknown[]) {
        const registro = almacen.getStore()
        if (!registro) return parseObjetos.apply(this, args)
        registro.enObjStm++
        try {
            return await parseObjetos.apply(this, args)
        } finally {
            registro.enObjStm--
        }
    }

    const contexto = PDFContext.prototype as unknown as { assign: (this: PDFContext, ref: PDFRef, objeto: PDFObject) => void }
    const assign = contexto.assign
    contexto.assign = function (ref: PDFRef, objeto: PDFObject) {
        const registro = almacen.getStore()
        if (registro) {
            if (registro.objetos.length >= MAX_OBJETOS) demasiado(registro)
            registro.objetos.push({ ref, objeto, offset: registro.actual, enObjStm: registro.enObjStm > 0 })
        }
        assign.call(this, ref, objeto)
    }
}

instalarGanchos()

/**
 * Carga un PDF de afuera con los topes de descompresión y el registro de la lectura. Lanza
 * `PdfIlegible` si pdf-lib no lo puede leer, supera los topes o está cifrado (salvo `permitirCifrado`).
 */
export async function leerPdf(bytes: Uint8Array, opciones: { permitirCifrado?: boolean } = {}): Promise<LecturaPdf> {
    const registro = nuevoRegistro()
    let doc: PDFDocument
    try {
        doc = await almacen.run(registro, () => PDFDocument.load(bytes, {
            ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: ParseSpeeds.Medium,
        }))
    } catch (error) {
        if (error instanceof PdfIlegible) throw error
        throw new PdfIlegible('El archivo no es un PDF válido.')
    }
    // pdf-lib convierte en «objeto inválido» lo que no puede leer, también lo que superó un tope
    if (registro.excedido) throw new PdfIlegible('El PDF tiene flujos comprimidos o una cantidad de objetos que exceden lo permitido.')
    if (doc.isEncrypted && !opciones.permitirCifrado) throw new PdfIlegible('El PDF está cifrado.')
    // pdf-lib abre casi cualquier cosa: sin catálogo ni páginas no es un PDF útil
    let paginas = 0
    try {
        paginas = doc.catalog instanceof PDFDict ? doc.getPageCount() : 0
    } catch {
        paginas = 0
    }
    if (paginas < 1) throw new PdfIlegible('El archivo no es un PDF válido.')
    return { doc, bytes, objetos: registro.objetos, cabeceras: registro.cabeceras, xref: registro.xref, invalidos: registro.invalidos }
}

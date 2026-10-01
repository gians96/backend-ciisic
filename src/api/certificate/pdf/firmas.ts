import crypto from 'crypto'
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, type PDFDocument, type PDFObject } from 'pdf-lib'
import type { CoincidenciaFirmado } from '@prisma/client'
import { subjectDeCertificado } from './tipos'
import { verificarCms, type Firmante } from './cms'
import { leerPdf, PdfIlegible, type LecturaPdf, type ObjetoLeido } from './lector'

/**
 * Firmados de afuera (FirmaPerú, ReFirma…): firmas, coincidencia con lo generado y cambios (spec 015).
 *
 * **Firmas**: solo cuentan los campos `/FT /Sig` del AcroForm cuyo `/V` es una firma que verifica
 * (cms.ts): `/ByteRange` desde 0 con el hueco exactamente en su `/Contents`, `messageDigest` igual al
 * hash de los bytes cubiertos y firma válida con el certificado que trae el CMS. Los sellos de tiempo
 * del documento (`/DocTimeStamp`) no cuentan. Una firma que no verifica invalida el archivo. No se
 * encadena el certificado a una raíz de confianza (pendiente): el firmante se registra y se muestra.
 *
 * **Coincidencia**: PREFIJO si el archivo empieza con los bytes del generado vigente (firma
 * incremental). METADATOS si la herramienta reescribió el archivo pero su `Subject` es
 * `ciisic:<código>:<generación vigente>`: como no hay forma de comprobar que el contenido sea el
 * generado, solo se acepta forzado (`certificados.gestionar`, con motivo). Si no, `null`.
 *
 * **Cambios después del generado** (PREFIJO): lo agregado al final solo puede traer firmas. Se
 * rechaza (SIGNED_MODIFIED) si:
 * - redefine un objeto del generado que no sea el catálogo, una página, el `/Info`, el `/Metadata`, el
 *   AcroForm o el árbol de estructura (sin flujos); o define dos veces un objeto nuevo (salvo
 *   catálogo, AcroForm, DSS, Info y XMP);
 * - alguna versión del catálogo cambia algo más que `/AcroForm`, `/DSS`, `/Perms`, `/Metadata`,
 *   `/Extensions` o `/Version`; o alguna versión de una página, algo más que `/Annots` (y claves sin
 *   efecto visual); o el AcroForm trae campos que no son de firma o XFA;
 * - una anotación nueva no es el widget de un campo de firma, o es visible y ninguna firma válida la
 *   cubre (un widget agregado después de la última firma podría tapar el contenido);
 * - lo que pdf-lib lee no es lo que leería un visor: cabeceras `N G obj` que pdf-lib no leyó (un
 *   objeto escondido dentro de un flujo), objetos ilegibles, entradas xref que apuntan a otro lugar o
 *   que borran objetos.
 * En todo el archivo se rechaza el contenido activo (PDF_ACTIVE_CONTENT): JavaScript, acciones de
 * lanzar/enviar/importar, archivos adjuntos, multimedia, XFA y acciones adicionales (`/AA`).
 */
export type CoincidenciaVerificada = Exclude<CoincidenciaFirmado, 'FORZADO'>

export type CodigoProblema = 'INVALID_PDF' | 'PDF_ACTIVE_CONTENT' | 'SIGNATURE_INVALID' | 'SIGNED_MODIFIED'

export interface Problema {
    codigo: CodigoProblema
    mensaje: string
}

export type { Firmante }

export function sha256(bytes: Uint8Array): string {
    return crypto.createHash('sha256').update(bytes).digest('hex')
}

const nombre = (texto: string) => PDFName.of(texto)
const N = {
    AcroForm: nombre('AcroForm'), Annots: nombre('Annots'), ByteRange: nombre('ByteRange'), Contents: nombre('Contents'),
    DocTimeStamp: nombre('DocTimeStamp'), F: nombre('F'), Fields: nombre('Fields'), FT: nombre('FT'), Kids: nombre('Kids'),
    M: nombre('M'), Metadata: nombre('Metadata'), Parent: nombre('Parent'), Rect: nombre('Rect'), S: nombre('S'),
    Sig: nombre('Sig'), SubFilter: nombre('SubFilter'), Subtype: nombre('Subtype'), Type: nombre('Type'), V: nombre('V'),
    Widget: nombre('Widget'), XFA: nombre('XFA'), Catalog: nombre('Catalog'), Page: nombre('Page'), Pages: nombre('Pages'),
    RFC3161: nombre('ETSI.RFC3161'), Sha1: nombre('adbe.pkcs7.sha1'), Detached: nombre('adbe.pkcs7.detached'),
    CadesDetached: nombre('ETSI.CAdES.detached'), DSS: nombre('DSS'), EmbeddedFile: nombre('EmbeddedFile'),
}

/** Límites de lo que se revisa en un firmado (un certificado tiene pocas firmas y campos). */
const MAX_FIRMAS = 10
const MAX_CAMPOS = 200
const MAX_PROFUNDIDAD = 32

// ─── Contenido activo ───────────────────────────────────────────────────────

const CLAVES_ACTIVAS = new Set(['JS', 'JavaScript', 'AA', 'EmbeddedFiles', 'EF', 'RichMediaContent', 'RichMediaSettings', 'XFA', 'Launch'])
const ACCIONES_ACTIVAS = new Set([
    'JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'ResetForm', 'GoToE', 'GoToR', 'Rendition', 'RichMediaExecute', 'Movie',
    'Sound', 'Hide', 'SetOCGState',
])
const ANOTACIONES_ACTIVAS = new Set(['RichMedia', 'Screen', 'Movie', 'Sound', 'FileAttachment', '3D'])

function activoEn(objeto: PDFObject, profundidad = 0): string | null {
    if (profundidad > MAX_PROFUNDIDAD) return 'estructura demasiado anidada'
    if (objeto instanceof PDFRawStream) return activoEn(objeto.dict, profundidad + 1)
    if (objeto instanceof PDFArray) {
        for (const elemento of objeto.asArray()) {
            const hallado = activoEn(elemento, profundidad + 1)
            if (hallado) return hallado
        }
        return null
    }
    if (!(objeto instanceof PDFDict)) return null
    for (const [clave, valor] of objeto.entries()) {
        const k = clave.decodeText()
        if (CLAVES_ACTIVAS.has(k)) return `/${k}`
        if (valor instanceof PDFName) {
            const v = valor.decodeText()
            if (k === 'S' && ACCIONES_ACTIVAS.has(v)) return `acción /${v}`
            if (k === 'Subtype' && ANOTACIONES_ACTIVAS.has(v)) return `anotación /${v}`
            if (k === 'Type' && valor === N.EmbeddedFile) return 'archivo adjunto'
        }
        const hallado = activoEn(valor, profundidad + 1)
        if (hallado) return hallado
    }
    return null
}

/** Primer contenido activo de la lectura (en cualquier versión de cualquier objeto), o `null`. */
export function contenidoActivo(lectura: Pick<LecturaPdf, 'objetos'>): string | null {
    for (const { objeto } of lectura.objetos) {
        const hallado = activoEn(objeto)
        if (hallado) return hallado
    }
    return null
}

// ─── Firmas ─────────────────────────────────────────────────────────────────

interface FirmaRevisada {
    valida: boolean
    motivo: string | null
    /** Inicio del hueco de `/Contents` y fin de lo cubierto (`/ByteRange`). */
    inicioHueco: number
    fin: number
    firmante: Firmante | null
}

function busca(dict: PDFDict, clave: PDFName): PDFObject | undefined {
    try {
        return dict.lookup(clave)
    } catch {
        return undefined
    }
}

/** `D:AAAAMMDDHHmmSS±HH'mm'` → ISO (o `null`). */
function fechaPdf(valor: PDFObject | undefined): string | null {
    if (!(valor instanceof PDFString) && !(valor instanceof PDFHexString)) return null
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(valor.decodeText())
    if (!m) return null
    const signo = m[7] === '-' ? -1 : 1
    const desfase = m[7] && m[7].toUpperCase() !== 'Z' ? signo * (Number(m[8] ?? 0) * 60 + Number(m[9] ?? 0)) : 0
    const utc = Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)) - desfase * 60_000
    return Number.isNaN(utc) ? null : new Date(utc).toISOString()
}

const esHex = (byte: number) => (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66)

function revisarFirma(firma: PDFDict, bytes: Uint8Array): FirmaRevisada {
    const invalida = (motivo: string, inicioHueco = 0, fin = 0): FirmaRevisada => ({ valida: false, motivo, inicioHueco, fin, firmante: null })
    const rango = busca(firma, N.ByteRange)
    if (!(rango instanceof PDFArray) || rango.size() !== 4) return invalida('La firma no tiene un /ByteRange válido')
    const valores = rango.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN))
    if (!valores.every((v) => Number.isSafeInteger(v) && v >= 0)) return invalida('La firma no tiene un /ByteRange válido')
    const [a, b, c, d] = valores
    if (a !== 0 || b < 1 || c <= b + 1 || c + d > bytes.byteLength) return invalida('El /ByteRange de la firma no cubre el documento', b, c + d)
    if (bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) return invalida('El hueco del /ByteRange no es el /Contents de la firma', b, c + d)
    for (let i = b + 1; i < c - 1; i++) if (!esHex(bytes[i])) return invalida('El hueco del /ByteRange no es el /Contents de la firma', b, c + d)
    const hueco = Buffer.from(bytes.buffer, bytes.byteOffset + b + 1, c - b - 2).toString('latin1').toLowerCase()
    const contents = busca(firma, N.Contents)
    if (!(contents instanceof PDFHexString) || contents.asString().replace(/\s+/g, '').toLowerCase() !== hueco) {
        return invalida('El hueco del /ByteRange no es el /Contents de la firma', b, c + d)
    }
    const subfiltro = busca(firma, N.SubFilter)
    if (subfiltro !== N.Detached && subfiltro !== N.CadesDetached && subfiltro !== N.Sha1) {
        return invalida(`Formato de firma no admitido (${subfiltro instanceof PDFName ? subfiltro.decodeText() : 'sin /SubFilter'})`, b, c + d)
    }
    const cubierto = Buffer.concat([
        Buffer.from(bytes.buffer, bytes.byteOffset, b),
        Buffer.from(bytes.buffer, bytes.byteOffset + c, d),
    ])
    const resultado = verificarCms(Buffer.from(hueco.length % 2 ? `${hueco}0` : hueco, 'hex'), cubierto, { sha1Envuelto: subfiltro === N.Sha1 })
    if (!resultado.valida) return invalida(resultado.motivo, b, c + d)
    const firmante = { ...resultado.firmante, fechaFirma: resultado.firmante.fechaFirma ?? fechaPdf(busca(firma, N.M)) }
    return { valida: true, motivo: null, inicioHueco: b, fin: c + d, firmante }
}

/** Valores (`/V`) de los campos de firma del AcroForm vigente, sin sellos de tiempo, una vez cada uno. */
function firmasDelFormulario(doc: PDFDocument): PDFDict[] | null {
    const formulario = busca(doc.catalog, N.AcroForm)
    if (!(formulario instanceof PDFDict)) return []
    const campos = busca(formulario, N.Fields)
    if (!(campos instanceof PDFArray)) return []
    const firmas = new Set<PDFDict>()
    const vistos = new Set<PDFDict>()
    let excedido = false
    const recorrer = (lista: PDFArray, tipo: PDFObject | undefined, profundidad: number) => {
        for (let i = 0; i < lista.size(); i++) {
            const campo = lista.lookup(i)
            if (!(campo instanceof PDFDict) || vistos.has(campo)) continue
            if (vistos.size >= MAX_CAMPOS || profundidad > 10) {
                excedido = true
                return
            }
            vistos.add(campo)
            const ft = busca(campo, N.FT) ?? tipo
            const valor = busca(campo, N.V)
            if (ft === N.Sig && valor instanceof PDFDict) {
                const esSello = busca(valor, N.Type) === N.DocTimeStamp || busca(valor, N.SubFilter) === N.RFC3161
                if (!esSello) firmas.add(valor)
            }
            const hijos = busca(campo, N.Kids)
            if (hijos instanceof PDFArray) recorrer(hijos, ft, profundidad + 1)
        }
    }
    recorrer(campos, undefined, 0)
    return excedido ? null : [...firmas]
}

// ─── Cambios después del generado ───────────────────────────────────────────

const PERMITIDAS_CATALOGO = new Set(['AcroForm', 'DSS', 'Perms', 'Metadata', 'Extensions', 'Version'])
const PERMITIDAS_PAGINA = new Set(['Annots', 'Tabs', 'StructParents', 'Metadata', 'PieceInfo', 'LastModified'])

class Modificado extends Error {}

const texto = (objeto: PDFObject | undefined) => (objeto === undefined ? '' : objeto.toString())

function mismasClaves(version: PDFDict, original: PDFDict, permitidas: Set<string>, que: string): void {
    const claves = new Set([...version.keys(), ...original.keys()].map((k) => k.decodeText()))
    for (const clave of claves) {
        if (permitidas.has(clave)) continue
        if (texto(version.get(nombre(clave))) !== texto(original.get(nombre(clave)))) {
            throw new Modificado(`${que} cambia /${clave} después de generado.`)
        }
    }
}

function esTipo(objeto: PDFObject, tipo: PDFName): objeto is PDFDict {
    return objeto instanceof PDFDict && objeto.get(N.Type) === tipo
}

function esAcroForm(objeto: PDFObject): objeto is PDFDict {
    return objeto instanceof PDFDict && objeto.has(N.Fields) && !objeto.has(N.Type)
}

function esDss(objeto: PDFObject): boolean {
    return objeto instanceof PDFDict && (objeto.get(N.Type) === N.DSS || ['Certs', 'OCSPs', 'CRLs', 'VRI'].some((k) => objeto.has(nombre(k))))
}

function esInfo(objeto: PDFObject): boolean {
    return objeto instanceof PDFDict && !objeto.has(N.Type) && objeto.values().every((v) => v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFName)
}

function esMetadatos(objeto: PDFObject): boolean {
    return objeto instanceof PDFRawStream && objeto.dict.get(N.Type) === N.Metadata
}

/** Rectángulo sin área o anotación oculta: no se ve. */
function invisible(anotacion: PDFDict): boolean {
    const f = busca(anotacion, N.F)
    if (f instanceof PDFNumber && (f.asNumber() & (2 | 32))) return true
    const rect = busca(anotacion, N.Rect)
    if (!(rect instanceof PDFArray) || rect.size() !== 4) return false
    const [x1, y1, x2, y2] = rect.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN))
    return Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1
}

/** El campo de un widget (él mismo o un ancestro) es de firma. */
function esWidgetDeFirma(anotacion: PDFDict): boolean {
    if (busca(anotacion, N.Subtype) !== N.Widget) return false
    let nodo: PDFDict | undefined = anotacion
    for (let i = 0; nodo && i < 10; i++) {
        const ft = busca(nodo, N.FT)
        if (ft) return ft === N.Sig
        const padre = busca(nodo, N.Parent)
        nodo = padre instanceof PDFDict ? padre : undefined
    }
    return false
}

/**
 * Objetos del árbol de estructura (PDF etiquetado) del generado: Acrobat agrega ahí el campo de firma y
 * reescribe esos diccionarios al firmar. No afectan lo que se ve; no se siguen páginas, anotaciones,
 * XObjects ni flujos.
 */
function objetosDeEstructura(doc: PDFDocument): Set<number> {
    const numeros = new Set<number>()
    const raiz = doc.catalog.get(nombre('StructTreeRoot'))
    const pendientes: PDFObject[] = raiz ? [raiz] : []
    const NO_SEGUIR = new Set(['Pg', 'Obj', 'Stm', 'StmOwn', 'P'])
    while (pendientes.length && numeros.size < 50_000) {
        const actual = pendientes.pop() as PDFObject
        let objeto: PDFObject | undefined = actual
        if (actual instanceof PDFRef) {
            if (numeros.has(actual.objectNumber)) continue
            objeto = doc.context.lookup(actual)
            if (!(objeto instanceof PDFDict) && !(objeto instanceof PDFArray)) continue
            const tipo = objeto instanceof PDFDict ? objeto.get(N.Type) : undefined
            if (tipo === N.Page || tipo === N.Pages || tipo === nombre('Annot') || tipo === nombre('XObject')) continue
            numeros.add(actual.objectNumber)
        }
        if (objeto instanceof PDFArray) pendientes.push(...objeto.asArray())
        else if (objeto instanceof PDFDict) {
            for (const [clave, valor] of objeto.entries()) if (!NO_SEGUIR.has(clave.decodeText())) pendientes.push(valor)
        }
    }
    return numeros
}

interface Revision {
    lectura: LecturaPdf
    generado: LecturaPdf
    inicio: number
    /** Fin de lo que cubre cada firma válida (un widget visible debe quedar cubierto por alguna). */
    finesFirmas: number[]
}

const CABECERA = /(?<![0-9])(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+obj(?![A-Za-z0-9])/g

/** Lo que pdf-lib leyó en lo agregado es lo que leería un visor (cabeceras y xref). */
function revisarLectura(r: Revision): void {
    const { lectura, inicio } = r
    if (lectura.invalidos) throw new Modificado('Lo agregado después del generado tiene objetos ilegibles.')
    const cola = Buffer.from(lectura.bytes.buffer, lectura.bytes.byteOffset + inicio, lectura.bytes.byteLength - inicio).toString('latin1')
    const textuales = new Map<number, number>()
    for (const m of cola.matchAll(CABECERA)) textuales.set(inicio + (m.index ?? 0), Number(m[1]))
    const leidas = [...lectura.cabeceras].filter(([offset]) => offset >= inicio)
    if (leidas.length !== textuales.size || leidas.some(([offset, numero]) => textuales.get(offset) !== numero)) {
        throw new Modificado('Lo agregado después del generado tiene objetos que no se leen de forma consistente.')
    }
    const numerosEnObjStm = new Set(lectura.objetos.filter((o) => o.offset >= inicio && o.enObjStm).map((o) => o.ref.objectNumber))
    const flujosNuevos = new Set(leidas.map(([, numero]) => numero))
    for (const e of lectura.xref.filter((x) => x.seccion >= inicio)) {
        if (e.borrada) {
            if (e.numero !== 0) throw new Modificado('Lo agregado después del generado borra objetos.')
        } else if (e.enObjStm) {
            if (!numerosEnObjStm.has(e.numero) || !flujosNuevos.has(e.offset)) throw new Modificado('La tabla xref agregada no corresponde a los objetos.')
        } else if (lectura.cabeceras.get(e.offset) !== e.numero) {
            throw new Modificado('La tabla xref agregada no corresponde a los objetos.')
        }
    }
}

function revisarCambios(r: Revision): void {
    revisarLectura(r)
    const { lectura, generado, inicio } = r
    const ctx = lectura.doc.context
    const g = generado.doc
    const gCatalogoRef = g.context.trailerInfo.Root as PDFRef
    const gCatalogo = g.catalog
    const gPaginas = new Map<number, { ref: PDFRef, dict: PDFDict, anotaciones: Set<string> }>()
    for (const pagina of g.getPages()) {
        const anotaciones = pagina.node.lookupMaybe(N.Annots, PDFArray)?.asArray().filter((a): a is PDFRef => a instanceof PDFRef).map(String) ?? []
        gPaginas.set(pagina.ref.objectNumber, { ref: pagina.ref, dict: pagina.node, anotaciones: new Set(anotaciones) })
    }
    const gObjetos = new Map<number, PDFRef>()
    for (const [ref] of g.context.enumerateIndirectObjects()) gObjetos.set(ref.objectNumber, ref)
    const gInfo = g.context.trailerInfo.Info instanceof PDFRef ? g.context.trailerInfo.Info.objectNumber : null
    const gMetadatos = gCatalogo.get(N.Metadata) instanceof PDFRef ? (gCatalogo.get(N.Metadata) as PDFRef).objectNumber : null
    const gFormulario = gCatalogo.get(N.AcroForm) instanceof PDFRef ? (gCatalogo.get(N.AcroForm) as PDFRef).objectNumber : null
    const gEstructura = objetosDeEstructura(g)

    const nuevos = lectura.objetos.filter((o) => o.offset >= inicio)
    const versiones = new Map<number, ObjetoLeido[]>()
    for (const o of nuevos) versiones.set(o.ref.objectNumber, [...(versiones.get(o.ref.objectNumber) ?? []), o])

    const cubierto = (offset: number) => r.finesFirmas.some((fin) => fin > offset)

    const revisarFormulario = (objeto: PDFObject | undefined) => {
        const formulario = objeto instanceof PDFRef ? ctx.lookup(objeto) : objeto
        if (formulario === undefined) return
        if (!(formulario instanceof PDFDict)) throw new Modificado('El AcroForm agregado no es válido.')
        if (formulario.has(N.XFA)) throw new Modificado('El AcroForm agregado trae XFA.')
        const campos = busca(formulario, N.Fields)
        if (campos === undefined) return
        if (!(campos instanceof PDFArray)) throw new Modificado('El AcroForm agregado no es válido.')
        for (let i = 0; i < campos.size(); i++) {
            const campo = campos.lookup(i)
            if (!(campo instanceof PDFDict) || busca(campo, N.FT) !== N.Sig) throw new Modificado('Se agregaron campos de formulario que no son de firma.')
        }
    }

    const revisarCatalogo = (version: PDFObject) => {
        if (!esTipo(version, N.Catalog)) throw new Modificado('El catálogo agregado no es válido.')
        mismasClaves(version, gCatalogo, PERMITIDAS_CATALOGO, 'El catálogo')
        revisarFormulario(version.get(N.AcroForm))
    }

    const revisarAnotacion = (entrada: PDFObject, anteriores: Set<string>, offsetPagina: number) => {
        let anotacion: PDFObject | undefined = entrada
        let offset = offsetPagina
        if (entrada instanceof PDFRef) {
            if (anteriores.has(String(entrada))) return
            const definicion = versiones.get(entrada.objectNumber)
            if (!definicion || gObjetos.has(entrada.objectNumber)) throw new Modificado('Una página tiene anotaciones que no son del generado ni firmas nuevas.')
            anotacion = definicion[0].objeto
            offset = definicion[0].offset
        }
        if (!(anotacion instanceof PDFDict) || !esWidgetDeFirma(anotacion)) {
            throw new Modificado('Se agregaron anotaciones que no son firmas.')
        }
        if (!invisible(anotacion) && !cubierto(offset)) {
            throw new Modificado('Se agregó un recuadro de firma visible que ninguna firma válida cubre.')
        }
    }

    const revisarPagina = (version: ObjetoLeido, original: { dict: PDFDict, anotaciones: Set<string> }) => {
        if (!esTipo(version.objeto, N.Page)) throw new Modificado('Una página agregada no es válida.')
        mismasClaves(version.objeto, original.dict, PERMITIDAS_PAGINA, 'Una página')
        const anotaciones = version.objeto.get(N.Annots)
        const lista = anotaciones instanceof PDFRef ? ctx.lookup(anotaciones) : anotaciones
        if (lista === undefined) return
        if (!(lista instanceof PDFArray)) throw new Modificado('Las anotaciones de una página no son válidas.')
        for (const entrada of lista.asArray()) revisarAnotacion(entrada, original.anotaciones, version.offset)
    }

    for (const [numero, lista] of versiones) {
        const original = gObjetos.get(numero)
        if (original) {
            // Redefinición de un objeto del generado: solo los que una firma puede cambiar
            if (lista.some((o) => o.ref.generationNumber !== original.generationNumber)) throw new Modificado('Se redefinieron objetos del generado.')
            const pagina = gPaginas.get(numero)
            for (const version of lista) {
                if (numero === gCatalogoRef.objectNumber) revisarCatalogo(version.objeto)
                else if (pagina) revisarPagina(version, pagina)
                else if (numero === gFormulario) revisarFormulario(version.objeto)
                else if (gEstructura.has(numero) && !(version.objeto instanceof PDFRawStream)) continue
                else if (numero !== gInfo && numero !== gMetadatos) throw new Modificado('Se redefinieron objetos del contenido del generado.')
            }
            continue
        }
        for (const version of lista) {
            const o = version.objeto
            if (esTipo(o, N.Page) || esTipo(o, N.Pages)) throw new Modificado('Se agregaron páginas.')
            if (esTipo(o, N.Catalog)) revisarCatalogo(o)
            else if (esAcroForm(o)) revisarFormulario(o)
            else if (lista.length > 1 && !esDss(o) && !esInfo(o) && !esMetadatos(o)) {
                throw new Modificado('Lo agregado define dos veces el mismo objeto.')
            }
        }
    }

    // El catálogo vigente es el del generado o uno de los agregados (ya revisados)
    const raiz = ctx.trailerInfo.Root
    if (!(raiz instanceof PDFRef) || (raiz.objectNumber !== gCatalogoRef.objectNumber && !versiones.has(raiz.objectNumber))) {
        throw new Modificado('El catálogo del documento no es el del generado.')
    }
    if (lectura.doc.getPageCount() !== g.getPageCount()) throw new Modificado('Cambió la cantidad de páginas.')
}

// ─── Análisis ───────────────────────────────────────────────────────────────

export interface Generado {
    /** Tamaño y SHA-256 del PDF generado (`bytes_generado`, `hash_generado`). */
    bytesGenerado: number | null
    hashGenerado: string | null
    /** Código interno y generación vigente del certificado. */
    codigo: string
    generacion: string | null
}

/** PDF recibido y leído una sola vez (para emparejar por `Subject` y analizar con lo mismo). */
export interface FirmadoLeido {
    bytes: Uint8Array
    hash: string
    lectura: LecturaPdf | null
    error: Problema | null
    subject: string | null
}

export async function leerFirmado(bytes: Uint8Array): Promise<FirmadoLeido> {
    const hash = sha256(bytes)
    try {
        const lectura = await leerPdf(bytes)
        let subject: string | null = null
        try {
            subject = lectura.doc.getSubject() ?? null
        } catch {
            subject = null
        }
        return { bytes, hash, lectura, error: null, subject }
    } catch (error) {
        const mensaje = error instanceof PdfIlegible ? error.message : 'El archivo no es un PDF válido.'
        return { bytes, hash, lectura: null, error: { codigo: 'INVALID_PDF', mensaje }, subject: null }
    }
}

export interface AnalisisFirmado {
    hash: string
    subject: string | null
    coincidencia: CoincidenciaVerificada | null
    /** Firmas que verifican (en PREFIJO, solo las agregadas después del generado). */
    firmas: number
    firmantes: Firmante[]
    /** Si no es `null`, el archivo no se acepta (SIGNED_MODIFIED, solo forzado). */
    problema: Problema | null
}

function coincidePrefijo(firmado: Uint8Array, generado: Generado): boolean {
    const { bytesGenerado, hashGenerado } = generado
    if (!bytesGenerado || !hashGenerado || firmado.byteLength < bytesGenerado) return false
    return sha256(firmado.subarray(0, bytesGenerado)) === hashGenerado
}

/**
 * Firmas, coincidencia con el generado vigente (o `null` sin generado) y problemas del archivo.
 * Orden de los problemas: PDF ilegible, contenido activo, firma que no verifica y cambios.
 */
export async function analizarFirmado(leido: FirmadoLeido, generado: Generado | null): Promise<AnalisisFirmado> {
    const base = { hash: leido.hash, subject: leido.subject }
    const sin = (problema: Problema): AnalisisFirmado => ({ ...base, coincidencia: null, firmas: 0, firmantes: [], problema })
    if (!leido.lectura) return sin(leido.error ?? { codigo: 'INVALID_PDF', mensaje: 'El archivo no es un PDF válido.' })
    const lectura = leido.lectura

    const activo = contenidoActivo(lectura)
    if (activo) return sin({ codigo: 'PDF_ACTIVE_CONTENT', mensaje: `El PDF trae contenido activo (${activo}): no se puede entregar.` })

    let diccionarios: PDFDict[] | null
    try {
        diccionarios = firmasDelFormulario(lectura.doc)
    } catch {
        diccionarios = null
    }
    if (!diccionarios) return sin({ codigo: 'INVALID_PDF', mensaje: 'No se pudieron leer los campos de firma del PDF.' })
    if (diccionarios.length > MAX_FIRMAS) return sin({ codigo: 'INVALID_PDF', mensaje: `El PDF tiene más de ${MAX_FIRMAS} firmas.` })
    const revisadas = diccionarios.map((d) => revisarFirma(d, leido.bytes))
    const mala = revisadas.find((f) => !f.valida)
    if (mala) return sin({ codigo: 'SIGNATURE_INVALID', mensaje: `Una firma del PDF no es válida: ${mala.motivo}.` })

    let coincidencia: CoincidenciaVerificada | null = null
    if (generado && coincidePrefijo(leido.bytes, generado)) coincidencia = 'PREFIJO'
    else if (generado?.generacion && leido.subject === subjectDeCertificado(generado.codigo, generado.generacion)) coincidencia = 'METADATOS'

    let validas = revisadas
    let problema: Problema | null = null
    if (coincidencia === 'PREFIJO' && generado?.bytesGenerado) {
        const inicio = generado.bytesGenerado
        validas = revisadas.filter((f) => f.inicioHueco >= inicio)
        try {
            const original = await leerPdf(leido.bytes.subarray(0, inicio))
            revisarCambios({ lectura, generado: original, inicio, finesFirmas: validas.map((f) => f.fin) })
        } catch (error) {
            const mensaje = error instanceof Modificado ? error.message : 'No se pudo comparar el archivo con el generado.'
            problema = { codigo: 'SIGNED_MODIFIED', mensaje: `El PDF cambió después de generarse: ${mensaje}` }
        }
    }
    const ordenadas = [...validas].sort((x, y) => x.fin - y.fin)
    return {
        ...base,
        coincidencia,
        firmas: ordenadas.length,
        firmantes: ordenadas.map((f) => f.firmante as Firmante),
        problema,
    }
}

/** `ciisic:<código>:<generación>` → sus partes, o `null` si el `Subject` no es de un certificado. */
export function identidadDeSubject(subject: string | null | undefined): { codigo: string, generacion: string } | null {
    const m = /^ciisic:([A-Z0-9-]{1,40}):([0-9A-Z]{8})$/.exec(subject ?? '')
    return m ? { codigo: m[1], generacion: m[2] } : null
}

import { PDFArray, PDFDict, PDFName, type PDFDocument } from 'pdf-lib'
import { HttpError, unprocessable } from '../../../core/http-error'
import { MAX_BYTES_PLANTILLA } from '../../../core/almacenamiento'
import { hasPdfSignature } from '../../../core/pdf'
import { LIMITES_CAMPOS } from './tipos'
import { leerPdf, PdfIlegible } from './lector'
import { contenidoActivo } from './firmas'

/**
 * Validación del PDF de diseño de una plantilla (spec 015): ≤5 MB, PDF real (firma de bytes y
 * pdf-lib con topes de descompresión), sin cifrar, 1–2 páginas y sin rotación (las coordenadas de
 * los campos serían otras). Tampoco se aceptan:
 * - campos de formulario ni firmas (`PDF_HAS_FORM_FIELDS`): un diseño ya firmado haría que cada
 *   certificado generado «trajera» firmas, y un campo rellenable cambiaría el texto impreso;
 * - contenido activo (`PDF_ACTIVE_CONTENT`): JavaScript, adjuntos, multimedia, acciones al abrir…
 *   (el certificado se entrega por el portal).
 * Devuelve lo que se guarda en la plantilla: páginas y tamaño visible (CropBox) de la página 1.
 */
export interface InfoDiseno {
    paginas: number
    /** Ancho y alto visibles (CropBox) de la página 1, en pt. */
    anchoPt: number
    altoPt: number
    tamanoBytes: number
    /** Origen de la CropBox de cada página (si no es 0,0 el editor lo suma a las coordenadas). */
    cajas: { x: number, y: number, ancho: number, alto: number }[]
}

const redondear = (valor: number) => Math.round(valor * 100) / 100

/** Campos del AcroForm o firmas (`/Type /Sig`, `/FT /Sig`) en cualquier objeto del diseño. */
function tieneCamposOFirmas(doc: PDFDocument): boolean {
    const formulario = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    const campos = formulario?.lookupMaybe(PDFName.of('Fields'), PDFArray)
    if (campos && campos.size() > 0) return true
    for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
        if (!(objeto instanceof PDFDict)) continue
        if (objeto.get(PDFName.of('Type')) === PDFName.of('Sig') || objeto.get(PDFName.of('FT')) === PDFName.of('Sig')) return true
        if (objeto.get(PDFName.of('Subtype')) === PDFName.of('Widget')) return true
    }
    return false
}

export async function validarDiseno(bytes: Uint8Array): Promise<InfoDiseno> {
    if (bytes.byteLength > MAX_BYTES_PLANTILLA) {
        throw new HttpError(413, 'UPLOAD_LIMIT_EXCEEDED', 'El diseño supera los 5 MB: expórtalo como «tamaño reducido».')
    }
    if (!hasPdfSignature(bytes)) throw unprocessable('INVALID_PDF', 'El archivo no es un PDF válido.')

    let lectura
    try {
        lectura = await leerPdf(bytes, { permitirCifrado: true })
    } catch (error) {
        throw unprocessable('INVALID_PDF', error instanceof PdfIlegible && error.message !== 'El archivo no es un PDF válido.'
            ? `El archivo no es un PDF que se pueda usar: ${error.message}`
            : 'El archivo no es un PDF válido.')
    }
    const { doc } = lectura
    if (doc.isEncrypted) throw unprocessable('PDF_ENCRYPTED', 'El PDF está protegido o cifrado: expórtalo sin contraseña ni restricciones.')

    let paginas
    try {
        paginas = doc.getPages()
    } catch {
        throw unprocessable('INVALID_PDF', 'El archivo no es un PDF válido.')
    }
    if (paginas.length === 0) throw unprocessable('INVALID_PDF', 'El PDF no tiene páginas.')
    if (paginas.length > LIMITES_CAMPOS.paginasMax) {
        throw unprocessable('PDF_TOO_MANY_PAGES', `El diseño puede tener como máximo ${LIMITES_CAMPOS.paginasMax} páginas.`)
    }
    if (paginas.some((pagina) => ((pagina.getRotation().angle % 360) + 360) % 360 !== 0)) {
        throw unprocessable('PDF_ROTATED', 'El diseño tiene páginas rotadas: expórtalo con la orientación final, sin rotación.')
    }
    if (tieneCamposOFirmas(doc)) {
        throw unprocessable('PDF_HAS_FORM_FIELDS', 'El diseño tiene campos de formulario o firmas: expórtalo como PDF plano, sin firmar.')
    }
    const activo = contenidoActivo(lectura)
    if (activo) {
        throw unprocessable('PDF_ACTIVE_CONTENT', `El diseño trae contenido activo (${activo}): expórtalo como PDF plano, sin scripts, adjuntos ni multimedia.`)
    }

    const cajas = paginas.map((pagina) => {
        const caja = pagina.getCropBox()
        return { x: redondear(caja.x), y: redondear(caja.y), ancho: redondear(caja.width), alto: redondear(caja.height) }
    })
    return { paginas: paginas.length, anchoPt: cajas[0].ancho, altoPt: cajas[0].alto, tamanoBytes: bytes.byteLength, cajas }
}

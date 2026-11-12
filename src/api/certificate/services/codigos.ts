import path from 'path'

/**
 * Códigos y documentos de los certificados (spec 015). Funciones puras: se prueban sin BD.
 *
 * El código lo genera quien arma los certificados fuera del sistema (p. ej. `1GUdLMfaPT`): letras y dígitos y
 * **distingue mayúsculas**. Cada firma digital agrega `[R]` al nombre del PDF, así que un certificado con tres
 * firmas llega como `1GUdLMfaPT[R][R][R].pdf`.
 */

/** Código de un certificado: letras y dígitos, de 4 a 40 caracteres. */
export const REGEX_CODIGO_CERTIFICADO = /^[A-Za-z0-9]{4,40}$/

export function esCodigoCertificado(valor: unknown): boolean {
    return typeof valor === 'string' && REGEX_CODIGO_CERTIFICADO.test(valor)
}

/**
 * Código del certificado a partir del nombre del PDF, o `null` si no se reconoce. El nombre debe terminar en
 * `.pdf`; se quita la carpeta, la extensión, las marcas de firma (`[R]`, `[r]`, varias, con o sin espacios) y el
 * sufijo de copia del navegador o de Windows (` (1)`, ` - copia`).
 *
 * `1GUdLMfaPT[R][R][R].pdf` → `1GUdLMfaPT` · `ABCD1234 [R] (2).PDF` → `ABCD1234`
 */
export function codigoDeNombreArchivo(nombre: string): string | null {
    let base = path.posix.basename(String(nombre ?? '').replace(/\\/g, '/')).trim()
    if (!/\.pdf$/i.test(base)) return null
    base = base.replace(/\.pdf$/i, '')
    // Las marcas y los sufijos pueden venir en cualquier orden: se quitan hasta que no quede ninguno
    let anterior = ''
    while (anterior !== base) {
        anterior = base
        base = base
            .replace(/\s*\(\d{1,3}\)\s*$/, '')
            .replace(/\s*-\s*copia\s*$/i, '')
            .replace(/\s*\[[A-Za-z]{1,3}\]\s*$/, '')
            .trim()
    }
    return REGEX_CODIGO_CERTIFICADO.test(base) ? base : null
}

/**
 * DNI tal como se guarda: solo dígitos y, si tiene menos de 8, con ceros a la izquierda (Excel guarda el DNI como
 * número y se come los ceros: `2442123` → `02442123`). Más de 8 dígitos (carné de extranjería) queda igual.
 * `null` si no hay dígitos.
 */
export function normalizarDocumento(valor: unknown): string | null {
    const digitos = String(valor ?? '').replace(/\D/g, '')
    if (!digitos || digitos.length > 20) return null
    return digitos.length < 8 ? digitos.padStart(8, '0') : digitos
}

/** Formas en que el documento puede estar guardado: con y sin los ceros de la izquierda. */
export function variantesDeDocumento(documento: string): string[] {
    const sinCeros = documento.replace(/^0+/, '')
    return sinCeros && sinCeros !== documento ? [documento, sinCeros] : [documento]
}

/** Es un DNI peruano (8 dígitos) una vez normalizado. */
export function esDni(documento: string): boolean {
    return /^\d{8}$/.test(documento)
}

/**
 * Firmas digitales del PDF (informativo): diccionarios `/Type /Sig`. No cuenta los sellos de tiempo del documento
 * (`/DocTimeStamp`). Un PDF firmado y vuelto a firmar conserva las firmas anteriores (actualización incremental).
 */
export function contarFirmas(pdf: Buffer): number {
    const texto = pdf.toString('latin1')
    return (texto.match(/\/Type\s*\/Sig\b/g) ?? []).length
}

/** Los PDF empiezan con `%PDF-` (algunos generadores ponen bytes antes: se busca en el primer KB). */
export function esPdf(contenido: Buffer): boolean {
    return contenido.subarray(0, 1024).includes('%PDF-')
}

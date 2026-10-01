/**
 * Firma de bytes de un PDF: empieza con `%PDF-x.y` y tiene `%%EOF` en su último KB. Es un filtro
 * barato antes de cargarlo (ponencias, plantillas y firmados de certificados); no valida el contenido.
 */
export function hasPdfSignature(buffer: Buffer | Uint8Array): boolean {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    return /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString('ascii')) && bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
}

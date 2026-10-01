import zlib from 'zlib'
import { PDFArray, PDFContext, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'
import { hasPdfSignature } from '../../src/core/pdf'
import { hasPdfSignature as hasPdfSignaturePonencias } from '../../src/api/papers/upload'
import { estampar } from '../../src/api/certificate/pdf/estampar'
import { analizarFirmado, identidadDeSubject, leerFirmado, sha256, type AnalisisFirmado, type Generado } from '../../src/api/certificate/pdf/firmas'
import { leerPdf, MAX_BYTES_FLUJO, PdfIlegible } from '../../src/api/certificate/pdf/lector'
import type { DatosCertificado } from '../../src/api/certificate/pdf/tipos'
import { agregarCampoFirma, agregarObjetos, disenoDePrueba, firmarPdf, firmanteDePrueba, reescribir } from '../helpers/pdf'
import { nuevoFirmante } from '../helpers/firma'

const CODIGO = 'CIISIC-2026-000123-7KQ2XM'
const OTRO = 'CIISIC-2026-000124-9ZZ3PQ'

const datos = (codigo: string): DatosCertificado => ({
    nombre: 'María José Ñahuinlla Güemes', tipo: 'PARTICIPANTE', codigo, fechaEmision: new Date('2026-10-31T00:00:00Z'), horas: 40,
    evento: 'VIII CIISIC', eventoCorto: 'VIII', documento: 'DNI 12345678', detalle: null, urlVerificacion: `https://panel.example.pe/verificar/${codigo}`,
})

async function generar(codigo: string, generacion: string): Promise<{ bytes: Uint8Array, generado: Generado }> {
    const { bytes } = await estampar({
        diseno: await disenoDePrueba(),
        campos: [{ id: 'nombre', tipo: 'NOMBRE', pagina: 1, x: 100, y: 300 }, { id: 'qr', tipo: 'QR', pagina: 1, x: 650, y: 40, lado: 100 }],
        datos: datos(codigo), codigo, generacion,
    })
    return { bytes, generado: { bytesGenerado: bytes.byteLength, hashGenerado: sha256(bytes), codigo, generacion } }
}

async function analizar(bytes: Uint8Array, generado: Generado | null): Promise<AnalisisFirmado> {
    return analizarFirmado(await leerFirmado(bytes), generado)
}

/** Ref de la página 1 y de su contenido en un PDF. */
async function estructura(bytes: Uint8Array) {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const pagina = doc.getPages()[0]
    const contenidos = pagina.node.get(PDFName.of('Contents'))
    const contenido = (contenidos instanceof PDFArray ? contenidos.get(0) : contenidos) as PDFRef
    return { doc, pagina: pagina.ref, contenido, siguiente: doc.context.largestObjectNumber + 1 }
}

let base: { bytes: Uint8Array, generado: Generado }
beforeAll(async () => {
    base = await generar(CODIGO, 'AB12CD34')
    firmanteDePrueba()
})

describe('firmas que verifican', () => {
    it('el generado sin firmar → PREFIJO con 0 firmas', async () => {
        expect(await analizar(base.bytes, base.generado)).toMatchObject({ coincidencia: 'PREFIJO', firmas: 0, firmantes: [], problema: null })
    })

    it('una firma incremental (ECDSA) → 1, con su firmante; los bytes originales quedan al inicio', async () => {
        const firmado = await firmarPdf(base.bytes)
        expect(Buffer.from(firmado.subarray(0, base.bytes.byteLength)).equals(Buffer.from(base.bytes))).toBe(true)
        const r = await analizar(firmado, base.generado)
        expect(r).toMatchObject({ coincidencia: 'PREFIJO', firmas: 1, problema: null, hash: sha256(firmado), subject: `ciisic:${CODIGO}:AB12CD34` })
        expect(r.firmantes).toEqual([{
            nombre: 'Autoridad de Prueba UNDC', emisor: 'Autoridad de Prueba UNDC', serie: expect.stringMatching(/^[0-9a-f]+$/),
            validoDesde: expect.any(String), validoHasta: expect.any(String), fechaFirma: '2026-11-01T17:00:00.000Z',
        }])
    })

    it('RSA, dos firmantes uno tras otro, sello de tiempo y campo vacío (estos dos no cuentan)', async () => {
        const rsa = nuevoFirmante('Decano FII', 'rsa')
        const otro = nuevoFirmante('Director de Escuela')
        const firmado = await firmarPdf(base.bytes, { firmas: 2, firmantes: [rsa, otro], sello: true, campoVacio: true })
        const r = await analizar(firmado, base.generado)
        expect(r).toMatchObject({ coincidencia: 'PREFIJO', firmas: 2, problema: null })
        expect(r.firmantes.map((f) => f.nombre)).toEqual(['Decano FII', 'Director de Escuela'])
    })

    it('solo cuentan las firmas agregadas después del generado (las que ya traía no)', async () => {
        // Defensa en profundidad: validarDiseno ya rechaza diseños firmados
        const yaFirmado = await firmarPdf(base.bytes)
        const generado: Generado = { ...base.generado, bytesGenerado: yaFirmado.byteLength, hashGenerado: sha256(yaFirmado) }
        expect(await analizar(yaFirmado, generado)).toMatchObject({ coincidencia: 'PREFIJO', firmas: 0 })
        expect(await analizar(await firmarPdf(yaFirmado), generado)).toMatchObject({ coincidencia: 'PREFIJO', firmas: 1, problema: null })
    })

    it('un PDF etiquetado: el firmante puede reescribir el árbol de estructura (no se ve)', async () => {
        const doc = await PDFDocument.load(base.bytes, { updateMetadata: false })
        const elemento = doc.context.register(doc.context.obj({ Type: 'StructElem', S: 'Document', K: [] }))
        doc.catalog.set(PDFName.of('StructTreeRoot'), doc.context.register(doc.context.obj({ Type: 'StructTreeRoot', K: [elemento] })))
        const etiquetado = await doc.save({ useObjectStreams: false })
        const generado: Generado = { ...base.generado, bytesGenerado: etiquetado.byteLength, hashGenerado: sha256(etiquetado) }
        const conFirma = await agregarObjetos(etiquetado, [[elemento.objectNumber, '<< /Type /StructElem /S /Document /K [ << /Type /OBJR >> ] >>']])
        expect(await analizar(await firmarPdf(conFirma), generado)).toMatchObject({ coincidencia: 'PREFIJO', firmas: 1, problema: null })
        // Convertirlo en un flujo (algo que se podría dibujar) no se acepta
        const comoFlujo = await agregarObjetos(etiquetado, [[elemento.objectNumber, '<< /Length 3 >>\nstream\nq Q\nendstream']])
        expect(await analizar(await firmarPdf(comoFlujo), generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED' } })
    })

    it('un recuadro de firma visible cubierto por su firma se acepta', async () => {
        expect(await analizar(await firmarPdf(base.bytes, { visible: true }), base.generado)).toMatchObject({ firmas: 1, problema: null })
    })
})

describe('firmas que no valen (no se cuentan ni se aceptan)', () => {
    it('diccionarios /Sig sueltos fuera del AcroForm no cuentan; repetidos, además, son un cambio', async () => {
        const uno = await agregarObjetos(base.bytes, [[900, '<</V<</Type/Sig>>>>']])
        expect(await analizar(uno, base.generado)).toMatchObject({ firmas: 0, problema: null })
        const crudo = Buffer.concat([Buffer.from(base.bytes), Buffer.from('\n900 0 obj<</V<</Type/Sig>>>>endobj\n%%EOF'.repeat(3), 'latin1')])
        expect(await analizar(new Uint8Array(crudo), base.generado)).toMatchObject({ firmas: 0, problema: { codigo: 'SIGNED_MODIFIED' } })
    })

    it('/Contents en ceros, messageDigest de otros bytes u otra clave → SIGNATURE_INVALID', async () => {
        const ajena = nuevoFirmante('Otra')
        for (const firmado of [
            await firmarPdf(base.bytes, { falsa: true }),
            await firmarPdf(base.bytes, { cms: { resumenAjeno: true } }),
            await firmarPdf(base.bytes, { cms: { otraClave: ajena.clave } }),
        ]) {
            expect(await analizar(firmado, base.generado)).toMatchObject({ firmas: 0, problema: { codigo: 'SIGNATURE_INVALID' } })
        }
    })

    it('un byte cubierto que cambia después de firmar → SIGNATURE_INVALID', async () => {
        const firmado = Buffer.from(await firmarPdf(base.bytes))
        firmado.write('%PDF-1.6', 0, 'latin1')
        expect(await analizar(new Uint8Array(firmado), base.generado)).toMatchObject({ problema: { codigo: 'SIGNATURE_INVALID' } })
    })

    it('una firma válida de otro documento pegada en este no verifica', async () => {
        const otro = await generar(OTRO, 'AB12CD34')
        const firmadoOtro = Buffer.from(await firmarPdf(otro.bytes))
        const firmado = Buffer.from(await firmarPdf(base.bytes))
        const cms = (b: Buffer) => b.subarray(b.lastIndexOf('/Contents <') + 11, b.lastIndexOf('/Contents <') + 11 + 16384)
        cms(firmadoOtro).copy(firmado, firmado.lastIndexOf('/Contents <') + 11)
        expect(await analizar(new Uint8Array(firmado), base.generado)).toMatchObject({ problema: { codigo: 'SIGNATURE_INVALID' } })
    })
})

describe('cambios después del generado (PREFIJO)', () => {
    it('redefinir el contenido de la página y firmar encima → SIGNED_MODIFIED', async () => {
        const { contenido } = await estructura(base.bytes)
        const flujo = 'BT /F1 30 Tf 100 300 Td (OTRA PERSONA) Tj ET'
        const alterado = await agregarObjetos(base.bytes, [[contenido.objectNumber, `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`]])
        expect(await analizar(await firmarPdf(alterado), base.generado)).toMatchObject({
            coincidencia: 'PREFIJO', firmas: 1, problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('Se redefinieron objetos del contenido') },
        })
    })

    it('una versión intermedia de la página con otro contenido (aunque la última vuelva a la original) → SIGNED_MODIFIED', async () => {
        // Un visor puede usar la versión intermedia (si el xref apunta a ella): toda versión se revisa
        const { doc, pagina, siguiente } = await estructura(base.bytes)
        const nodo = doc.getPages()[0].node
        const original = nodo.toString()
        nodo.set(PDFName.of('Contents'), PDFRef.of(siguiente))
        const flujo = 'BT /F1 30 Tf 100 300 Td (OTRA PERSONA) Tj ET'
        const v1 = await agregarObjetos(base.bytes, [[siguiente, `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`], [pagina.objectNumber, nodo.toString()]])
        const v2 = await agregarObjetos(v1, [[pagina.objectNumber, original]])
        expect(await analizar(await firmarPdf(v2), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('/Contents') } })
    })

    it('un xref agregado que apunta a otro objeto → SIGNED_MODIFIED', async () => {
        const { contenido, siguiente } = await estructura(base.bytes)
        const firmado = Buffer.from(await firmarPdf(base.bytes))
        const otro = firmado.lastIndexOf(' 0 obj')
        const inicioOtro = firmado.lastIndexOf('\n', otro) + 1
        const desviado = Buffer.concat([firmado, Buffer.from(`\nxref\n${contenido.objectNumber} 1\n${String(inicioOtro).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${siguiente + 10} >>\nstartxref\n${firmado.length + 1}\n%%EOF\n`, 'latin1')])
        expect(await analizar(new Uint8Array(desviado), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('xref') } })
    })

    it('cambiar la caja de la página o agregar anotaciones que no son firmas → SIGNED_MODIFIED', async () => {
        const { doc, pagina, siguiente } = await estructura(base.bytes)
        const nodo = doc.getPages()[0].node
        nodo.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 100, 100]))
        const recortado = await agregarObjetos(base.bytes, [[pagina.objectNumber, nodo.toString()]])
        expect(await analizar(await firmarPdf(recortado), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('/CropBox') } })

        const otro = await estructura(base.bytes)
        const hoja = otro.doc.getPages()[0].node
        hoja.set(PDFName.of('Annots'), otro.doc.context.obj([PDFRef.of(siguiente)]))
        const conNota = await agregarObjetos(base.bytes, [
            [siguiente, '<< /Type /Annot /Subtype /FreeText /Rect [100 280 500 330] /Contents (OTRA PERSONA) /DA (/Helv 24 Tf 0 g) >>'],
            [pagina.objectNumber, hoja.toString()],
        ])
        expect(await analizar(await firmarPdf(conNota), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('anotaciones') } })
    })

    it('un recuadro de firma visible agregado después de la última firma → SIGNED_MODIFIED; invisible, no', async () => {
        const firmado = await firmarPdf(base.bytes)
        const tapa = await agregarCampoFirma(firmado, 'vacio', { visible: true })
        expect(await analizar(tapa, base.generado)).toMatchObject({ firmas: 1, problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('visible') } })
        expect(await analizar(await agregarCampoFirma(firmado, 'vacio'), base.generado)).toMatchObject({ firmas: 1, problema: null })
    })

    it('un objeto escondido dentro de un flujo o un xref que borra objetos → SIGNED_MODIFIED', async () => {
        const { contenido, siguiente } = await estructura(base.bytes)
        // pdf-lib toma el /Length hasta el último endstream y no ve el objeto de en medio; un visor sí (por el xref)
        const escondido = `${contenido.objectNumber} 0 obj\n<< /Length 9 >>\nstream\nBT ET q Q\nendstream\nendobj\n`
        const datos = `x\nendstream\nendobj\n${escondido}x`
        const conEscondido = await agregarObjetos(base.bytes, [[siguiente, `<< /Length ${datos.length} >>\nstream\n${datos}\nendstream`]])
        expect(await analizar(await firmarPdf(conEscondido), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('consistente') } })

        const firmado = Buffer.from(await firmarPdf(base.bytes))
        const borrado = Buffer.concat([firmado, Buffer.from(`\nxref\n${contenido.objectNumber} 1\n0000000000 00001 f \ntrailer\n<< /Size ${siguiente + 10} >>\nstartxref\n${firmado.length + 1}\n%%EOF\n`, 'latin1')])
        expect(await analizar(new Uint8Array(borrado), base.generado)).toMatchObject({ problema: { codigo: 'SIGNED_MODIFIED', mensaje: expect.stringContaining('borra') } })
    })

    it('contenido activo (JavaScript al abrir, adjuntos) → PDF_ACTIVE_CONTENT', async () => {
        const { doc, siguiente } = await estructura(base.bytes)
        doc.catalog.set(PDFName.of('OpenAction'), PDFRef.of(siguiente))
        const raiz = doc.context.trailerInfo.Root as PDFRef
        const conScript = await agregarObjetos(base.bytes, [
            [siguiente, '<< /Type /Action /S /JavaScript /JS (app.alert(1)) >>'],
            [raiz.objectNumber, doc.catalog.toString()],
        ])
        expect(await analizar(await firmarPdf(conScript), base.generado)).toMatchObject({ problema: { codigo: 'PDF_ACTIVE_CONTENT' } })
        const adjunto = await agregarObjetos(base.bytes, [[siguiente, '<< /Type /EmbeddedFile /Length 3 >>\nstream\nabc\nendstream']])
        expect(await analizar(await firmarPdf(adjunto), base.generado)).toMatchObject({ problema: { codigo: 'PDF_ACTIVE_CONTENT' } })
    })
})

describe('coincidencia con el generado vigente', () => {
    it('reescrito con el Subject vigente → METADATOS (solo se acepta forzado); sin Subject vigente → null', async () => {
        const reescrito = await firmarPdf(await reescribir(base.bytes))
        expect(await analizar(reescrito, base.generado)).toMatchObject({ coincidencia: 'METADATOS', firmas: 1, problema: null })
        expect(await analizar(reescrito, { ...base.generado, generacion: 'ZX98WV76' })).toMatchObject({ coincidencia: null })
    })

    it('una generación anterior o el PDF de otro certificado no coinciden', async () => {
        const anterior = await generar(CODIGO, 'ZX98WV76')
        const ajeno = await generar(OTRO, 'AB12CD34')
        for (const pdf of [anterior.bytes, ajeno.bytes]) {
            expect(await analizar(await firmarPdf(pdf), base.generado)).toMatchObject({ coincidencia: null, problema: null })
            expect(await analizar(await firmarPdf(await reescribir(pdf)), base.generado)).toMatchObject({ coincidencia: null })
        }
    })

    it('sin generado (emparejar por Subject) solo informa firmas y Subject', async () => {
        const r = await analizar(await firmarPdf(base.bytes, { firmas: 2 }), null)
        expect(r).toMatchObject({ coincidencia: null, firmas: 2, subject: `ciisic:${CODIGO}:AB12CD34`, problema: null })
        expect(identidadDeSubject(r.subject)).toEqual({ codigo: CODIGO, generacion: 'AB12CD34' })
        expect(identidadDeSubject('otra cosa')).toBeNull()
        expect(identidadDeSubject(null)).toBeNull()
    })

    it('un archivo corto o que no es PDF → INVALID_PDF', async () => {
        for (const bytes of [new Uint8Array(Buffer.from('%PDF-1.7 basura %%EOF')), new Uint8Array(0)]) {
            expect(await analizar(bytes, base.generado)).toMatchObject({ coincidencia: null, firmas: 0, problema: { codigo: 'INVALID_PDF' } })
        }
    })
})

describe('lectura acotada (bombas de descompresión)', () => {
    const objStm = (numero: number, bytes: number) => {
        const comprimido = zlib.deflateSync(Buffer.alloc(bytes, 0x20)).toString('latin1')
        return [numero, `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${comprimido.length} >>\nstream\n${comprimido}\nendstream`] as [number, string]
    }

    it('un /ObjStm que se infla más del tope por flujo no se decodifica entero: el PDF es ilegible', async () => {
        const bomba = await agregarObjetos(base.bytes, [objStm(950, MAX_BYTES_FLUJO + 1024 * 1024)])
        const inicio = Date.now()
        await expect(leerPdf(bomba)).rejects.toBeInstanceOf(PdfIlegible)
        expect(Date.now() - inicio).toBeLessThan(10_000)
        expect(await analizar(bomba, base.generado)).toMatchObject({ problema: { codigo: 'INVALID_PDF' } })
    })

    it('varios flujos bajo el tope que juntos superan el presupuesto de la lectura → ilegible', async () => {
        const muchos = await agregarObjetos(base.bytes, [objStm(950, 20 * 1024 * 1024), objStm(951, 20 * 1024 * 1024), objStm(952, 20 * 1024 * 1024), objStm(953, 20 * 1024 * 1024)])
        await expect(leerPdf(muchos)).rejects.toBeInstanceOf(PdfIlegible)
    })

    it('fuera de una lectura acotada el tope por flujo también rige (todo pdf-lib del proceso)', async () => {
        const flujo = (bytes: number) => PDFRawStream.of(PDFContext.create().obj({ Filter: 'FlateDecode' }), zlib.deflateSync(Buffer.alloc(bytes, 0x20)))
        expect(decodePDFRawStream(flujo(1024 * 1024)).decode().byteLength).toBe(1024 * 1024)
        expect(() => decodePDFRawStream(flujo(MAX_BYTES_FLUJO + 1024 * 1024)).decode()).toThrow(PdfIlegible)
        // pdf-lib trata ese /ObjStm como un objeto inválido y sigue: el documento abre sin inflarlo
        const bomba = await agregarObjetos(base.bytes, [objStm(950, MAX_BYTES_FLUJO + 1024 * 1024)])
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const doc = await PDFDocument.load(bomba, { updateMetadata: false })
        avisos.mockRestore()
        expect(doc.getPageCount()).toBe(1)
    })
})

describe('hasPdfSignature (core/pdf, compartida con las ponencias)', () => {
    it('reconoce PDF generados y firmados; rechaza lo demás', async () => {
        expect(hasPdfSignature(base.bytes)).toBe(true)
        expect(hasPdfSignature(Buffer.from(await firmarPdf(base.bytes)))).toBe(true)
        expect(hasPdfSignature(Buffer.from('<html></html>'))).toBe(false)
        expect(hasPdfSignature(base.bytes.subarray(0, base.bytes.byteLength - 10))).toBe(false)
        expect(hasPdfSignature(new Uint8Array(0))).toBe(false)
        expect(hasPdfSignaturePonencias).toBe(hasPdfSignature)
    })

    it('sha256 en hexadecimal', () => {
        expect(sha256(new Uint8Array(Buffer.from('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    })
})

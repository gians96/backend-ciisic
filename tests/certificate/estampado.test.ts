import fs from 'fs'
import path from 'path'
import * as fontkit from '@pdf-lib/fontkit'
import zlib from 'zlib'
import { PDFDocument, PDFName, PDFPage, PDFRef, type PDFFont } from 'pdf-lib'
import { MAX_BYTES_PLANTILLA } from '../../src/core/almacenamiento'
import { estampar, resolverGlifos, textoDelCampo, tramosDe } from '../../src/api/certificate/pdf/estampar'
import { CODIGOS_FUENTE, DIRECTORIO_FUENTES, FUENTES, LICENCIAS_FUENTES, catalogoFuentes, esCodigoFuente, respaldoDe } from '../../src/api/certificate/pdf/fuentes'
import {
    ajustarTexto,
    aplicarCapitalizacion,
    capitalizarTitulo,
    formatearFecha,
    normalizarTexto,
    partirEnLineas,
    posicionX,
    reemplazarMarcadores,
} from '../../src/api/certificate/pdf/texto'
import { subjectDeCertificado, type CampoPlantilla, type DatosCertificado } from '../../src/api/certificate/pdf/tipos'
import { validarDiseno } from '../../src/api/certificate/pdf/validar-diseno'
import { A4_HORIZONTAL, agregarCampoFirma, agregarObjetos, cifradoSimulado, disenoDePrueba, firmarPdf, fuentesDelPdf, programasDeFuente } from '../helpers/pdf'

const NOMBRE = 'María José Ñahuinlla Güemes'
const CODIGO = 'CIISIC-2026-000123-7KQ2XM'
const GENERACION = 'AB12CD34'

const datos = (cambios: Partial<DatosCertificado> = {}): DatosCertificado => ({
    nombre: NOMBRE,
    tipo: 'PARTICIPANTE',
    codigo: CODIGO,
    fechaEmision: new Date('2026-10-31T00:00:00.000Z'),
    horas: 40,
    evento: 'VIII Congreso Internacional de Ingeniería de Sistemas',
    eventoCorto: 'VIII CIISIC',
    documento: 'DNI 12345678',
    detalle: null,
    urlVerificacion: `https://admin-ciisic.example.pe/verificar/${CODIGO}`,
    ...cambios,
})

const campo = (cambios: Partial<CampoPlantilla> = {}): CampoPlantilla => ({ id: 'nombre', tipo: 'NOMBRE', pagina: 1, x: 120, y: 300, ...cambios })

/** Medidor de prueba: cada carácter mide medio tamaño. */
const medirFijo = (texto: string, tamano: number) => texto.length * tamano * 0.5

interface Dibujo { texto: string, x: number, y: number, tamano: number, fuente: PDFFont }

function espiarTexto(): { dibujos: Dibujo[], restaurar: () => void } {
    const dibujos: Dibujo[] = []
    const original = PDFPage.prototype.drawText
    const espia = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, texto, opciones) {
        dibujos.push({ texto, x: opciones?.x ?? 0, y: opciones?.y ?? 0, tamano: opciones?.size ?? 0, fuente: opciones?.font as PDFFont })
        return original.call(this, texto, opciones)
    })
    return { dibujos, restaurar: () => espia.mockRestore() }
}

describe('estampar (pdf-lib + fontkit)', () => {
    let diseno: Uint8Array
    beforeAll(async () => {
        diseno = await disenoDePrueba()
    })

    it(`estampa «${NOMBRE}» en un A4: carga, 1 página, fuente embebida, Subject y Title`, async () => {
        const { bytes, avisos } = await estampar({ diseno, campos: [campo({ ancho: 600, alineacion: 'CENTRO', tamano: 32 })], datos: datos(), codigo: CODIGO, generacion: GENERACION })
        expect(avisos).toEqual([])
        const doc = await PDFDocument.load(bytes, { updateMetadata: false })
        expect(doc.getPageCount()).toBe(1)
        expect(doc.getPage(0).getSize()).toEqual({ width: A4_HORIZONTAL[0], height: A4_HORIZONTAL[1] })
        expect(doc.getSubject()).toBe(`ciisic:${CODIGO}:${GENERACION}`)
        expect(doc.getSubject()).toBe(subjectDeCertificado(CODIGO, GENERACION))
        expect(doc.getTitle()).toBe(`Certificado ${CODIGO}`)
        expect(await fuentesDelPdf(bytes)).toEqual(['Montserrat-Regular'])
        // Sin object streams (compatibilidad con las herramientas de firma)
        expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/\/Type\s*\/ObjStm/)
    })

    it('el diseño no cambia: el título del diseño se reemplaza solo por el del certificado y el Producer se conserva', async () => {
        const original = await PDFDocument.load(diseno, { updateMetadata: false })
        const { bytes } = await estampar({ diseno, campos: [], datos: datos(), codigo: CODIGO, generacion: GENERACION })
        const doc = await PDFDocument.load(bytes, { updateMetadata: false })
        expect(doc.getProducer()).toBe(original.getProducer())
    })

    it('escribe el texto con tildes y ñ (NFC) en un solo tramo y centrado en la caja', async () => {
        const espia = espiarTexto()
        try {
            const descompuesto = NOMBRE.normalize('NFD')
            await estampar({ diseno, campos: [campo({ ancho: 600, alineacion: 'CENTRO', tamano: 30 })], datos: datos({ nombre: descompuesto }), codigo: CODIGO, generacion: GENERACION })
            expect(espia.dibujos).toHaveLength(1)
            const [dibujo] = espia.dibujos
            expect(dibujo.texto).toBe(NOMBRE)
            expect(dibujo.texto).toBe(dibujo.texto.normalize('NFC'))
            expect(dibujo.tamano).toBe(30)
            expect(dibujo.y).toBe(300)
            const ancho = dibujo.fuente.widthOfTextAtSize(dibujo.texto, 30)
            expect(dibujo.x + ancho / 2).toBeCloseTo(120 + 600 / 2, 3)
        } finally {
            espia.restaurar()
        }
    })

    it('un carácter sin glifo usa DejaVu Sans y avisa; uno que ninguna tiene se reemplaza por «?»', async () => {
        const espia = espiarTexto()
        try {
            const { bytes, avisos } = await estampar({ diseno, campos: [campo({ texto: '{nombre} ☃ 漢' })], datos: datos(), codigo: CODIGO, generacion: GENERACION })
            expect(avisos.map((a) => [a.campo, a.codigo])).toEqual([['nombre', 'GLIFO_RESPALDO'], ['nombre', 'GLIFO_FALTANTE']])
            expect(avisos[0].mensaje).toContain('☃')
            expect(avisos[1].mensaje).toContain('漢')
            expect(espia.dibujos.map((d) => d.texto)).toEqual([`${NOMBRE} `, '☃', ' ?'])
            expect(await fuentesDelPdf(bytes)).toEqual(['DejaVuSans', 'Montserrat-Regular'])
        } finally {
            espia.restaurar()
        }
    })

    it('resolverGlifos y tramosDe: respaldo en negrita para las fuentes negritas', () => {
        expect(resolverGlifos('Ñandú ☃ 漢', 'MONTSERRAT')).toEqual({ texto: 'Ñandú ☃ ?', respaldo: ['☃'], faltantes: ['漢'] })
        expect(tramosDe('a☃b', 'MONTSERRAT_BOLD')).toEqual([
            { texto: 'a', fuente: 'MONTSERRAT_BOLD' }, { texto: '☃', fuente: 'DEJAVU_SANS_BOLD' }, { texto: 'b', fuente: 'MONTSERRAT_BOLD' },
        ])
        expect(respaldoDe('POPPINS')).toBe('DEJAVU_SANS')
        expect(respaldoDe('POPPINS_BOLD')).toBe('DEJAVU_SANS_BOLD')
    })

    it('cada fuente del catálogo se embebe como subconjunto sano: tildes, ñ y diéresis sin avisos y todos sus glifos con contorno', async () => {
        // Sin espacios: el espacio es el único glifo sin contorno. El subconjunto de fontkit pierde
        // glifos con algunas fuentes (Great Vibes, Allura) sin lanzar error: aquí se detecta.
        const muestra = 'ÁÉÍÓÚáéíóúÑñÜü¿¡«»ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;-()'
        for (const codigo of CODIGOS_FUENTE) {
            const { bytes, avisos } = await estampar({ diseno, campos: [campo({ fuente: codigo, texto: muestra })], datos: datos(), codigo: CODIGO, generacion: GENERACION })
            expect({ codigo, avisos }).toEqual({ codigo, avisos: [] })
            const programas = await programasDeFuente(bytes)
            expect({ codigo, fuentes: programas.length }).toEqual({ codigo, fuentes: 1 })
            const subconjunto = fontkit.create(programas[0].datos)
            const defectuosos: number[] = []
            for (let glifo = 1; glifo < subconjunto.numGlyphs; glifo++) {
                try {
                    if (subconjunto.getGlyph(glifo).path.toSVG() === '') defectuosos.push(glifo)
                } catch {
                    defectuosos.push(glifo)
                }
            }
            expect({ codigo, glifos: subconjunto.numGlyphs > 40, defectuosos }).toEqual({ codigo, glifos: true, defectuosos: [] })
        }
    }, 20_000)

    it('reduce el tamaño hasta que entra en la caja y, si no entra ni al mínimo, avisa DESBORDA', async () => {
        const largo = 'Bartolomé Esteban de las Mercedes Ñahuinlla Güemes y Quispe Huamán'
        const espia = espiarTexto()
        try {
            const reducido = await estampar({ diseno, campos: [campo({ ancho: 300, tamano: 40, tamanoMinimo: 8 })], datos: datos({ nombre: largo }), codigo: CODIGO, generacion: GENERACION })
            expect(reducido.avisos).toEqual([])
            const [dibujo] = espia.dibujos
            expect(dibujo.tamano).toBeLessThan(40)
            expect(dibujo.tamano).toBeGreaterThanOrEqual(8)
            expect(dibujo.fuente.widthOfTextAtSize(dibujo.texto, dibujo.tamano)).toBeLessThanOrEqual(300)

            const desborda = await estampar({ diseno, campos: [campo({ ancho: 100, tamano: 40, tamanoMinimo: 30 })], datos: datos({ nombre: largo }), codigo: CODIGO, generacion: GENERACION })
            expect(desborda.avisos.map((a) => a.codigo)).toEqual(['DESBORDA'])
        } finally {
            espia.restaurar()
        }
    })

    it('parte en varias líneas que bajan según el interlineado', async () => {
        const espia = espiarTexto()
        try {
            await estampar({
                diseno,
                campos: [campo({ id: 'detalle', tipo: 'DETALLE', ancho: 200, tamano: 12, lineasMax: 3, interlineado: 1.5 })],
                datos: datos({ detalle: 'Ponencia: Arquitecturas de microservicios para la gestión académica universitaria' }),
                codigo: CODIGO, generacion: GENERACION,
            })
            expect(espia.dibujos.length).toBeGreaterThan(1)
            expect(espia.dibujos.length).toBeLessThanOrEqual(3)
            espia.dibujos.forEach((dibujo, i) => expect(dibujo.y).toBeCloseTo(300 - i * 12 * 1.5, 5))
        } finally {
            espia.restaurar()
        }
    })

    it('alineaciones sin caja: el ancla es x', async () => {
        const espia = espiarTexto()
        try {
            await estampar({
                diseno,
                campos: [
                    campo({ id: 'i', tipo: 'TIPO', alineacion: 'IZQUIERDA', x: 400 }),
                    campo({ id: 'c', tipo: 'TIPO', alineacion: 'CENTRO', x: 400 }),
                    campo({ id: 'd', tipo: 'TIPO', alineacion: 'DERECHA', x: 400 }),
                ],
                datos: datos(), codigo: CODIGO, generacion: GENERACION,
            })
            const [izquierda, centro, derecha] = espia.dibujos
            const ancho = izquierda.fuente.widthOfTextAtSize('PARTICIPANTE', izquierda.tamano)
            expect(izquierda.x).toBe(400)
            expect(centro.x).toBeCloseTo(400 - ancho / 2, 5)
            expect(derecha.x).toBeCloseTo(400 - ancho, 5)
        } finally {
            espia.restaurar()
        }
    })

    it('capitalización, marcadores, fechas y página 2', async () => {
        const diseno2 = await disenoDePrueba({ paginas: 2 })
        const espia = espiarTexto()
        try {
            const { bytes, avisos } = await estampar({
                diseno: diseno2,
                campos: [
                    campo({ capitalizacion: 'MAYUSCULAS' }),
                    campo({ id: 'texto', tipo: 'TEXTO', pagina: 2, texto: 'Por {horas} horas en el {eventoCorto}, {fecha}', formatoFecha: 'LARGO' }),
                    campo({ id: 'fecha', tipo: 'FECHA_EMISION', formatoFecha: 'CORTO' }),
                    campo({ id: 'fuera', tipo: 'CODIGO', pagina: 3 }),
                ],
                datos: datos({ nombre: 'maría josé ñahuinlla güemes' }), codigo: CODIGO, generacion: GENERACION,
            })
            expect(espia.dibujos.map((d) => d.texto)).toEqual(['MARÍA JOSÉ ÑAHUINLLA GÜEMES', 'Por 40 horas en el VIII CIISIC, 31 de octubre de 2026', '31/10/2026'])
            expect(avisos.map((a) => [a.campo, a.codigo])).toEqual([['fuera', 'PAGINA_INEXISTENTE']])
            expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
        } finally {
            espia.restaurar()
        }
    })

    it('una fuente desconocida usa la predeterminada y avisa; los campos vacíos no se escriben', async () => {
        const espia = espiarTexto()
        try {
            const { avisos } = await estampar({
                diseno,
                campos: [campo({ fuente: 'COMIC_SANS' }), campo({ id: 'horas', tipo: 'HORAS' }), campo({ id: 'detalle', tipo: 'DETALLE' })],
                datos: datos({ horas: null }), codigo: CODIGO, generacion: GENERACION,
            })
            expect(avisos.map((a) => a.codigo)).toEqual(['FUENTE_DESCONOCIDA'])
            expect(espia.dibujos.map((d) => d.texto)).toEqual([NOMBRE])
        } finally {
            espia.restaurar()
        }
    })

    it('si el subconjunto de la fuente falla al guardar, repite con la fuente completa y avisa', async () => {
        const guardar = PDFDocument.prototype.save
        const save = jest.spyOn(PDFDocument.prototype, 'save')
            .mockImplementationOnce(() => Promise.reject(new RangeError('Trying to access beyond buffer length')))
            .mockImplementation(function (this: PDFDocument, opciones) { return guardar.call(this, opciones) })
        const embed = jest.spyOn(PDFDocument.prototype, 'embedFont')
        try {
            const { bytes, avisos } = await estampar({ diseno, campos: [campo()], datos: datos(), codigo: CODIGO, generacion: GENERACION })
            expect(avisos.map((a) => [a.campo, a.codigo])).toEqual([[null, 'FUENTE_SIN_SUBCONJUNTO']])
            expect(embed.mock.calls.map(([, opciones]) => opciones?.subset)).toEqual([true, false])
            expect(await fuentesDelPdf(bytes)).toEqual(['Montserrat-Regular'])
        } finally {
            save.mockRestore()
            embed.mockRestore()
        }
    })

    it('un diseño que no es PDF responde 422 INVALID_PDF', async () => {
        await expect(estampar({ diseno: new Uint8Array(Buffer.from('no es un pdf')), campos: [], datos: datos(), codigo: CODIGO, generacion: GENERACION }))
            .rejects.toMatchObject({ status: 422, code: 'INVALID_PDF' })
    })
})

describe('textoDelCampo', () => {
    it('toma el valor de cada tipo o el texto con marcadores', () => {
        const d = datos({ detalle: 'Ponencia X' })
        expect(textoDelCampo(campo({ tipo: 'NOMBRE' }), d)).toBe(NOMBRE)
        expect(textoDelCampo(campo({ tipo: 'TIPO' }), d)).toBe('PARTICIPANTE')
        expect(textoDelCampo(campo({ tipo: 'CODIGO' }), d)).toBe(CODIGO)
        expect(textoDelCampo(campo({ tipo: 'HORAS' }), d)).toBe('40')
        expect(textoDelCampo(campo({ tipo: 'EVENTO' }), d)).toBe(d.evento)
        expect(textoDelCampo(campo({ tipo: 'DOCUMENTO' }), d)).toBe('DNI 12345678')
        expect(textoDelCampo(campo({ tipo: 'DETALLE' }), d)).toBe('Ponencia X')
        expect(textoDelCampo(campo({ tipo: 'FECHA_EMISION' }), d)).toBe('31 de octubre de 2026')
        expect(textoDelCampo(campo({ tipo: 'TEXTO' }), d)).toBeNull()
        expect(textoDelCampo(campo({ tipo: 'TEXTO', texto: 'Código: {codigo} {desconocido}' }), d)).toBe(`Código: ${CODIGO} {desconocido}`)
        expect(textoDelCampo(campo({ tipo: 'HORAS' }), datos({ horas: null }))).toBeNull()
    })

    it('HORAS y DETALLE sin valor no se escriben aunque tengan texto', () => {
        expect(textoDelCampo(campo({ tipo: 'HORAS', texto: '{horas} horas académicas' }), datos({ horas: null }))).toBeNull()
        expect(textoDelCampo(campo({ tipo: 'HORAS', texto: '{horas} horas académicas' }), datos({ horas: 40 }))).toBe('40 horas académicas')
        expect(textoDelCampo(campo({ tipo: 'DETALLE', texto: 'Ponencia: {detalle}' }), datos({ detalle: null }))).toBeNull()
        expect(textoDelCampo(campo({ tipo: 'DETALLE', texto: 'Ponencia: {detalle}' }), datos({ detalle: 'IA en el agro' }))).toBe('Ponencia: IA en el agro')
        // Un TEXTO libre con {horas} sí se escribe (es texto del diseño)
        expect(textoDelCampo(campo({ tipo: 'TEXTO', texto: 'Duración: {horas}' }), datos({ horas: null }))).toBe('Duración: ')
    })
})

describe('texto (funciones puras)', () => {
    it('capitalizarTitulo: partículas en minúscula, compuestos con guion, tildes y ñ', () => {
        expect(capitalizarTitulo('MARÍA JOSÉ ÑAHUINLLA GÜEMES')).toBe(NOMBRE)
        expect(capitalizarTitulo('juan de la cruz y del pino')).toBe('Juan de la Cruz y del Pino')
        expect(capitalizarTitulo('DE LA PUENTE ANA')).toBe('De la Puente Ana')
        expect(capitalizarTitulo('ana-maría   ÁLVAREZ')).toBe('Ana-María   Álvarez')
        expect(capitalizarTitulo('')).toBe('')
    })

    it('aplicarCapitalizacion', () => {
        expect(aplicarCapitalizacion('ñandú', 'MAYUSCULAS')).toBe('ÑANDÚ')
        expect(aplicarCapitalizacion('ÑANDÚ GRANDE', 'TITULO')).toBe('Ñandú Grande')
        expect(aplicarCapitalizacion('Ñandú', 'ORIGINAL')).toBe('Ñandú')
        expect(aplicarCapitalizacion('Ñandú', null)).toBe('Ñandú')
    })

    it('normalizarTexto: NFC, espacios colapsados y saltos conservados', () => {
        expect(normalizarTexto('  María\t  José \r\n Ñahuinlla  ')).toBe('María José\nÑahuinlla')
    })

    it('reemplazarMarcadores deja los desconocidos tal cual', () => {
        expect(reemplazarMarcadores('{nombre} ({tipo}) {otro} {}', { nombre: 'Ana', tipo: 'PONENTE' })).toBe('Ana (PONENTE) {otro} {}')
        expect(reemplazarMarcadores('{toString}', {})).toBe('{toString}')
    })

    it('formatearFecha usa la fecha de la columna DATE (UTC), no la hora local', () => {
        const fecha = new Date('2026-01-05T00:00:00.000Z')
        expect(formatearFecha(fecha, 'LARGO')).toBe('5 de enero de 2026')
        expect(formatearFecha(fecha, 'CORTO')).toBe('05/01/2026')
        expect(formatearFecha(new Date('2026-12-31T00:00:00.000Z'), null)).toBe('31 de diciembre de 2026')
    })

    it('ajustarTexto: sin reducir si entra', () => {
        expect(ajustarTexto({ texto: 'Ana Pérez', tamano: 20, tamanoMinimo: 10, anchoMax: 200, medir: medirFijo })).toEqual({ lineas: ['Ana Pérez'], tamano: 20, desborda: false })
    })

    it('ajustarTexto: reduce de 0,5 en 0,5 hasta el mayor tamaño que entra', () => {
        // 20 caracteres × 0,5 × s ≤ 100 → s ≤ 10
        const r = ajustarTexto({ texto: 'abcdefghij klmnopqrs', tamano: 20, tamanoMinimo: 6, anchoMax: 100, medir: medirFijo })
        expect(r).toEqual({ lineas: ['abcdefghij klmnopqrs'], tamano: 10, desborda: false })
    })

    it('ajustarTexto: reduce al mínimo y desborda, juntando el resto en la última línea', () => {
        const r = ajustarTexto({ texto: 'uno dos tres cuatro cinco', tamano: 20, tamanoMinimo: 18, anchoMax: 50, lineasMax: 2, medir: medirFijo })
        expect(r.tamano).toBe(18)
        expect(r.desborda).toBe(true)
        expect(r.lineas).toHaveLength(2)
        expect(r.lineas.join(' ')).toBe('uno dos tres cuatro cinco')
    })

    it('ajustarTexto: varias líneas al tamaño original si caben en lineasMax', () => {
        const r = ajustarTexto({ texto: 'uno dos tres cuatro', tamano: 10, anchoMax: 50, lineasMax: 3, medir: medirFijo })
        expect(r).toEqual({ lineas: ['uno dos', 'tres', 'cuatro'], tamano: 10, desborda: false })
    })

    it('ajustarTexto: sin ancho no parte ni reduce; respeta los saltos hasta lineasMax', () => {
        expect(ajustarTexto({ texto: 'una línea muy larga', tamano: 12, tamanoMinimo: 4, medir: medirFijo })).toEqual({ lineas: ['una línea muy larga'], tamano: 12, desborda: false })
        expect(ajustarTexto({ texto: 'a\nb\nc', tamano: 12, lineasMax: 2, medir: medirFijo })).toEqual({ lineas: ['a', 'b c'], tamano: 12, desborda: true })
    })

    it('partirEnLineas: una palabra más ancha que la caja queda sola', () => {
        expect(partirEnLineas('a supercalifragilístico b', 20, 2, medirFijo)).toEqual(['a', 'supercalifragilístico', 'b'])
        expect(partirEnLineas('uno\ndos tres', 1000, 10, medirFijo)).toEqual(['uno', 'dos tres'])
    })

    it('posicionX con caja y sin caja', () => {
        expect(posicionX('IZQUIERDA', 100, 200, 50)).toBe(100)
        expect(posicionX('CENTRO', 100, 200, 50)).toBe(175)
        expect(posicionX('DERECHA', 100, 200, 50)).toBe(250)
        expect(posicionX('CENTRO', 100, null, 50)).toBe(75)
        expect(posicionX('DERECHA', 100, undefined, 50)).toBe(50)
        expect(posicionX(null, 100, 0, 50)).toBe(100)
    })
})

describe('fuentes', () => {
    it('cada fuente del catálogo existe, con sus licencias junto a ellas', () => {
        for (const codigo of CODIGOS_FUENTE) expect(fs.existsSync(path.join(DIRECTORIO_FUENTES, FUENTES[codigo].archivo))).toBe(true)
        for (const licencia of LICENCIAS_FUENTES) expect(fs.statSync(path.join(DIRECTORIO_FUENTES, licencia)).size).toBeGreaterThan(1000)
        expect(fs.readFileSync(path.join(DIRECTORIO_FUENTES, 'OFL-Montserrat.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE')
        expect(fs.readFileSync(path.join(DIRECTORIO_FUENTES, 'LICENSE-DejaVu.txt'), 'utf8')).toContain('Bitstream')
        const ttf = fs.readdirSync(DIRECTORIO_FUENTES).filter((archivo) => archivo.endsWith('.ttf')).sort()
        expect(ttf).toEqual(CODIGOS_FUENTE.map((codigo) => FUENTES[codigo].archivo).sort())
    })

    it('catálogo para el panel y validación de códigos', () => {
        expect(catalogoFuentes()[0]).toEqual({ codigo: 'MONTSERRAT', nombre: 'Montserrat' })
        expect(catalogoFuentes()).toHaveLength(CODIGOS_FUENTE.length)
        expect(esCodigoFuente('PINYON_SCRIPT')).toBe(true)
        expect(esCodigoFuente('GREAT_VIBES')).toBe(false)
        expect(esCodigoFuente('toString')).toBe(false)
        expect(esCodigoFuente(undefined)).toBe(false)
    })

    it('el Dockerfile copia las fuentes a dist (tsc no copia binarios)', () => {
        const dockerfile = fs.readFileSync(path.join(__dirname, '../../Dockerfile'), 'utf8')
        expect(dockerfile).toContain('COPY --from=builder --chown=nodejs:nodejs /app/src/api/certificate/pdf/fuentes ./dist/src/api/certificate/pdf/fuentes')
    })
})

describe('validarDiseno', () => {
    it('acepta un A4 de 1 o 2 páginas y devuelve páginas, tamaño y CropBox', async () => {
        const uno = await disenoDePrueba()
        expect(await validarDiseno(uno)).toEqual({
            paginas: 1, anchoPt: 841.89, altoPt: 595.28, tamanoBytes: uno.byteLength, cajas: [{ x: 0, y: 0, ancho: 841.89, alto: 595.28 }],
        })
        expect((await validarDiseno(await disenoDePrueba({ paginas: 2 }))).paginas).toBe(2)
    })

    it('rechaza 3 páginas, rotación, cifrado, lo que no es PDF y más de 5 MB', async () => {
        await expect(validarDiseno(await disenoDePrueba({ paginas: 3 }))).rejects.toMatchObject({ status: 422, code: 'PDF_TOO_MANY_PAGES' })
        await expect(validarDiseno(await disenoDePrueba({ rotacion: 90 }))).rejects.toMatchObject({ status: 422, code: 'PDF_ROTATED' })
        await expect(validarDiseno(await cifradoSimulado(await disenoDePrueba()))).rejects.toMatchObject({ status: 422, code: 'PDF_ENCRYPTED' })
        await expect(validarDiseno(new Uint8Array(Buffer.from('<html>no</html>')))).rejects.toMatchObject({ status: 422, code: 'INVALID_PDF' })
        await expect(validarDiseno(new Uint8Array(Buffer.from('%PDF-1.7\nbasura\n%%EOF')))).rejects.toMatchObject({ status: 422, code: 'INVALID_PDF' })
        await expect(validarDiseno(new Uint8Array(MAX_BYTES_PLANTILLA + 1))).rejects.toMatchObject({ status: 413, code: 'UPLOAD_LIMIT_EXCEEDED' })
    })

    it('rechaza un diseño ya firmado o con campos de formulario (cada generado «traería» firmas)', async () => {
        await expect(validarDiseno(await firmarPdf(await disenoDePrueba()))).rejects.toMatchObject({ status: 422, code: 'PDF_HAS_FORM_FIELDS' })
        await expect(validarDiseno(await agregarCampoFirma(await disenoDePrueba(), 'vacio'))).rejects.toMatchObject({ status: 422, code: 'PDF_HAS_FORM_FIELDS' })
        const doc = await PDFDocument.create()
        doc.addPage(A4_HORIZONTAL)
        doc.getForm().createTextField('nombre').addToPage(doc.getPages()[0], { x: 100, y: 300 })
        await expect(validarDiseno(await doc.save({ useObjectStreams: false }))).rejects.toMatchObject({ status: 422, code: 'PDF_HAS_FORM_FIELDS' })
    })

    it('rechaza contenido activo (JavaScript, adjuntos) y flujos que se inflan demasiado', async () => {
        const base = await disenoDePrueba()
        const doc = await PDFDocument.load(base, { updateMetadata: false })
        const siguiente = doc.context.largestObjectNumber + 1
        const raiz = doc.context.trailerInfo.Root as PDFRef
        doc.catalog.set(PDFName.of('OpenAction'), PDFRef.of(siguiente))
        const conScript = await agregarObjetos(base, [[siguiente, '<< /S /JavaScript /JS (app.alert(1)) >>'], [raiz.objectNumber, doc.catalog.toString()]])
        await expect(validarDiseno(conScript)).rejects.toMatchObject({ status: 422, code: 'PDF_ACTIVE_CONTENT' })
        const comprimido = zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024)).toString('latin1')
        const bomba = await agregarObjetos(base, [[siguiente, `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${comprimido.length} >>
stream
${comprimido}
endstream`]])
        await expect(validarDiseno(bomba)).rejects.toMatchObject({ status: 422, code: 'INVALID_PDF' })
        // Abrir con una página de destino (sin acción) es normal en los PDF exportados
        doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj([doc.getPages()[0].ref, PDFName.of('Fit')]))
        const conDestino = await agregarObjetos(base, [[raiz.objectNumber, doc.catalog.toString()]])
        expect((await validarDiseno(conDestino)).paginas).toBe(1)
    })
})

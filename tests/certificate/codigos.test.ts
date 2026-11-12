import { codigoDeNombreArchivo, contarFirmas, esPdf, normalizarDocumento, variantesDeDocumento } from '../../src/api/certificate/services/codigos'
import { claveVigente, tipoDe } from '../../src/api/certificate/services/importacion'
import { enlacesDe } from '../../src/api/certificate/services/enlaces'
import { situacionDe } from '../../src/api/certificate/services/certificados'

/** Funciones puras de los certificados (spec 015): código del nombre del PDF, DNI y enlaces. */
describe('codigoDeNombreArchivo', () => {
    it.each([
        ['1GUdLMfaPT[R][R][R].pdf', '1GUdLMfaPT'],
        ['1Gx325sbay[R][R][R].pdf', '1Gx325sbay'],
        ['WBVTYDJEKq.pdf', 'WBVTYDJEKq'],
        ['zxDmUZLcC8[R].PDF', 'zxDmUZLcC8'],
        ['ABCD1234 [R] [R].pdf', 'ABCD1234'],
        ['ABCD1234[R][R][R] (1).pdf', 'ABCD1234'],
        ['ABCD1234[R][R] - copia.pdf', 'ABCD1234'],
        ['C:\\Users\\firma\\2N5y6JhwrS[R][R][R].pdf', '2N5y6JhwrS'],
        ['carpeta/2KzZp8t3r5[r][r][r].pdf', '2KzZp8t3r5'],
    ])('%s → %s', (nombre, codigo) => {
        expect(codigoDeNombreArchivo(nombre)).toBe(codigo)
    })

    it('conserva las mayúsculas y minúsculas del código', () => {
        expect(codigoDeNombreArchivo('aBcDeFgHiJ[R].pdf')).toBe('aBcDeFgHiJ')
    })

    it.each(['', '.pdf', '[R][R].pdf', 'certificado de juan.pdf', '../../etc/passwd', 'abc.pdf', 'ABCD-1234[R].pdf'])('rechaza «%s»', (nombre) => {
        expect(codigoDeNombreArchivo(nombre)).toBeNull()
    })
})

describe('normalizarDocumento y variantes', () => {
    it('rellena con ceros el DNI que Excel guardó como número', () => {
        expect(normalizarDocumento(2442123)).toBe('02442123')
        expect(normalizarDocumento('2442123')).toBe('02442123')
        expect(normalizarDocumento(' 15357430 ')).toBe('15357430')
    })

    it('deja igual un documento más largo y descarta lo que no tiene dígitos', () => {
        expect(normalizarDocumento('001234567')).toBe('001234567')
        expect(normalizarDocumento('abc')).toBeNull()
        expect(normalizarDocumento(null)).toBeNull()
    })

    it('busca con y sin los ceros de la izquierda', () => {
        expect(variantesDeDocumento('02442123')).toEqual(['02442123', '2442123'])
        expect(variantesDeDocumento('15357430')).toEqual(['15357430'])
    })
})

describe('PDF', () => {
    it('reconoce un PDF y cuenta sus firmas', () => {
        const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type /Sig /Filter /Adobe.PPKLite>>\n2 0 obj <</Type/Sig>>\n3 0 obj <</Type /DocTimeStamp>>\n%%EOF')
        expect(esPdf(pdf)).toBe(true)
        expect(contarFirmas(pdf)).toBe(2)
        expect(esPdf(Buffer.from('PK\x03\x04 no es un pdf'))).toBe(false)
    })
})

describe('importación: tipo y clave', () => {
    it('normaliza el tipo y usa ASISTENTE si viene vacío', () => {
        expect(tipoDe(' asistente ')).toBe('ASISTENTE')
        expect(tipoDe('')).toBe('ASISTENTE')
        expect(tipoDe('ponente  magistral')).toBe('PONENTE MAGISTRAL')
    })

    it('arma la clave vigente por evento, persona y tipo', () => {
        expect(claveVigente(2, 15, 'ASISTENTE')).toBe('2:15:ASISTENTE')
    })
})

describe('enlaces y situación', () => {
    it('arma los dos enlaces del panel', () => {
        expect(enlacesDe('https://admin.test/', 'WBVTYDJEKq')).toEqual({
            certificado: 'https://admin.test/certificado/WBVTYDJEKq',
            consulta: 'https://admin.test/consulta-certificados',
        })
        expect(enlacesDe(null, 'WBVTYDJEKq')).toBeNull()
        expect(enlacesDe('https://admin.test', 'no válido')).toBeNull()
    })

    it('traduce el estado a lo que ve el staff', () => {
        expect(situacionDe({ estado: 'SIN_ARCHIVO', enviadoEn: null })).toBe('FALTA_PDF')
        expect(situacionDe({ estado: 'LISTO', enviadoEn: null })).toBe('POR_ENTREGAR')
        expect(situacionDe({ estado: 'LISTO', enviadoEn: new Date() })).toBe('ENTREGADO')
        expect(situacionDe({ estado: 'ANULADO', enviadoEn: new Date() })).toBe('ANULADO')
    })
})

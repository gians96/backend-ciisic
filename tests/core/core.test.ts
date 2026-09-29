import { cifrar, descifrar, sufijo } from '../../src/core/crypto'
import { escapeHtml, renderTemplate } from '../../src/core/html'
import { fechaLima, horaLima, instanteLima } from '../../src/core/fechas'
import { parsePagination } from '../../src/core/pagination'
import { celdaCsv } from '../../src/api/inscription/services/inscription'

jest.mock('../../src/database/prisma', () => ({ prisma: {} }))

describe('cifrado de secretos (AES-256-GCM)', () => {
    it('cifra y descifra sin exponer el texto plano', () => {
        const cifrado = cifrar('token-super-secreto-1234')
        expect(cifrado).not.toContain('token-super-secreto')
        expect(cifrado.startsWith('v1:')).toBe(true)
        expect(descifrar(cifrado)).toBe('token-super-secreto-1234')
    })

    it('usa un IV distinto en cada cifrado', () => {
        expect(cifrar('mismo')).not.toBe(cifrar('mismo'))
    })

    it('detecta alteraciones del contenido', () => {
        const [v, iv, tag, datos] = cifrar('valor').split(':')
        const alterado = [v, iv, tag, Buffer.from('otro').toString('base64')].join(':')
        expect(() => descifrar(alterado)).toThrow()
        expect(datos).toBeTruthy()
    })

    it('muestra solo el sufijo', () => {
        expect(sufijo('abcdef123456')).toBe('3456')
    })
})

describe('plantillas HTML', () => {
    it('escapa caracteres especiales', () => {
        expect(escapeHtml('<iframe src="http://x">&\'')).toBe('&lt;iframe src=&quot;http://x&quot;&gt;&amp;&#39;')
    })

    it('escapa valores y no interpreta patrones de reemplazo como $&', () => {
        const html = renderTemplate('<h3>{{NOMBRES}}</h3><img src="{{QR}}">', { NOMBRES: '<script>$& $\'</script>', QR: 'data:image/png;base64,AAA' }, ['QR'])
        expect(html).toBe('<h3>&lt;script&gt;$&amp; $&#39;&lt;/script&gt;</h3><img src="data:image/png;base64,AAA">')
    })

    it('deja intactas las claves desconocidas', () => {
        expect(renderTemplate('{{X}} {{Y}}', { X: 1 })).toBe('1 {{Y}}')
    })
})

describe('fechas en hora de Lima', () => {
    it('convierte fecha y hora locales a instante UTC-5', () => {
        const instante = instanteLima('2026-10-26', '09:30')
        expect(instante.toISOString()).toBe('2026-10-26T14:30:00.000Z')
        expect(horaLima(instante)).toBe('09:30')
        expect(fechaLima(instante)).toBe('2026-10-26')
    })

    it('usa el día de Lima cerca de medianoche UTC', () => {
        expect(fechaLima(new Date('2026-10-27T03:00:00.000Z'))).toBe('2026-10-26')
    })
})

describe('paginación', () => {
    it('aplica valores por defecto y límites', () => {
        expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 })
        expect(parsePagination({ page: '3', pageSize: '500' })).toEqual({ page: 3, pageSize: 100, skip: 200, take: 100 })
        expect(parsePagination({ page: 'abc', pageSize: '-5' })).toMatchObject({ page: 1, pageSize: 1 })
    })
})

describe('CSV', () => {
    it('neutraliza fórmulas y escapa separadores', () => {
        expect(celdaCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
        expect(celdaCsv('+51 999')).toBe('\'+51 999')
        expect(celdaCsv('Pérez; Juan')).toBe('"Pérez; Juan"')
        expect(celdaCsv(null)).toBe('')
    })
})

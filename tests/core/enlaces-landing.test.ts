import { origenLanding, urlCredencial, urlInscripcionPonencias } from '../../src/core/enlaces-landing'
import { htmlComunicado } from '../../src/api/specialized-talk/services/avisos'

describe('enlaces a la landing (specs 038 y 039)', () => {
    it('el origen se limpia: sin espacios ni barras al final; vacío = sin landing', () => {
        expect(origenLanding(' https://ciisic-viii.episundc.pe/ ')).toBe('https://ciisic-viii.episundc.pe')
        expect(origenLanding('https://x.test///')).toBe('https://x.test')
        expect(origenLanding('')).toBeNull()
        expect(origenLanding('   ')).toBeNull()
        expect(origenLanding(null)).toBeNull()
        expect(origenLanding(undefined)).toBeNull()
    })

    it('el enlace de la credencial lleva el código de 10 caracteres; sin landing o con un código dudoso no hay enlace', () => {
        expect(urlCredencial('https://x.test/', 'K7Q2M9X4TB')).toBe('https://x.test/credencial/K7Q2M9X4TB')
        expect(urlCredencial(null, 'K7Q2M9X4TB')).toBeNull()
        expect(urlCredencial('https://x.test', null)).toBeNull()
        expect(urlCredencial('https://x.test', 'k7q2m9x4tb')).toBeNull()
        expect(urlCredencial('https://x.test', '../admin')).toBeNull()
    })

    it('el enlace a las ponencias es la página de inscripción de la landing', () => {
        expect(urlInscripcionPonencias('https://x.test/')).toBe('https://x.test/inscripcion-ponencias')
        expect(urlInscripcionPonencias(null)).toBeNull()
    })
})

describe('htmlComunicado con botón (spec 039)', () => {
    const evento = { nombre: 'VIII CIISIC', correoContacto: null }

    it('sin botón queda como el comunicado de siempre', () => {
        const html = htmlComunicado('Hola {nombre}.', 'JHOSEP JAVIER', evento, 'no-reply@undc.edu.pe')
        expect(html).toContain('Hola Jhosep.')
        expect(html).not.toContain('<a ')
        expect(html).toContain('no-reply@undc.edu.pe')
    })

    it('con botón agrega el enlace escapado y su respaldo en texto', () => {
        const html = htmlComunicado('Hola.', '', evento, 'no-reply@undc.edu.pe', { texto: 'Ir <ya>', url: 'https://x.test/inscripcion-ponencias?a=1&b="2"' })
        expect(html).toContain('href="https://x.test/inscripcion-ponencias?a=1&amp;b=&quot;2&quot;"')
        expect(html).toContain('Ir &lt;ya&gt;')
        expect(html.match(/href=/g)).toHaveLength(2)
    })
})

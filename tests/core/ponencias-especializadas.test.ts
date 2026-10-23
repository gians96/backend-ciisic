import { coponentesDe, duracionMinutos, esFotoValida, esFueraDeHorario, seCruzan } from '../../src/core/ponencias-especializadas'

// 27 de octubre de 2026, hora de Lima (UTC−5): 12:00 → 17:00Z
const en = (hora: string, dia = '27') => new Date(`2026-10-${dia}T${hora}:00.000-05:00`)
const ponencia = { fecha: new Date('2026-10-27T00:00:00.000Z'), horaInicio: en('12:00'), horaFin: en('12:45') }

describe('seCruzan', () => {
    it('detecta horarios que se solapan, incluso si uno contiene al otro', () => {
        expect(seCruzan(ponencia, { horaInicio: en('12:30'), horaFin: en('13:15') })).toBe(true)
        expect(seCruzan(ponencia, { horaInicio: en('11:00'), horaFin: en('18:00') })).toBe(true)
        expect(seCruzan(ponencia, ponencia)).toBe(true)
    })

    it('las que solo se tocan en el borde o son de otro día no se cruzan', () => {
        expect(seCruzan(ponencia, { horaInicio: en('12:45'), horaFin: en('13:30') })).toBe(false)
        expect(seCruzan(ponencia, { horaInicio: en('11:00'), horaFin: en('12:00') })).toBe(false)
        expect(seCruzan(ponencia, { horaInicio: en('12:00', '28'), horaFin: en('12:45', '28') })).toBe(false)
    })

    it('es simétrica', () => {
        const otra = { horaInicio: en('12:30'), horaFin: en('13:15') }
        expect(seCruzan(otra, ponencia)).toBe(seCruzan(ponencia, otra))
    })
})

describe('duracionMinutos', () => {
    it('calcula los minutos entre el inicio y el fin', () => {
        expect(duracionMinutos(ponencia)).toBe(45)
        expect(duracionMinutos({ horaInicio: en('09:00'), horaFin: en('10:30') })).toBe(90)
    })
})

describe('esFueraDeHorario', () => {
    it('es falso desde 30 minutos antes del inicio hasta el fin', () => {
        expect(esFueraDeHorario(en('11:30'), ponencia, 30)).toBe(false)
        expect(esFueraDeHorario(en('12:20'), ponencia, 30)).toBe(false)
        expect(esFueraDeHorario(en('12:45'), ponencia, 30)).toBe(false)
    })

    it('es verdadero antes de la ventana, después del fin o en otro día', () => {
        expect(esFueraDeHorario(en('11:29'), ponencia, 30)).toBe(true)
        expect(esFueraDeHorario(en('12:46'), ponencia, 30)).toBe(true)
        expect(esFueraDeHorario(en('12:20', '28'), ponencia, 30)).toBe(true)
    })

    it('el día se mide en hora de Lima: las 23:30 de Lima ya son el día siguiente en UTC', () => {
        const noche = { fecha: new Date('2026-10-27T00:00:00.000Z'), horaInicio: en('23:00'), horaFin: en('23:45') }
        expect(esFueraDeHorario(en('23:30'), noche, 30)).toBe(false)
    })
})

describe('esFotoValida', () => {
    it('acepta rutas del sitio y URLs https', () => {
        expect(esFotoValida('/images/ponentes/2026/especializados/edwin-roque.webp')).toBe(true)
        expect(esFotoValida('https://cdn.ejemplo.pe/fotos/a.png')).toBe(true)
        expect(esFotoValida('https://cdn.ejemplo.pe')).toBe(true)
    })

    it('rechaza otros esquemas, saltos de directorio, espacios y rutas con doble barra', () => {
        for (const foto of ['http://sitio.pe/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', '//otro.com/a.png', '/images/../secreto.png', '/images/mi foto.png', 'foto.png', 'https://', `/${'a'.repeat(260)}`]) {
            expect({ foto, valida: esFotoValida(foto) }).toEqual({ foto, valida: false })
        }
    })
})

describe('coponentesDe', () => {
    it('lee el arreglo guardado y completa lo que falte', () => {
        const guardado = [{ nombre: 'Dr. Ángel Almidón Elescano', bio: 'Perfil', foto: '/images/a.webp', externo: true }, { nombre: 'Dr. Javier Poma' }]
        expect(coponentesDe(guardado)).toEqual([
            { nombre: 'Dr. Ángel Almidón Elescano', bio: 'Perfil', foto: '/images/a.webp', externo: true },
            { nombre: 'Dr. Javier Poma', bio: null, foto: null, externo: false },
        ])
    })

    it('sin coponentes, o con un valor que no es un arreglo, devuelve una lista vacía', () => {
        for (const valor of [null, undefined, {}, 'texto', 7]) expect(coponentesDe(valor)).toEqual([])
    })

    it('ignora los elementos que no tienen nombre de ponente', () => {
        expect(coponentesDe([null, 3, 'x', {}, { nombre: '  ' }, { nombre: 5 }, { nombre: 'Válido' }])).toEqual([{ nombre: 'Válido', bio: null, foto: null, externo: false }])
    })
})

import {
    calcularPrecio, descuentoSobreLista, esCorreoInstitucional, estudianteUndcExcluido, MENSAJE_TIPO_SIN_ESTUDIANTES_UNDC, mensajeTipoNoDisponible, tipoDisponible,
} from '../../src/api/inscription/services/pricing'
import { esCorreoDeEstudiante } from '../../src/core/correo-institucional'

const base = { precio: 120, precioInstitucional: 100 }

describe('reglas de precio', () => {
    it('categoría estudiantil: precio UNDC solo con verificación', () => {
        expect(calcularPrecio({ ...base, esEstudiantil: true, estudianteUndcVerificado: true, correoInstitucional: true }))
            .toEqual({ monto: 100, descuento: 20, aplicaInstitucional: true })
        expect(calcularPrecio({ ...base, esEstudiantil: true, estudianteUndcVerificado: false, correoInstitucional: true }))
            .toEqual({ monto: 120, descuento: 0, aplicaInstitucional: false })
    })

    it('estudiante externo paga el precio regular', () => {
        expect(calcularPrecio({ ...base, esEstudiantil: true, estudianteUndcVerificado: false, correoInstitucional: false }).monto).toBe(120)
    })

    it('categoría general: precio institucional por dominio de correo', () => {
        expect(calcularPrecio({ precio: 140, precioInstitucional: 120, esEstudiantil: false, estudianteUndcVerificado: false, correoInstitucional: true }).monto).toBe(120)
        expect(calcularPrecio({ precio: 140, precioInstitucional: 120, esEstudiantil: false, estudianteUndcVerificado: false, correoInstitucional: false }).monto).toBe(140)
    })

    // Spec 018: los tipos virtuales llevan precio == precioInstitucional (30/30 y 50/50)
    it.each([
        [30, 'estudiantil verificado', { esEstudiantil: true, estudianteUndcVerificado: true, correoInstitucional: true }],
        [30, 'estudiantil sin verificar', { esEstudiantil: true, estudianteUndcVerificado: false, correoInstitucional: true }],
        [30, 'estudiante externo', { esEstudiantil: true, estudianteUndcVerificado: false, correoInstitucional: false }],
        [50, 'general con correo del dominio', { esEstudiantil: false, estudianteUndcVerificado: false, correoInstitucional: true }],
        [50, 'general externo', { esEstudiantil: false, estudianteUndcVerificado: false, correoInstitucional: false }],
        [50, 'legacy con correo del dominio', { esEstudiantil: false, estudianteUndcVerificado: false, correoInstitucional: true, legacy: true }],
    ])('precio igual al institucional (%s): mismo monto y descuento 0 (%s)', (valor, _caso, contexto) => {
        const precio = calcularPrecio({ precio: valor, precioInstitucional: valor, ...contexto })
        expect(precio.monto).toBe(valor)
        expect(precio.descuento).toBe(0)
    })

    it('modo legacy conserva la regla histórica por dominio', () => {
        expect(calcularPrecio({ ...base, esEstudiantil: true, estudianteUndcVerificado: false, correoInstitucional: true, legacy: true }).monto).toBe(100)
    })

    it('reconoce el dominio institucional sin distinguir mayúsculas', () => {
        expect(esCorreoInstitucional('2020123456@UNDC.edu.pe', 'undc.edu.pe')).toBe(true)
        expect(esCorreoInstitucional('alguien@undc.edu.pe.evil.com', 'undc.edu.pe')).toBe(false)
        expect(esCorreoInstitucional('sin-arroba', 'undc.edu.pe')).toBe(false)
    })
})

describe('disponibilidad del tipo (spec 016)', () => {
    it.each([
        ['TODOS', true, true],
        ['TODOS', false, true],
        ['INSTITUCIONAL', true, true],
        ['INSTITUCIONAL', false, false],
        ['EXTERNOS', true, false],
        ['EXTERNOS', false, true],
        [null, true, true],
        [undefined, false, true],
    ] as const)('%s con aplicaInstitucional=%s → disponible=%s', (disponiblePara, aplicaInstitucional, esperado) => {
        expect(tipoDisponible(disponiblePara, aplicaInstitucional)).toBe(esperado)
    })

    it('el mensaje dice a quién se ofrece según la categoría', () => {
        expect(mensajeTipoNoDisponible('EXTERNOS', false, 'undc.edu.pe')).toContain('no está disponible para correos @undc.edu.pe')
        expect(mensajeTipoNoDisponible('INSTITUCIONAL', false, 'undc.edu.pe')).toContain('es solo para correos @undc.edu.pe')
        expect(mensajeTipoNoDisponible('INSTITUCIONAL', true, 'undc.edu.pe')).toContain('es solo para estudiantes verificados con su correo @undc.edu.pe')
    })
})

describe('correo de estudiante UNDC (spec 020)', () => {
    it.each([
        ['2020123456@undc.edu.pe', 'undc.edu.pe', true],
        ['20201234@UNDC.edu.pe', 'undc.edu.pe', true],
        ['  2020123456@undc.edu.pe  ', 'undc.edu.pe', true],
        ['garias@undc.edu.pe', 'undc.edu.pe', false],
        ['2020123456@gmail.com', 'undc.edu.pe', false],
        ['2020123456@undc.edu.pe.evil.com', 'undc.edu.pe', false],
        ['1234567@undc.edu.pe', 'undc.edu.pe', false],
        ['2020123456@uni.edu.pe', 'uni.edu.pe', true],
        ['2020123456@undc.edu.pe', 'uni.edu.pe', false],
        ['sin-arroba', 'undc.edu.pe', false],
    ])('%s con dominio %s → %s', (correo, dominio, esperado) => {
        expect(esCorreoDeEstudiante(correo, dominio)).toBe(esperado)
    })
})

describe('tipos que no admiten estudiantes UNDC (spec 020)', () => {
    const persona = (extra: Partial<{ verificadoComoEstudiante: boolean, correo: string, dominio: string }> = {}) =>
        ({ verificadoComoEstudiante: false, correo: 'ana@gmail.com', dominio: 'undc.edu.pe', ...extra })

    it('con el interruptor apagado (o sin valor) nadie queda excluido', () => {
        for (const excluye of [false, null, undefined]) {
            expect(estudianteUndcExcluido(excluye, persona({ verificadoComoEstudiante: true, correo: '2020123456@undc.edu.pe' }))).toBe(false)
        }
    })

    it('excluye al estudiante verificado y al correo con código de estudiante', () => {
        expect(estudianteUndcExcluido(true, persona({ verificadoComoEstudiante: true }))).toBe(true)
        expect(estudianteUndcExcluido(true, persona({ correo: '2020123456@undc.edu.pe' }))).toBe(true)
    })

    it('no afecta a docentes, administrativos ni externos', () => {
        expect(estudianteUndcExcluido(true, persona({ correo: 'garias@undc.edu.pe' }))).toBe(false)
        expect(estudianteUndcExcluido(true, persona({ correo: 'ana@gmail.com' }))).toBe(false)
    })

    it('el mensaje dice que es para estudiantes de la UNDC y manda a un plan presencial', () => {
        expect(MENSAJE_TIPO_SIN_ESTUDIANTES_UNDC).toContain('no está disponible para estudiantes de la UNDC')
        expect(MENSAJE_TIPO_SIN_ESTUDIANTES_UNDC).toContain('plan presencial')
    })
})

describe('descuentoSobreLista (spec 035)', () => {
    it('es lo que la persona paga de menos respecto al precio de lista', () => {
        expect(descuentoSobreLista(140, 120)).toBe(20)
        expect(descuentoSobreLista(120, 120)).toBe(0)
    })

    it('pagar de más no es un descuento negativo', () => {
        expect(descuentoSobreLista(120, 140)).toBe(0)
    })

    it('redondea a centavos', () => {
        expect(descuentoSobreLista(100, 66.67)).toBe(33.33)
        expect(descuentoSobreLista(0.3, 0.1)).toBe(0.2)
    })
})

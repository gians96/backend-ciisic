import { calcularPrecio, esCorreoInstitucional, mensajeTipoNoDisponible, tipoDisponible } from '../../src/api/inscription/services/pricing'

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

import { esModalidadAsistencia, MODALIDADES_ASISTENCIA, modalidadDe } from '../../src/core/catalogos'

describe('modalidad de asistencia (spec 018)', () => {
    it('hay dos modalidades y PRESENCIAL va primero', () => {
        expect([...MODALIDADES_ASISTENCIA]).toEqual(['PRESENCIAL', 'VIRTUAL'])
    })

    it.each([
        ['VIRTUAL', 'VIRTUAL'],
        ['PRESENCIAL', 'PRESENCIAL'],
        [undefined, 'PRESENCIAL'],
        [null, 'PRESENCIAL'],
        ['', 'PRESENCIAL'],
        ['virtual', 'PRESENCIAL'],
        ['HIBRIDA', 'PRESENCIAL'],
        ['banco', 'PRESENCIAL'],
        [1, 'PRESENCIAL'],
    ])('modalidadDe(%j) = %s: solo VIRTUAL exacto es virtual', (valor, esperado) => {
        expect(modalidadDe(valor)).toBe(esperado)
    })

    it('esModalidadAsistencia solo acepta las dos modalidades exactas', () => {
        expect(esModalidadAsistencia('VIRTUAL')).toBe(true)
        expect(esModalidadAsistencia('PRESENCIAL')).toBe(true)
        for (const otro of ['virtual', 'billetera', '', null, undefined, 0]) expect(esModalidadAsistencia(otro)).toBe(false)
    })
})

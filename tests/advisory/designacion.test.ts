import { leerDesignacion, planearAsesores, type AsesorExistente } from '../../src/api/advisory/services/designacion'

const base = () => ({
    grupos: [{ grupo: 'II-A', turno: 'M' }, { grupo: 'II-B', turno: 'T' }, { grupo: 'VI-A1', turno: 'M' }],
    asesores: [
        { nombre: 'DRA. MARISOL DAGA CHACA', dni: '04081923', grupos: ['II-A'] },
        { nombre: 'MG. ALEJOS CUADROS HENRY YURI', dni: 71472219, grupos: ['II-B', 'VI-A1'] },
    ],
})

describe('leerDesignacion', () => {
    it('lee los grupos con su turno y los asesores con su DNI y sus grupos', () => {
        const d = leerDesignacion(base())
        expect(d.grupos).toEqual([{ ciclo: 'II', seccion: 'A', turno: 'M' }, { ciclo: 'II', seccion: 'B', turno: 'T' }, { ciclo: 'VI', seccion: 'A1', turno: 'M' }])
        expect(d.asesores[0]).toMatchObject({ nombre: 'DRA. MARISOL DAGA CHACA', documento: '04081923' })
        expect(d.asesores[1].grupos.map((g) => `${g.ciclo}-${g.seccion}`)).toEqual(['II-B', 'VI-A1'])
        // El DNI que Excel dejó en número de 7 dígitos recupera su cero
        expect(leerDesignacion({ ...base(), asesores: [{ nombre: 'MG. UNO', dni: 2442123, grupos: ['II-A', 'II-B', 'VI-A1'] }] }).asesores[0].documento).toBe('02442123')
    })

    it('el DNI es opcional: sin él no se cambia el que ya tenga', () => {
        const d = leerDesignacion({ ...base(), asesores: [{ nombre: 'MG. UNO', grupos: ['II-A', 'II-B', 'VI-A1'] }] })
        expect(d.asesores[0].documento).toBeNull()
    })

    it.each([
        ['no es un objeto', [], /objeto/],
        ['grupos vacíos', { ...base(), grupos: [] }, /grupos/],
        ['grupo mal escrito', { ...base(), grupos: [{ grupo: 'dos-A', turno: 'M' }] }, /grupo válido/],
        ['turno inválido', { ...base(), grupos: [{ grupo: 'II-A', turno: 'X' }] }, /turno/],
        ['grupo repetido', { ...base(), grupos: [{ grupo: 'II-A', turno: 'M' }, { grupo: 'II-A', turno: 'M' }] }, /repetido/],
        ['asesor sin nombre', { ...base(), asesores: [{ nombre: ' ', grupos: ['II-A'] }] }, /sin nombre/],
        ['asesor repetido sin acentos ni mayúsculas', { ...base(), asesores: [{ nombre: 'MG. Pérez', grupos: ['II-A'] }, { nombre: 'mg. perez', grupos: ['II-B'] }] }, /repetido/],
        ['DNI inválido', { ...base(), asesores: [{ nombre: 'MG. UNO', dni: '123', grupos: ['II-A'] }] }, /8 dígitos/],
        ['DNI repetido entre asesores', { ...base(), asesores: [{ nombre: 'MG. UNO', dni: '04081923', grupos: ['II-A'] }, { nombre: 'MG. DOS', dni: '4081923', grupos: ['II-B', 'VI-A1'] }] }, /otro asesor/],
        ['grupo que no está en «grupos»', { ...base(), asesores: [{ nombre: 'MG. UNO', grupos: ['II-A', 'II-B', 'VI-A1', 'X-A'] }] }, /X-A/],
        ['grupo sin asesor', { ...base(), asesores: [{ nombre: 'MG. UNO', grupos: ['II-A'] }] }, /Grupos sin asesor: II-B, VI-A1/],
    ])('rechaza: %s', (_motivo, entrada, mensaje) => {
        expect(() => leerDesignacion(entrada)).toThrow(mensaje)
    })
})

describe('planearAsesores', () => {
    const existentes: AsesorExistente[] = [
        { id: 1, nombre: 'DRA. MARISOL DAGA CHACA', documento: null, secciones: [{ ciclo: 'II', seccion: 'A' }, { ciclo: 'II', seccion: 'A1' }, { ciclo: 'II', seccion: 'A2' }] },
        { id: 2, nombre: 'MG. ALEJOS CUADROS HENRY YURI', documento: '71472219', secciones: [{ ciclo: 'II', seccion: 'B' }, { ciclo: 'VI', seccion: 'A1' }] },
        { id: 3, nombre: 'MG. FUERA DE LA LISTA', documento: '99999999', secciones: [{ ciclo: 'I', seccion: 'A' }] },
    ]

    it('empareja por nombre y dice qué cambia: el DNI nuevo y las secciones que se reemplazan por las de la designación', () => {
        const plan = planearAsesores(leerDesignacion(base()), existentes)
        const [daga, alejos] = plan.cambios
        expect(daga).toMatchObject({ cambiaDocumento: true, documentoAntes: null, cambiaSecciones: true, seccionesAntes: ['II-A', 'II-A1', 'II-A2'], seccionesDespues: ['II-A'] })
        expect(daga.existente?.id).toBe(1)
        expect(alejos).toMatchObject({ cambiaDocumento: false, cambiaSecciones: false })
        expect(plan.conflictos).toEqual([])
    })

    it('los que no están en la designación no se tocan y un asesor nuevo se crea', () => {
        const plan = planearAsesores(
            leerDesignacion({ ...base(), asesores: [...base().asesores, { nombre: 'MG. NUEVO', dni: '11111111', grupos: ['II-A'] }] }),
            existentes,
        )
        expect(plan.noDesignados.map((a) => a.id)).toEqual([3])
        expect(plan.cambios[2]).toMatchObject({ existente: null, cambiaDocumento: true })
    })

    it('empareja sin importar acentos, mayúsculas ni espacios', () => {
        const plan = planearAsesores(
            leerDesignacion({ ...base(), asesores: [{ nombre: 'dra.  marisol daga  chaca', grupos: ['II-A', 'II-B', 'VI-A1'] }] }),
            existentes,
        )
        expect(plan.cambios[0].existente?.id).toBe(1)
    })

    it('un DNI que ya es de un asesor que no está en la designación es un conflicto', () => {
        const plan = planearAsesores(leerDesignacion({ ...base(), asesores: [{ nombre: 'DRA. MARISOL DAGA CHACA', dni: '99999999', grupos: ['II-A', 'II-B', 'VI-A1'] }] }), existentes)
        expect(plan.conflictos).toHaveLength(1)
        expect(plan.conflictos[0]).toMatch(/MG\. FUERA DE LA LISTA/)
    })
})

import { consolidarPadron, plegarSeccion, seccionesDelEstudiante, seccionPrincipal, type GrupoAsesoria, type MatriculaJp } from '../../src/api/advisory/services/matriculas-jp'
import type { EstudiantePadron } from '../../src/api/advisory/services/importacion'

/** Los grupos de la designación de asesores del CIISIC 2026 (turno M, T o N). */
const GRUPOS: GrupoAsesoria[] = [
    ['I', 'A', 'M'], ['II', 'A', 'M'], ['II', 'B', 'T'], ['III', 'A', 'M'], ['IV', 'A', 'M'], ['IV', 'B', 'T'],
    ['VI', 'A1', 'M'], ['VI', 'A2', 'M'], ['VI', 'B1', 'T'], ['VI', 'B2', 'T'], ['VIII', 'A', 'M'], ['VIII', 'B', 'T'], ['X', 'A', 'N'], ['X', 'B', 'N'],
].map(([ciclo, seccion, turno]) => ({ ciclo, seccion, turno }))

const jp = (codigo: string, ciclo: string, turno: string, seccion: string, correo: string | null = null): MatriculaJp => ({ codigo, ciclo, turno, seccion, correo })

const padron = (codigo: string, extra: Partial<EstudiantePadron> = {}): EstudiantePadron => ({
    documento: '60000001', codigo, correo: `${codigo.toLowerCase()}@undc.edu.pe`, nombre: `ALUMNO ${codigo}`, celular: null, carrera: 'INGENIERÍA DE SISTEMAS',
    ciclo: 'I', turno: 'M', seccion: 'A', distrito: null, provincia: null, departamento: null, secciones: [], ...extra,
})

describe('plegarSeccion: de la sección del curso en JP al grupo de la designación', () => {
    it('una sección que ya es un grupo se queda (VI-A1)', () => {
        expect(plegarSeccion({ ciclo: 'VI', turno: 'M', seccion: 'A1' }, GRUPOS)).toMatchObject({ ciclo: 'VI', seccion: 'A1' })
        expect(plegarSeccion({ ciclo: 'ii', turno: 'T', seccion: 'b' }, GRUPOS)).toMatchObject({ ciclo: 'II', seccion: 'B' })
    })

    it('el laboratorio se pliega a la teoría quitando el dígito final (II-A1 → II-A, VIII-B2 → VIII-B)', () => {
        expect(plegarSeccion({ ciclo: 'II', turno: 'M', seccion: 'A1' }, GRUPOS)).toMatchObject({ ciclo: 'II', seccion: 'A' })
        expect(plegarSeccion({ ciclo: 'VIII', turno: 'T', seccion: 'B2' }, GRUPOS)).toMatchObject({ ciclo: 'VIII', seccion: 'B' })
        expect(plegarSeccion({ ciclo: 'X', turno: 'N', seccion: 'A2' }, GRUPOS)).toMatchObject({ ciclo: 'X', seccion: 'A' })
    })

    it('una sección que la designación no conoce va al único grupo de su ciclo y turno (IV-C de la tarde → IV-B)', () => {
        expect(plegarSeccion({ ciclo: 'IV', turno: 'T', seccion: 'C' }, GRUPOS)).toMatchObject({ ciclo: 'IV', seccion: 'B' })
    })

    it('si el turno no decide (VI mañana tiene A1 y A2) o el ciclo no está, queda sin grupo', () => {
        expect(plegarSeccion({ ciclo: 'VI', turno: 'M', seccion: 'A' }, GRUPOS)).toBeNull()
        expect(plegarSeccion({ ciclo: 'V', turno: 'M', seccion: 'A' }, GRUPOS)).toBeNull()
        expect(plegarSeccion({ ciclo: 'IV', turno: null, seccion: 'C' }, GRUPOS)).toBeNull()
    })
})

describe('seccionesDelEstudiante', () => {
    it('agrupa los cursos por grupo y cuenta cuántos lleva en cada uno (teoría + laboratorio = un solo grupo)', () => {
        const r = seccionesDelEstudiante({ ciclo: 'II', turno: 'M', seccion: 'A' }, [
            jp('1', 'II', 'M', 'A'), jp('1', 'II', 'M', 'A'), jp('1', 'II', 'M', 'A1'), jp('1', 'IV', 'T', 'B'),
        ], GRUPOS)
        expect(r.fuente).toBe('JP')
        expect(r.secciones).toEqual([
            { ciclo: 'II', seccion: 'A', turno: 'M', cursos: 3 },
            { ciclo: 'IV', seccion: 'B', turno: 'T', cursos: 1 },
        ])
        expect(r.sinGrupo).toEqual([])
    })

    it('las secciones de JP sin grupo se avisan y no cuentan; si ninguna sirve, queda la sección que ya tenía', () => {
        const r = seccionesDelEstudiante({ ciclo: 'I', turno: 'M', seccion: 'A' }, [jp('1', 'V', 'M', 'A')], GRUPOS)
        expect(r.fuente).toBe('PADRON')
        expect(r.sinGrupo).toEqual([{ ciclo: 'V', turno: 'M', seccion: 'A' }])
        expect(r.secciones).toEqual([{ ciclo: 'I', seccion: 'A', turno: 'M', cursos: 1 }])
    })

    it('sin matrícula en JP conserva su sección, plegada al grupo si se puede y tal cual si no', () => {
        expect(seccionesDelEstudiante({ ciclo: 'II', turno: 'M', seccion: 'A2' }, [], GRUPOS).secciones).toEqual([{ ciclo: 'II', seccion: 'A', turno: 'M', cursos: 1 }])
        expect(seccionesDelEstudiante({ ciclo: 'VI', turno: 'M', seccion: 'A' }, [], GRUPOS).secciones).toEqual([{ ciclo: 'VI', seccion: 'A', turno: 'M', cursos: 1 }])
    })
})

describe('seccionPrincipal', () => {
    it('es la de más cursos; a igualdad, la del ciclo mayor', () => {
        expect(seccionPrincipal([{ ciclo: 'II', seccion: 'B', turno: 'T', cursos: 1 }, { ciclo: 'VI', seccion: 'A1', turno: 'M', cursos: 6 }])).toMatchObject({ ciclo: 'VI' })
        expect(seccionPrincipal([{ ciclo: 'II', seccion: 'B', turno: 'T', cursos: 2 }, { ciclo: 'IV', seccion: 'B', turno: 'T', cursos: 2 }])).toMatchObject({ ciclo: 'IV' })
    })
})

describe('consolidarPadron: los estudiantes del padrón, repartidos según JP', () => {
    const matriculas = [
        jp('A1', 'VI', 'M', 'A1'), jp('A1', 'VI', 'M', 'A1'), jp('A1', 'II', 'T', 'B1'),
        jp('A2', 'II', 'M', 'A'), jp('A2', 'II', 'M', 'A2'),
        jp('A4', 'VI', 'T', 'B2', 'a4-otro-codigo@undc.edu.pe'),
        jp('SOLO', 'I', 'M', 'A'),
    ]
    const lista = [
        padron('A1', { ciclo: 'VI', turno: 'M', seccion: 'A' }),
        padron('A2', { ciclo: 'II', turno: 'M', seccion: 'A' }),
        padron('A3', { ciclo: 'III', turno: 'M', seccion: 'A' }),
        // Su código no está en JP, pero su correo sí: se cruza por correo
        padron('A4', { correo: 'a4-otro-codigo@undc.edu.pe', ciclo: 'VI', turno: 'T', seccion: 'B' }),
    ]
    const r = consolidarPadron(lista, matriculas, GRUPOS)

    it('todos los del padrón se quedan, con todas sus secciones y la principal en sus columnas', () => {
        expect(r.estudiantes.map((e) => e.codigo)).toEqual(['A1', 'A2', 'A3', 'A4'])
        const a1 = r.estudiantes[0]
        expect(a1.secciones.map((s) => [s.ciclo, s.seccion, s.cursos])).toEqual([['VI', 'A1', 2], ['II', 'B', 1]])
        expect(a1).toMatchObject({ ciclo: 'VI', seccion: 'A1', turno: 'M' })
        expect(r.estudiantes[1].secciones).toEqual([{ ciclo: 'II', seccion: 'A', turno: 'M', cursos: 2 }])
        expect(r.estudiantes[3]).toMatchObject({ ciclo: 'VI', seccion: 'B2', turno: 'T' })
    })

    it('conserva los datos del estudiante y quien no está en JP queda con su sección anterior (a III-A le toca su grupo)', () => {
        expect(r.estudiantes[2]).toMatchObject({ nombre: 'ALUMNO A3', documento: '60000001', ciclo: 'III', seccion: 'A' })
        expect(r.sinMatriculaEnJp).toEqual(['A3'])
    })

    it('cuenta a quienes están en varios grupos, los alumnos por grupo y los que solo están en JP (que no se agregan)', () => {
        expect(r.enVariosGrupos).toBe(1)
        expect(r.soloEnJp).toEqual(['SOLO'])
        expect(r.estudiantes.some((e) => e.codigo === 'SOLO')).toBe(false)
        expect(r.porGrupo.map((g) => [`${g.ciclo}-${g.seccion}`, g.alumnos])).toEqual([['II', 'A', 1], ['II', 'B', 1], ['III', 'A', 1], ['VI', 'A1', 1], ['VI', 'B2', 1]].map(([c, s, n]) => [`${c}-${s}`, n]))
    })

    it('avisa de los alumnos con secciones de JP que no tienen grupo', () => {
        const con = consolidarPadron([padron('B1')], [jp('B1', 'II', 'M', 'A'), jp('B1', 'V', 'M', 'A')], GRUPOS)
        expect(con.conSeccionSinGrupo).toEqual([{ codigo: 'B1', secciones: ['V-A'] }])
        expect(con.estudiantes[0].secciones).toEqual([{ ciclo: 'II', seccion: 'A', turno: 'M', cursos: 1 }])
    })
})

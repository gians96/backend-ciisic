import {
    claveDeNombre,
    construirPadronDeCursos,
    cursosParaGuardar,
    leerDocentesDni,
    planearDocentes,
    seccionesDeCursos,
    seccionesDelDocente,
    seccionPrincipal,
    type AsesorExistente,
    type CursoJp,
    type MatriculaJp,
} from '../../src/api/advisory/services/cursos-jp'
import type { EstudianteLeido } from '../../src/api/advisory/services/lector-excel'

const curso = (idCarga: number, nombre: string, ciclo: string, seccion: string, idDocente: number | null, docente: string | null, turno: string | null = 'M'): CursoJp =>
    ({ idCarga, codigo: `ISES${idCarga}`, nombre, ciclo, turno, seccion, idDocente, docente })

const CURSOS: CursoJp[] = [
    curso(100, 'PROGRAMACIÓN WEB', 'VI', 'A1', 10, 'DAGA CHACA MARISOL'),
    curso(101, 'DATA WAREHOUSE', 'VI', 'A1', 11, 'MUÑOZ MEZA GISSELA'),
    curso(102, 'REDES', 'II', 'B', 10, 'DAGA CHACA MARISOL', 'T'),
    curso(103, 'TALLER LIBRE', 'II', 'B', null, null, 'T'),
]

const matricula = (idCarga: number, codigo: string, nombre = `ALUMNO ${codigo}`, correo: string | null = null): MatriculaJp =>
    ({ idCarga, codigo, nombre, correo, celular: '920-301 747' })

const alumno = (codigo: string, extra: Partial<EstudianteLeido> = {}): EstudianteLeido => ({
    documento: '60000001', codigo, correo: `${codigo.toLowerCase()}@undc.edu.pe`, nombre: `ALUMNO ${codigo}`, celular: null, carrera: 'INGENIERÍA DE SISTEMAS',
    ciclo: 'I', turno: 'M', seccion: 'A', distrito: 'ILO', provincia: null, departamento: null, ...extra,
})

describe('leerDocentesDni', () => {
    it('lee los DNI (completa el cero que pierde Excel) y limpia el nombre', () => {
        expect(leerDocentesDni([{ dni: 2442123, nombre: '  FERREYROS  YUCRA JAIR ' }, { dni: '04081923', nombre: 'DAGA CHACA MARISOL' }]))
            .toEqual([{ dni: '02442123', nombre: 'FERREYROS YUCRA JAIR' }, { dni: '04081923', nombre: 'DAGA CHACA MARISOL' }])
    })

    it.each([
        ['no es una lista', {}, /lista/],
        ['lista vacía', [], /lista/],
        ['sin nombre', [{ dni: '04081923', nombre: ' ' }], /sin nombre/],
        ['DNI inválido', [{ dni: '123', nombre: 'DAGA CHACA MARISOL' }], /8 dígitos/],
        ['nombre repetido sin acentos ni mayúsculas', [{ dni: '04081923', nombre: 'Muñoz Meza' }, { dni: '12345678', nombre: 'MUNOZ MEZA' }], /repetido/],
        ['DNI repetido', [{ dni: '04081923', nombre: 'UNO' + 'AAA' }, { dni: '4081923', nombre: 'DOS BBB' }], /otro docente/],
    ])('rechaza: %s', (_motivo, entrada, mensaje) => {
        expect(() => leerDocentesDni(entrada)).toThrow(mensaje)
    })
})

describe('claveDeNombre', () => {
    it('ignora el título, el orden de las palabras, los acentos y las mayúsculas', () => {
        expect(claveDeNombre('DRA. MARISOL DAGA CHACA')).toBe(claveDeNombre('Daga Chaca, Marisol'))
        expect(claveDeNombre('MG. CÁRDENAS LINO CÉSAR ANDY')).toBe(claveDeNombre('CARDENAS LINO CESAR ANDY'))
        expect(claveDeNombre('MBA REYNOSO PALPA JENNY ROCIO')).not.toBe(claveDeNombre('REYNOSO PALPA JENNY'))
    })
})

describe('planearDocentes: los docentes de SIVIRENO y los que ya existen', () => {
    const existentes: AsesorExistente[] = [
        { id: 1, nombre: 'DRA. MARISOL DAGA CHACA', documento: null, jpDocenteId: null },
        { id: 2, nombre: 'DRA. GISELLA ELBIA MUÑOZ MEZA', documento: '42510728', jpDocenteId: null },
        { id: 3, nombre: 'MG. FUERA DE SIVIRENO', documento: '99999999', jpDocenteId: null },
    ]
    const dni = [
        { dni: '04081923', nombre: 'DAGA CHACA MARISOL' },
        { dni: '42510728', nombre: 'MUÑOZ MEZA GISSELA' },
        { dni: '11111111', nombre: 'NADIE EXISTE EN SIVIRENO' },
    ]

    it('enlaza a cada docente con el que ya existe (por su DNI o por su nombre sin título) y conserva su nombre', () => {
        const plan = planearDocentes(CURSOS, dni, existentes)
        expect(plan.docentes.map((d) => [d.jpId, d.nombre, d.cursos, d.dni, d.existente?.id ?? null, d.cambiaDocumento])).toEqual([
            [10, 'DAGA CHACA MARISOL', 2, '04081923', 1, true],
            [11, 'MUÑOZ MEZA GISSELA', 1, '42510728', 2, false],
        ])
        expect(plan.conflictos).toEqual([])
    })

    it('avisa de los DNI de la lista sin docente en SIVIRENO y de los docentes que no dictan cursos, y no los toca', () => {
        const plan = planearDocentes(CURSOS, dni, existentes)
        expect(plan.dniSinDocente.map((d) => d.dni)).toEqual(['11111111'])
        expect(plan.noEnlazados.map((a) => a.id)).toEqual([3])
    })

    it('un docente sin DNI en la lista ni en el panel queda sin DNI y se crea si no existe; los cursos sin docente no cuentan', () => {
        const plan = planearDocentes([...CURSOS, curso(104, 'ÉTICA', 'X', 'A', 12, 'OTRO DOCENTE NUEVO')], [], [])
        expect(plan.docentes).toHaveLength(3)
        const nuevo = plan.docentes.find((d) => d.jpId === 12)
        expect(nuevo).toMatchObject({ dni: null, existente: null, cambiaDocumento: false })
    })

    it('el enlace por id de SIVIRENO gana sobre el nombre y un DNI nuevo solo cambia lo que corresponde', () => {
        const ya: AsesorExistente[] = [{ id: 7, nombre: 'NOMBRE VIEJO DE OTRO', documento: '70000000', jpDocenteId: 10 }]
        const plan = planearDocentes(CURSOS, [{ dni: '04081923', nombre: 'DAGA CHACA MARISOL' }], ya)
        const daga = plan.docentes.find((d) => d.jpId === 10)
        expect(daga?.existente?.id).toBe(7)
        expect(daga?.cambiaDocumento).toBe(true)
    })

    it('un DNI que quedaría en dos docentes, o en uno que no es de SIVIRENO, es un conflicto', () => {
        // Daga ya está enlazada por su id de SIVIRENO; el DNI que le toca es el de otro asesor que no dicta cursos
        const choque = planearDocentes(
            CURSOS,
            [{ dni: '33334444', nombre: 'DAGA CHACA MARISOL' }],
            [{ id: 5, nombre: 'NOMBRE VIEJO', documento: '11112222', jpDocenteId: 10 }, { id: 6, nombre: 'MG. FUERA DE SIVIRENO', documento: '33334444', jpDocenteId: null }],
        )
        expect(choque.conflictos).toHaveLength(1)
        expect(choque.conflictos[0]).toMatch(/MG\. FUERA DE SIVIRENO/)
        // Quien tiene ese DNI y no está enlazado por otra vía es el mismo docente: se enlaza con él
        const mismo = planearDocentes(CURSOS, [{ dni: '99999999', nombre: 'DAGA CHACA MARISOL' }], existentes)
        expect(mismo.docentes.find((d) => d.jpId === 10)?.existente?.id).toBe(3)
        expect(mismo.conflictos).toEqual([])
        const repetido = planearDocentes(CURSOS, [{ dni: '04081923', nombre: 'DAGA CHACA MARISOL' }, { dni: '04081923', nombre: 'MUÑOZ MEZA GISSELA' }], [])
        expect(repetido.conflictos).toHaveLength(1)
    })
})

describe('secciones y sección principal', () => {
    it('una sección por ciclo y sección, con cuántos cursos lleva el alumno ahí', () => {
        expect(seccionesDeCursos([CURSOS[0], CURSOS[1], CURSOS[2]])).toEqual([
            { ciclo: 'II', seccion: 'B', turno: 'T', cursos: 1 },
            { ciclo: 'VI', seccion: 'A1', turno: 'M', cursos: 2 },
        ])
    })

    it('la principal es la de más cursos; a igualdad, la del ciclo mayor', () => {
        expect(seccionPrincipal(seccionesDeCursos([CURSOS[0], CURSOS[1], CURSOS[2]]))).toMatchObject({ ciclo: 'VI', seccion: 'A1' })
        expect(seccionPrincipal(seccionesDeCursos([CURSOS[0], CURSOS[2]]))).toMatchObject({ ciclo: 'VI' })
    })

    it('las secciones de un docente salen de sus cursos, sin repetir', () => {
        expect(seccionesDelDocente(CURSOS, 10)).toEqual([{ ciclo: 'II', seccion: 'B' }, { ciclo: 'VI', seccion: 'A1' }])
        expect(seccionesDelDocente(CURSOS, 99)).toEqual([])
    })
})

describe('construirPadronDeCursos', () => {
    const padron = [
        alumno('A1', { ciclo: 'I', seccion: 'A' }),
        alumno('B1'),
        // Su código no está en SIVIRENO, pero su correo sí
        alumno('C1', { correo: 'c1.jp@undc.edu.pe', ciclo: 'III', seccion: 'A' }),
    ]
    const matriculas = [
        matricula(100, 'A1'), matricula(101, 'a1'), matricula(102, 'A1'), matricula(100, 'A1'),
        matricula(102, 'XX99', 'ALUMNO NUEVO', 'xx99@undc.edu.pe'),
        matricula(101, 'JP-C1', 'ALUMNO C1', 'c1.jp@undc.edu.pe'),
        matricula(999, 'A1'),
    ]
    const r = construirPadronDeCursos(padron, CURSOS, matriculas, 'INGENIERÍA DE SISTEMAS')
    const de = (codigo: string) => r.estudiantes.find((e) => e.codigo === codigo)

    it('todos los del padrón se quedan, con sus cursos, sus secciones y su sección principal', () => {
        expect(r.estudiantes.map((e) => e.codigo)).toEqual(['A1', 'B1', 'C1', 'XX99'])
        expect(de('A1')?.matriculas).toEqual([100, 101, 102])
        expect(de('A1')?.secciones.map((s) => [s.ciclo, s.seccion, s.cursos])).toEqual([['II', 'B', 1], ['VI', 'A1', 2]])
        expect(de('A1')).toMatchObject({ ciclo: 'VI', seccion: 'A1', turno: 'M', documento: '60000001', distrito: 'ILO' })
        expect(r.enVariasSecciones).toBe(1)
    })

    it('quien no tiene matrícula conserva su sección anterior y se avisa; no se cuenta dos veces un curso repetido', () => {
        expect(r.sinCursos).toEqual(['B1'])
        expect(de('B1')).toMatchObject({ ciclo: 'I', seccion: 'A', matriculas: [], secciones: [{ ciclo: 'I', seccion: 'A', turno: 'M', cursos: 1 }] })
        expect(r.alumnosPorCurso.get(100)).toBe(1)
    })

    it('cruza por correo cuando el código no coincide', () => {
        expect(de('C1')?.matriculas).toEqual([101])
        expect(r.agregados).not.toContain('JP-C1')
    })

    it('agrega a los matriculados que faltan en el padrón (sin DNI) y cuenta las matrículas huérfanas', () => {
        expect(r.agregados).toEqual(['XX99'])
        expect(de('XX99')).toMatchObject({ documento: '', nombre: 'ALUMNO NUEVO', correo: 'xx99@undc.edu.pe', celular: '920301747', carrera: 'INGENIERÍA DE SISTEMAS', ciclo: 'II', seccion: 'B' })
        expect(r.matriculasHuerfanas).toBe(1)
    })

    it('cuenta cuántos alumnos tiene cada curso', () => {
        expect([...r.alumnosPorCurso].sort((a, b) => a[0] - b[0])).toEqual([[100, 1], [101, 2], [102, 2]])
    })
})

describe('cursosParaGuardar', () => {
    it('lleva cada curso con el asesor de su docente (o sin él) y los textos limpios', () => {
        const guardados = cursosParaGuardar([...CURSOS, curso(105, '  TALLER   DE TESIS ', 'x', 'a1', 10, 'DAGA   CHACA MARISOL', null)], new Map([[10, 70], [11, 71]]))
        expect(guardados[0]).toEqual({ jpCargaId: 100, codigo: 'ISES100', nombre: 'PROGRAMACIÓN WEB', ciclo: 'VI', turno: 'M', seccion: 'A1', asesorId: 70, docenteNombre: 'DAGA CHACA MARISOL' })
        expect(guardados[3]).toMatchObject({ jpCargaId: 103, asesorId: null, docenteNombre: null })
        expect(guardados[4]).toMatchObject({ nombre: 'TALLER DE TESIS', ciclo: 'X', seccion: 'A1', turno: null, asesorId: 70, docenteNombre: 'DAGA CHACA MARISOL' })
    })
})

import type { EstudiantePadron } from './importacion'
import {
    claveSeccion,
    compararCiclos,
    compararSecciones,
    etiquetaSeccion,
    normalizarCodigo,
    normalizarCorreo,
    type SeccionEstudiante,
} from './seguimiento'

/**
 * Secciones de los estudiantes a partir de las matrículas de JP (spec 033). Todo es puro (sin BD) para probarlo:
 * `src/database/sincronizarPadronJp.ts` solo lee JP y el padrón y guarda lo que esto devuelve.
 *
 * La sección va ligada al **curso**: una matrícula de JP es (alumno, curso) y el curso tiene ciclo, turno y sección. La
 * designación de asesores usa **grupos** más gruesos (`II-A`, no `II-A1`), así que cada sección de JP se «pliega» a un grupo.
 */

/** Ciclo, sección y turno (`M`, `T`, `N`) de un grupo de asesoría; es el de la designación de docentes. */
export interface GrupoAsesoria {
    ciclo: string
    seccion: string
    turno: string | null
}

/** Una matrícula de JP: un alumno en un curso, con la sección de ese curso. */
export interface MatriculaJp {
    codigo: string
    correo?: string | null
    ciclo: string
    turno: string | null
    seccion: string
}

const mayus = (valor: string | null | undefined) => (valor ?? '').trim().toUpperCase()

/**
 * Grupo de asesoría de una sección de JP, o `null` si no hay (queda sin asesor). En orden:
 * 1. coincide exacto (`VI-A1`);
 * 2. quitando los dígitos finales (`II-A1` → `II-A`);
 * 3. mismo ciclo y turno, si la designación tiene **un solo** grupo ahí (`IV-C` de la tarde → `IV-B`).
 */
export function plegarSeccion(origen: { ciclo: string, turno: string | null, seccion: string }, grupos: readonly GrupoAsesoria[]): GrupoAsesoria | null {
    const ciclo = mayus(origen.ciclo)
    const seccion = mayus(origen.seccion)
    const exacto = grupos.find((g) => claveSeccion(g.ciclo, g.seccion) === claveSeccion(ciclo, seccion))
    if (exacto) return exacto
    const sinDigitos = seccion.replace(/\d+$/, '')
    if (sinDigitos && sinDigitos !== seccion) {
        const delGrupo = grupos.find((g) => claveSeccion(g.ciclo, g.seccion) === claveSeccion(ciclo, sinDigitos))
        if (delGrupo) return delGrupo
    }
    const turno = mayus(origen.turno)
    if (turno) {
        const delTurno = grupos.filter((g) => mayus(g.ciclo) === ciclo && mayus(g.turno) === turno)
        if (delTurno.length === 1) return delTurno[0]
    }
    return null
}

/** La sección «principal»: la de más cursos; a igualdad, la del ciclo mayor y luego la de nombre menor. */
export function seccionPrincipal(secciones: readonly SeccionEstudiante[]): SeccionEstudiante {
    return [...secciones].sort((a, b) => b.cursos - a.cursos || compararCiclos(b.ciclo, a.ciclo) || compararSecciones(a.seccion, b.seccion))[0]
}

export interface SeccionesCalculadas {
    secciones: SeccionEstudiante[]
    /** De dónde salen: las matrículas de JP o, sin ellas, la sección que ya tenía el estudiante en el padrón. */
    fuente: 'JP' | 'PADRON'
    /** Secciones de JP que no se pudieron plegar a ningún grupo (el alumno queda sin asesor en ellas). */
    sinGrupo: Array<{ ciclo: string, turno: string | null, seccion: string }>
}

/**
 * Secciones de un estudiante: una por grupo en que tiene cursos, con cuántos. Sin matrículas en JP (o si ninguna se puede
 * plegar) se conserva la sección que ya tenía en el padrón, plegada si se puede y tal cual si no.
 */
export function seccionesDelEstudiante(
    actual: { ciclo: string, turno: string | null, seccion: string },
    matriculas: readonly MatriculaJp[],
    grupos: readonly GrupoAsesoria[],
): SeccionesCalculadas {
    const porGrupo = new Map<string, SeccionEstudiante>()
    const sinGrupo: SeccionesCalculadas['sinGrupo'] = []
    for (const m of matriculas) {
        const grupo = plegarSeccion(m, grupos)
        if (!grupo) {
            sinGrupo.push({ ciclo: mayus(m.ciclo), turno: m.turno ? mayus(m.turno) : null, seccion: mayus(m.seccion) })
            continue
        }
        const clave = claveSeccion(grupo.ciclo, grupo.seccion)
        const hallado = porGrupo.get(clave)
        if (hallado) hallado.cursos += 1
        else porGrupo.set(clave, { ciclo: grupo.ciclo, seccion: grupo.seccion, turno: grupo.turno, cursos: 1 })
    }
    if (porGrupo.size) return { secciones: [...porGrupo.values()], fuente: 'JP', sinGrupo }

    const grupo = plegarSeccion(actual, grupos)
    const propia: SeccionEstudiante = grupo
        ? { ciclo: grupo.ciclo, seccion: grupo.seccion, turno: grupo.turno, cursos: 1 }
        : { ciclo: mayus(actual.ciclo), seccion: mayus(actual.seccion), turno: actual.turno, cursos: 1 }
    return { secciones: [propia], fuente: 'PADRON', sinGrupo }
}

export interface ResultadoConsolidacion {
    /** Los estudiantes del padrón actual, cada uno con todas sus secciones y la principal en sus columnas. */
    estudiantes: EstudiantePadron[]
    /** Alumnos del padrón que se quedaron con su sección anterior por no tener matrícula en JP. */
    sinMatriculaEnJp: string[]
    /** Alumnos con matrícula en JP pero alguna sección sin grupo: código y secciones. */
    conSeccionSinGrupo: Array<{ codigo: string, secciones: string[] }>
    /** Alumnos del padrón con secciones en más de un grupo. */
    enVariosGrupos: number
    /** Códigos con matrícula en JP que **no** están en el padrón (no se agregan). */
    soloEnJp: string[]
    /** Cuántos alumnos hay en cada grupo (uno cuenta en todos los que cursa). */
    porGrupo: Array<{ ciclo: string, seccion: string, alumnos: number }>
}

/**
 * Reparte a los estudiantes del padrón actual (todos son de la matrícula del semestre y **todos se quedan**) en las secciones
 * que dicen sus matrículas de JP. Cruza por código de estudiante y, si JP no lo trae, por correo. No agrega estudiantes: JP solo
 * dice en qué secciones cursa cada uno.
 */
export function consolidarPadron(
    padron: readonly EstudiantePadron[],
    matriculas: readonly MatriculaJp[],
    grupos: readonly GrupoAsesoria[],
): ResultadoConsolidacion {
    const porCodigo = new Map<string, MatriculaJp[]>()
    const porCorreo = new Map<string, MatriculaJp[]>()
    const agregar = (mapa: Map<string, MatriculaJp[]>, clave: string, m: MatriculaJp) => {
        if (clave) mapa.set(clave, [...(mapa.get(clave) ?? []), m])
    }
    for (const m of matriculas) {
        agregar(porCodigo, normalizarCodigo(m.codigo), m)
        agregar(porCorreo, normalizarCorreo(m.correo), m)
    }

    const sinMatriculaEnJp: string[] = []
    const conSeccionSinGrupo: ResultadoConsolidacion['conSeccionSinGrupo'] = []
    const alumnosPorGrupo = new Map<string, { ciclo: string, seccion: string, alumnos: number }>()
    const usadas = new Set<string>()
    let enVariosGrupos = 0

    const estudiantes = padron.map((e): EstudiantePadron => {
        const codigo = normalizarCodigo(e.codigo)
        const propias = porCodigo.get(codigo) ?? porCorreo.get(normalizarCorreo(e.correo)) ?? []
        for (const m of propias) usadas.add(normalizarCodigo(m.codigo))
        const calculadas = seccionesDelEstudiante(e, propias, grupos)
        if (calculadas.fuente === 'PADRON') sinMatriculaEnJp.push(e.codigo)
        if (calculadas.sinGrupo.length) conSeccionSinGrupo.push({ codigo: e.codigo, secciones: calculadas.sinGrupo.map((s) => etiquetaSeccion(s.ciclo, s.seccion)) })
        if (calculadas.secciones.length > 1) enVariosGrupos += 1
        for (const s of calculadas.secciones) {
            const clave = claveSeccion(s.ciclo, s.seccion)
            const grupo = alumnosPorGrupo.get(clave) ?? { ciclo: s.ciclo, seccion: s.seccion, alumnos: 0 }
            grupo.alumnos += 1
            alumnosPorGrupo.set(clave, grupo)
        }
        const principal = seccionPrincipal(calculadas.secciones)
        return { ...e, ciclo: principal.ciclo, turno: principal.turno, seccion: principal.seccion, secciones: calculadas.secciones }
    })

    const codigosEnJp = new Set(matriculas.map((m) => normalizarCodigo(m.codigo)))
    return {
        estudiantes,
        sinMatriculaEnJp,
        conSeccionSinGrupo,
        enVariosGrupos,
        soloEnJp: [...codigosEnJp].filter((codigo) => !usadas.has(codigo)).sort(),
        porGrupo: [...alumnosPorGrupo.values()].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion)),
    }
}

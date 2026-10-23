import type { CursoPadron, EstudiantePadron } from './importacion'
import type { EstudianteLeido } from './lector-excel'
import {
    claveDeTexto,
    compararCiclos,
    compararSecciones,
    etiquetaSeccion,
    limpiarNombreAsesor,
    normalizarCodigo,
    normalizarCorreo,
    normalizarDni,
    type SeccionEstudiante,
} from './seguimiento'

/**
 * Cursos, matrículas y docentes de SIVIRENO (programación académica, sincronizada en JP) para el seguimiento (spec 034). Todo es puro
 * (sin BD) para probarlo: `src/database/sincronizarPadronJp.ts` solo lee JP y el padrón y guarda lo que esto devuelve.
 *
 * Un **curso** es una carga lectiva de SIVIRENO (asignatura + ciclo + sección + turno + docente); sus alumnos son los matriculados. Un alumno
 * puede estar en varios cursos y repetir. El **docente** de cada curso es el asesor de sus alumnos.
 */

/** Una carga lectiva de JP (`sivireno_carga_lectiva`). */
export interface CursoJp {
    idCarga: number
    codigo: string
    nombre: string
    ciclo: string
    turno: string | null
    seccion: string
    /** `null` si SIVIRENO no tiene docente asignado al curso. */
    idDocente: number | null
    docente: string | null
    /** Alumnos que SIVIRENO dice tener (`cantidad_estudiantes`), para compararlo con las matrículas. */
    declarados?: number | null
}

/** Una matrícula de JP (`sivireno_matricula`): un alumno en una carga lectiva. */
export interface MatriculaJp {
    idCarga: number
    codigo: string
    nombre: string
    correo: string | null
    celular: string | null
}

// ─── Docentes ───────────────────────────────────────────────────────────────

/** DNI de un docente tal como lo da la facultad (su nombre es el de SIVIRENO: «APELLIDOS NOMBRES»). */
export interface DocenteDni {
    dni: string
    nombre: string
}

/** Valida el JSON de DNI de docentes (`[{ "dni": "…", "nombre": "…" }]`); ante cualquier problema lanza un `Error` y no se escribe nada. */
export function leerDocentesDni(bruto: unknown): DocenteDni[] {
    if (!Array.isArray(bruto) || !bruto.length) throw new Error('El archivo de docentes debe ser una lista con al menos un docente: [{ "dni": "…", "nombre": "…" }]')
    const nombres = new Set<string>()
    const dnis = new Set<string>()
    return bruto.map((item): DocenteDni => {
        if (typeof item !== 'object' || item === null) throw new Error('Cada docente debe ser un objeto con «dni» y «nombre»')
        const fila = item as Record<string, unknown>
        const nombre = limpiarNombreAsesor(fila.nombre)
        if (nombre.length < 3) throw new Error('Hay un docente sin nombre')
        const dni = normalizarDni(fila.dni)
        if (!dni) throw new Error(`${nombre}: el DNI debe tener 8 dígitos`)
        if (nombres.has(claveDeTexto(nombre))) throw new Error(`${nombre} está repetido`)
        if (dnis.has(dni)) throw new Error(`${nombre}: su DNI ya es de otro docente de la lista`)
        nombres.add(claveDeTexto(nombre))
        dnis.add(dni)
        return { dni, nombre }
    })
}

const TITULOS = new Set(['dr', 'dra', 'mg', 'mgtr', 'mba', 'ing', 'lic', 'phd', 'msc', 'mag', 'abog', 'econ'])

/** Nombre sin título y sin importar el orden de las palabras: «DRA. MARISOL DAGA CHACA» y «DAGA CHACA MARISOL» dan la misma clave. */
export function claveDeNombre(valor: unknown): string {
    return claveDeTexto(String(valor ?? '').replace(/[.,]/g, ' '))
        .split(' ')
        .filter((palabra) => palabra && !TITULOS.has(palabra))
        .sort()
        .join(' ')
}

/** Un docente que ya existe en el evento (tabla `asesores`). */
export interface AsesorExistente {
    id: number
    nombre: string
    documento: string | null
    jpDocenteId: number | null
}

export interface DocentePlan {
    jpId: number
    /** Nombre en SIVIRENO. */
    nombre: string
    cursos: number
    /** DNI de la lista de la facultad; `null` = no hay (se conserva el que ya tenga). */
    dni: string | null
    /** `null`: no existe y se crea. */
    existente: AsesorExistente | null
    cambiaDocumento: boolean
}

export interface PlanDocentes {
    docentes: DocentePlan[]
    /** DNI de la lista que no corresponden a ningún docente de SIVIRENO. */
    dniSinDocente: DocenteDni[]
    /** Docentes que ya existían y no son de ningún curso de SIVIRENO: no se tocan. */
    noEnlazados: AsesorExistente[]
    /** Problemas que impiden aplicar (un DNI que quedaría en dos docentes). */
    conflictos: string[]
}

/**
 * Empareja a los docentes de SIVIRENO (por `id_docente`) con los que ya existen y con su DNI. Un docente existente se enlaza por su
 * `jp_docente_id`, luego por su DNI y por último por su nombre (sin título ni orden); conserva su nombre, su DNI y su enlace. Los que no existen se crean.
 */
export function planearDocentes(cursos: readonly CursoJp[], docentesDni: readonly DocenteDni[], existentes: readonly AsesorExistente[]): PlanDocentes {
    const delJp = new Map<number, { jpId: number, nombre: string, cursos: number }>()
    for (const curso of cursos) {
        if (curso.idDocente === null) continue
        const hallado = delJp.get(curso.idDocente) ?? { jpId: curso.idDocente, nombre: limpiarNombreAsesor(curso.docente), cursos: 0 }
        hallado.cursos += 1
        delJp.set(curso.idDocente, hallado)
    }

    const dniPorClave = new Map(docentesDni.map((d) => [claveDeNombre(d.nombre), d.dni]))
    const dniAsignados = new Set<string>()
    const usados = new Set<number>()
    const docentes = [...delJp.values()]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .map((docente): DocentePlan => {
            const dni = dniPorClave.get(claveDeNombre(docente.nombre)) ?? null
            if (dni) dniAsignados.add(dni)
            const libre = (e: AsesorExistente | undefined) => (e && !usados.has(e.id) ? e : undefined)
            const existente = libre(existentes.find((e) => e.jpDocenteId === docente.jpId))
                ?? libre(dni ? existentes.find((e) => e.documento === dni) : undefined)
                ?? libre(existentes.find((e) => e.jpDocenteId === null && claveDeNombre(e.nombre) === claveDeNombre(docente.nombre)))
                ?? null
            if (existente) usados.add(existente.id)
            return { ...docente, dni, existente, cambiaDocumento: dni !== null && dni !== (existente?.documento ?? null) }
        })

    const noEnlazados = existentes.filter((e) => !usados.has(e.id))
    const conflictos: string[] = []
    const documentos = new Map<string, string>()
    for (const docente of docentes) {
        const documento = docente.dni ?? docente.existente?.documento ?? null
        if (!documento) continue
        const otro = documentos.get(documento)
        if (otro) conflictos.push(`El DNI de ${docente.nombre} es el mismo que el de ${otro}.`)
        documentos.set(documento, docente.nombre)
    }
    for (const ajeno of noEnlazados) {
        const dueno = ajeno.documento ? documentos.get(ajeno.documento) : undefined
        if (dueno) conflictos.push(`El DNI de ${dueno} ya está registrado para ${ajeno.nombre}, que no es de ningún curso de SIVIRENO.`)
    }
    return { docentes, dniSinDocente: docentesDni.filter((d) => !dniAsignados.has(d.dni)), noEnlazados, conflictos }
}

// ─── Estudiantes, cursos y matrículas ───────────────────────────────────────

/** La sección «principal» de un alumno: la de más cursos; a igualdad, la del ciclo mayor y luego la de nombre menor. */
export function seccionPrincipal(secciones: readonly SeccionEstudiante[]): SeccionEstudiante {
    return [...secciones].sort((a, b) => b.cursos - a.cursos || compararCiclos(b.ciclo, a.ciclo) || compararSecciones(a.seccion, b.seccion))[0]
}

/** Secciones en que cursa un alumno según sus cursos: una por ciclo y sección, con cuántos cursos lleva en ella. */
export function seccionesDeCursos(cursos: readonly CursoJp[]): SeccionEstudiante[] {
    const porClave = new Map<string, SeccionEstudiante>()
    for (const curso of cursos) {
        const clave = `${curso.ciclo.trim().toUpperCase()}|${curso.seccion.trim().toUpperCase()}`
        const hallada = porClave.get(clave)
        if (hallada) hallada.cursos += 1
        else porClave.set(clave, { ciclo: curso.ciclo.trim().toUpperCase(), seccion: curso.seccion.trim().toUpperCase(), turno: curso.turno ? curso.turno.trim().toUpperCase() : null, cursos: 1 })
    }
    return [...porClave.values()].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))
}

export interface ResultadoPadronCursos {
    /** Los estudiantes del padrón (y los de SIVIRENO que faltaban) con sus secciones, su sección principal y los cursos en que están matriculados. */
    estudiantes: EstudiantePadron[]
    /** Códigos del padrón que no tienen matrícula en SIVIRENO: conservan su sección anterior y no tienen docente. */
    sinCursos: string[]
    /** Códigos de SIVIRENO que no estaban en el padrón y se agregaron (sin DNI: se cruzan por código y correo). */
    agregados: string[]
    /** Matrículas ignoradas por apuntar a un curso que no se leyó. */
    matriculasHuerfanas: number
    /** Alumnos matriculados en más de una sección. */
    enVariasSecciones: number
    /** Cuántos alumnos tiene cada curso (`idCarga` → alumnos), para compararlo con SIVIRENO. */
    alumnosPorCurso: Map<number, number>
}

const soloDigitos = (valor: string | null) => (valor ? valor.replace(/[^\d+]/g, '') : '')
const recortar = (valor: string, largo: number) => (valor.length > largo ? valor.slice(0, largo) : valor)

/**
 * Reparte a los estudiantes en los cursos de SIVIRENO. Los estudiantes son los del padrón actual (con su DNI, que SIVIRENO no trae) más los
 * matriculados que falten; cruza por código de estudiante y, si SIVIRENO no lo trae, por correo. Sus secciones salen de sus cursos y su
 * sección principal es la de más cursos. Quien no tiene matrícula se queda con su sección anterior.
 */
export function construirPadronDeCursos(
    padron: readonly EstudianteLeido[],
    cursos: readonly CursoJp[],
    matriculas: readonly MatriculaJp[],
    carrera: string,
): ResultadoPadronCursos {
    const cursoPorId = new Map(cursos.map((c) => [c.idCarga, c]))
    let matriculasHuerfanas = 0
    const porCodigo = new Map<string, { muestra: MatriculaJp, cargas: Set<number> }>()
    const porCorreo = new Map<string, string>()
    for (const m of matriculas) {
        if (!cursoPorId.has(m.idCarga)) {
            matriculasHuerfanas += 1
            continue
        }
        const codigo = normalizarCodigo(m.codigo)
        const hallado = porCodigo.get(codigo) ?? { muestra: m, cargas: new Set<number>() }
        hallado.cargas.add(m.idCarga)
        porCodigo.set(codigo, hallado)
        const correo = normalizarCorreo(m.correo)
        if (correo) porCorreo.set(correo, codigo)
    }

    const usados = new Set<string>()
    const alumnosPorCurso = new Map<number, number>()
    let enVariasSecciones = 0
    const sinCursos: string[] = []
    const conCursos = (base: EstudianteLeido, cargas: ReadonlySet<number>): EstudiantePadron => {
        const suyos = [...cargas].map((id) => cursoPorId.get(id)).filter((c): c is CursoJp => c !== undefined)
        const secciones = seccionesDeCursos(suyos)
        const principal = seccionPrincipal(secciones)
        if (secciones.length > 1) enVariasSecciones += 1
        for (const id of cargas) alumnosPorCurso.set(id, (alumnosPorCurso.get(id) ?? 0) + 1)
        return { ...base, ciclo: principal.ciclo, turno: principal.turno, seccion: principal.seccion, secciones, matriculas: [...cargas].sort((a, b) => a - b) }
    }

    const estudiantes = padron.map((base): EstudiantePadron => {
        const codigo = normalizarCodigo(base.codigo)
        const clave = porCodigo.has(codigo) ? codigo : porCorreo.get(normalizarCorreo(base.correo))
        const matriculado = clave ? porCodigo.get(clave) : undefined
        if (!clave || !matriculado) {
            sinCursos.push(base.codigo)
            return { ...base, secciones: [{ ciclo: base.ciclo, seccion: base.seccion, turno: base.turno, cursos: 1 }], matriculas: [] }
        }
        usados.add(clave)
        return conCursos(base, matriculado.cargas)
    })

    const agregados: string[] = []
    for (const [codigo, { muestra, cargas }] of porCodigo) {
        if (usados.has(codigo)) continue
        agregados.push(codigo)
        const nuevo: EstudianteLeido = {
            documento: '',
            codigo: recortar(codigo, 20),
            correo: muestra.correo ? recortar(normalizarCorreo(muestra.correo), 191) : null,
            nombre: recortar(muestra.nombre.replace(/\s+/g, ' ').trim(), 200),
            celular: soloDigitos(muestra.celular) ? recortar(soloDigitos(muestra.celular), 20) : null,
            carrera,
            ciclo: '',
            turno: null,
            seccion: '',
            distrito: null,
            provincia: null,
            departamento: null,
        }
        estudiantes.push(conCursos(nuevo, cargas))
    }

    return { estudiantes, sinCursos, agregados, matriculasHuerfanas, enVariasSecciones, alumnosPorCurso }
}

/** Cursos listos para guardar, cada uno con el `Asesor` de su docente. */
export function cursosParaGuardar(cursos: readonly CursoJp[], asesorIdPorDocenteJp: ReadonlyMap<number, number>): CursoPadron[] {
    return cursos.map((c) => ({
        jpCargaId: c.idCarga,
        codigo: recortar(c.codigo.trim(), 30),
        nombre: recortar(c.nombre.replace(/\s+/g, ' ').trim(), 200),
        ciclo: recortar(c.ciclo.trim().toUpperCase(), 10),
        turno: c.turno ? recortar(c.turno.trim().toUpperCase(), 5) : null,
        seccion: recortar(c.seccion.trim().toUpperCase(), 10),
        asesorId: c.idDocente === null ? null : (asesorIdPorDocenteJp.get(c.idDocente) ?? null),
        docenteNombre: c.docente ? recortar(limpiarNombreAsesor(c.docente), 200) : null,
    }))
}

/** Ciclos y secciones en que dicta un docente (sin repetir, en orden académico): lo que se guarda en `asesores_secciones`. */
export function seccionesDelDocente(cursos: readonly CursoJp[], idDocente: number): Array<{ ciclo: string, seccion: string }> {
    return seccionesDeCursos(cursos.filter((c) => c.idDocente === idDocente)).map(({ ciclo, seccion }) => ({ ciclo, seccion }))
}

/** «VI-A1» de un curso, para los avisos. */
export const etiquetaDeCurso = (curso: Pick<CursoJp, 'ciclo' | 'seccion'>) => etiquetaSeccion(curso.ciclo, curso.seccion)

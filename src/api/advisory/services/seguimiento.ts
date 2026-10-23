/**
 * Seguimiento por asesor (spec 025): cruza el padrón de estudiantes con las inscripciones del evento
 * y lo resume por ciclo, sección y asesor. Todo es puro (sin BD) para probarlo y para que las
 * exportaciones usen exactamente las mismas cuentas que las pantallas.
 */

/**
 * Situación de pago de un estudiante del padrón. `PAGADO` es solo una inscripción aprobada: un voucher
 * enviado que el tesorero aún no valida es `EN_REVISION` y uno rechazado o cancelado, `RECHAZADO`.
 */
export const SITUACIONES = ['PAGADO', 'EN_REVISION', 'RECHAZADO', 'SIN_INSCRIPCION'] as const
export type Situacion = typeof SITUACIONES[number]

/** Filtro de situación: una de las cuatro o `NO_PAGADO` (todas menos `PAGADO`). */
export const FILTROS_SITUACION = [...SITUACIONES, 'NO_PAGADO'] as const
export type FiltroSituacion = typeof FILTROS_SITUACION[number]

export const ETIQUETA_SITUACION: Readonly<Record<Situacion, string>> = {
    PAGADO: 'Pagó',
    EN_REVISION: 'En revisión',
    RECHAZADO: 'Rechazado',
    SIN_INSCRIPCION: 'Sin inscripción',
}

export interface AsesorRef {
    id: number
    nombre: string
}

export interface AsesorConSecciones extends AsesorRef {
    secciones: Array<{ ciclo: string, seccion: string }>
}

/**
 * Ciclo y sección (grupo de asesoría) en que cursa un estudiante (spec 033). La sección va ligada al curso: un alumno
 * puede estar en varias (teoría y laboratorio, o un curso repetido de otro ciclo); `cursos` es cuántos lleva en esa.
 */
export interface SeccionEstudiante {
    ciclo: string
    seccion: string
    turno: string | null
    cursos: number
}

/** Una sección del estudiante con los asesores que la atienden. */
export interface SeccionDeFila extends SeccionEstudiante {
    asesores: AsesorRef[]
}

/**
 * Un curso de SIVIRENO (programación académica) en que está matriculado un estudiante (spec 034): asignatura, ciclo, sección,
 * turno y el docente que lo dicta. `id` es el del curso en `padron_cursos`.
 */
export interface CursoEstudiante {
    id: number
    codigo: string
    nombre: string
    ciclo: string
    seccion: string
    turno: string | null
    docente: AsesorRef | null
}

export interface EstudianteBase {
    id: number
    documento: string
    codigo: string
    correo: string | null
    nombre: string
    celular: string | null
    carrera: string
    /** Ciclo, turno y sección **principales**; las demás están en `secciones`. */
    ciclo: string
    turno: string | null
    seccion: string
    /** Todas las secciones en que cursa. Ausente o vacía = solo la principal (padrones anteriores a la spec 033). */
    secciones?: readonly SeccionEstudiante[]
    /**
     * Los cursos de SIVIRENO en que está matriculado (spec 034). Con ellos, sus secciones y sus asesores salen de los cursos
     * (el docente de cada curso) y `secciones` se ignora; ausente o vacío = padrón del Excel, que sigue por secciones.
     */
    cursos?: readonly CursoEstudiante[]
}

/** Lo que el seguimiento necesita de una inscripción del evento. */
export interface InscripcionBase {
    id: number
    /** Código del estado (`APROBADO`, `PENDIENTE`…). */
    estado: string
    monto: number | null
    fechaPago: Date | null
    /** Documento del participante (solo si es DNI). */
    documento: string | null
    correo: string | null
    codigoEstudiante: string | null
}

/** Con qué dato se encontró la inscripción de un estudiante. */
export type Coincidencia = 'DOCUMENTO' | 'CODIGO' | 'CORREO'

export interface FilaSeguimiento {
    id: number
    codigo: string
    documento: string
    nombre: string
    correo: string | null
    celular: string | null
    carrera: string
    /** Ciclo, turno y sección principales (en un reporte filtrado, la primera sección dentro del alcance). */
    ciclo: string
    turno: string | null
    seccion: string
    /** Todas sus secciones (la principal primero), cada una con sus asesores; en un reporte filtrado, solo las del alcance. */
    secciones: SeccionDeFila[]
    /** Sus cursos de SIVIRENO con el docente de cada uno (spec 034); en un reporte filtrado, solo los del alcance. Vacío si el padrón viene del Excel. */
    cursos: CursoEstudiante[]
    /** Asesores de todas sus secciones (o los docentes de todos sus cursos), sin repetir. */
    asesores: AsesorRef[]
    situacion: Situacion
    /** Código del estado de la inscripción (`APROBADO`…), `null` si no se inscribió. */
    estadoInscripcion: string | null
    inscripcionId: number | null
    coincidencia: Coincidencia | null
    /** Monto de la inscripción. `null` sin inscripción o sin «pagos.ver». */
    monto: number | null
    /** `YYYY-MM-DD`. `null` sin inscripción o sin «pagos.ver». */
    fechaPago: string | null
}

export interface Contadores {
    alumnos: number
    pagaron: number
    enRevision: number
    rechazados: number
    sinInscripcion: number
    /** Todos los que no tienen la inscripción aprobada. */
    noPagaron: number
    /** `pagaron / alumnos` (0 a 1). */
    avance: number
    /** Suma de lo aprobado. `null` sin «pagos.ver». */
    recaudado: number | null
}

export interface ResumenCiclo extends Contadores {
    ciclo: string
}

export interface ResumenSeccion extends Contadores {
    ciclo: string
    seccion: string
    turnos: string[]
    asesores: AsesorRef[]
}

export interface ResumenAsesor extends Contadores {
    id: number
    nombre: string
    secciones: Array<{ ciclo: string, seccion: string }>
}

/** Un curso de SIVIRENO con cuántos de sus matriculados pagaron (spec 034). */
export interface ResumenCurso extends Contadores {
    id: number
    codigo: string
    nombre: string
    ciclo: string
    seccion: string
    turno: string | null
    docente: AsesorRef | null
}

export interface ResumenSeguimiento {
    totales: Contadores
    porCiclo: ResumenCiclo[]
    porSeccion: ResumenSeccion[]
    porAsesor: ResumenAsesor[]
    /** Los cursos de SIVIRENO de las filas dadas, cada uno con sus matriculados (vacío si el padrón viene del Excel). */
    porCurso: ResumenCurso[]
    /** Estudiantes cuyo ciclo y sección no tienen ningún asesor. */
    alumnosSinAsesor: number
}

export interface FiltrosSeguimiento {
    asesorId?: number
    /** Un curso de SIVIRENO (`padron_cursos.id`): sus matriculados (spec 034). */
    cursoId?: number
    ciclo?: string
    seccion?: string
    turno?: string
    situacion?: FiltroSituacion
    q?: string
}

// ─── Normalización ──────────────────────────────────────────────────────────

function sinAcentos(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Texto para comparar y buscar: sin acentos, en minúsculas y con espacios simples. */
export function claveDeTexto(valor: unknown): string {
    return sinAcentos(String(valor ?? '')).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Documento comparable. Excel pierde el cero inicial de un DNI (`02442123` llega como `2442123`): hasta
 * ocho dígitos se completa a ocho; cualquier otro documento se compara tal cual, en mayúsculas.
 */
export function normalizarDocumento(valor: unknown): string {
    const texto = String(valor ?? '').replace(/\s+/g, '').toUpperCase()
    return /^\d{1,8}$/.test(texto) ? texto.padStart(8, '0') : texto
}

/** DNI de un docente (spec 028): 8 dígitos; con 7 se completa el cero inicial que pierde Excel. Cualquier otra cosa es `null`. */
export function normalizarDni(valor: unknown): string | null {
    const dni = String(valor ?? '').replace(/\s+/g, '')
    return /^\d{7,8}$/.test(dni) ? dni.padStart(8, '0') : null
}

export function normalizarCodigo(valor: unknown): string {
    return String(valor ?? '').replace(/\s+/g, '').toUpperCase()
}

export function normalizarCorreo(valor: unknown): string {
    return String(valor ?? '').trim().toLowerCase()
}

/** Nombre de un asesor con espacios simples y sin comillas sueltas. */
export function limpiarNombreAsesor(valor: unknown): string {
    return String(valor ?? '').replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function claveSeccion(ciclo: string, seccion: string): string {
    return `${ciclo.trim().toUpperCase()}|${seccion.trim().toUpperCase()}`
}

export function etiquetaSeccion(ciclo: string, seccion: string): string {
    return `${ciclo}-${seccion}`
}

const ROMANOS: Readonly<Record<string, number>> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 }

/** Ciclos en orden académico (I, II… X); uno desconocido va al final por orden alfabético. */
export function compararCiclos(a: string, b: string): number {
    const ordenA = ROMANOS[a.trim().toUpperCase()] ?? Number.MAX_SAFE_INTEGER
    const ordenB = ROMANOS[b.trim().toUpperCase()] ?? Number.MAX_SAFE_INTEGER
    return ordenA === ordenB ? a.localeCompare(b, 'es') : ordenA < ordenB ? -1 : 1
}

export function compararSecciones(a: string, b: string): number {
    return a.localeCompare(b, 'es', { numeric: true })
}

// ─── Situación y cruce con las inscripciones ────────────────────────────────

export function situacionDe(estado: string | null | undefined): Situacion {
    if (!estado) return 'SIN_INSCRIPCION'
    if (estado === 'APROBADO') return 'PAGADO'
    if (estado === 'RECHAZADO' || estado === 'CANCELADO') return 'RECHAZADO'
    return 'EN_REVISION'
}

const RANGO: Readonly<Record<Situacion, number>> = { PAGADO: 3, EN_REVISION: 2, RECHAZADO: 1, SIN_INSCRIPCION: 0 }

/** Si dos inscripciones comparten un dato, vale la de mejor situación y, a igualdad, la más reciente. */
function mejorInscripcion(actual: InscripcionBase | undefined, nueva: InscripcionBase): InscripcionBase {
    if (!actual) return nueva
    const diferencia = RANGO[situacionDe(nueva.estado)] - RANGO[situacionDe(actual.estado)]
    if (diferencia !== 0) return diferencia > 0 ? nueva : actual
    return nueva.id > actual.id ? nueva : actual
}

function indexar(inscripciones: readonly InscripcionBase[], clave: (inscripcion: InscripcionBase) => string): Map<string, InscripcionBase> {
    const indice = new Map<string, InscripcionBase>()
    for (const inscripcion of inscripciones) {
        const valor = clave(inscripcion)
        if (valor) indice.set(valor, mejorInscripcion(indice.get(valor), inscripcion))
    }
    return indice
}

function redondear(valor: number): number {
    return Math.round(valor * 100) / 100
}

function fechaIso(fecha: Date | null): string | null {
    return fecha ? fecha.toISOString().slice(0, 10) : null
}

/** Asesores de varias secciones, sin repetir y por nombre. */
function unirAsesores(secciones: readonly SeccionDeFila[]): AsesorRef[] {
    const porId = new Map<number, AsesorRef>()
    for (const seccion of secciones) for (const asesor of seccion.asesores) porId.set(asesor.id, asesor)
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Secciones que salen de los cursos (spec 034): una por ciclo y sección, con cuántos cursos lleva el alumno ahí y los docentes de esos cursos.
 * Van en el orden de `orden` (el de las secciones de la fila antes de filtrar) o, sin él, la principal primero y el resto en orden académico.
 */
function seccionesDeCursos(cursos: readonly CursoEstudiante[], principal: string | null, orden?: ReadonlyMap<string, number>): SeccionDeFila[] {
    const porClave = new Map<string, SeccionDeFila>()
    for (const curso of cursos) {
        const clave = claveSeccion(curso.ciclo, curso.seccion)
        const seccion = porClave.get(clave) ?? { ciclo: curso.ciclo, seccion: curso.seccion, turno: curso.turno, cursos: 0, asesores: [] }
        seccion.cursos += 1
        if (curso.docente && !seccion.asesores.some((asesor) => asesor.id === curso.docente?.id)) seccion.asesores.push(curso.docente)
        porClave.set(clave, seccion)
    }
    const rango = (s: SeccionDeFila) => orden?.get(claveSeccion(s.ciclo, s.seccion)) ?? (claveSeccion(s.ciclo, s.seccion) === principal ? -1 : Number.MAX_SAFE_INTEGER)
    return [...porClave.values()]
        .map((s) => ({ ...s, asesores: [...s.asesores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) }))
        .sort((a, b) => rango(a) - rango(b) || compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))
}

const compararCursos = (a: CursoEstudiante, b: CursoEstudiante) =>
    compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion) || a.nombre.localeCompare(b.nombre, 'es')

/** Secciones del estudiante con sus asesores: la principal primero y el resto en orden académico. Sin `secciones` solo está la principal. */
function seccionesDeFila(estudiante: EstudianteBase, asesoresPorSeccion: ReadonlyMap<string, AsesorRef[]>): SeccionDeFila[] {
    const principal = claveSeccion(estudiante.ciclo, estudiante.seccion)
    if (estudiante.cursos?.length) return seccionesDeCursos(estudiante.cursos, principal)
    const lista: readonly SeccionEstudiante[] = estudiante.secciones?.length
        ? estudiante.secciones
        : [{ ciclo: estudiante.ciclo, seccion: estudiante.seccion, turno: estudiante.turno, cursos: 1 }]
    const rango = (s: SeccionEstudiante) => (claveSeccion(s.ciclo, s.seccion) === principal ? 0 : 1)
    return [...lista]
        .sort((a, b) => rango(a) - rango(b) || compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))
        .map((s) => ({ ciclo: s.ciclo, seccion: s.seccion, turno: s.turno, cursos: s.cursos, asesores: asesoresPorSeccion.get(claveSeccion(s.ciclo, s.seccion)) ?? [] }))
}

/**
 * Una fila por estudiante del padrón. La inscripción se busca primero por documento, luego por código
 * de estudiante y por último por correo (el institucional lleva el código). Sin `conPago` los montos y
 * la fecha de pago salen en `null`; la situación se conserva, igual que el estado en el listado de
 * inscritos.
 */
export function construirFilas(
    estudiantes: readonly EstudianteBase[],
    asesoresPorSeccion: ReadonlyMap<string, AsesorRef[]>,
    inscripciones: readonly InscripcionBase[],
    conPago: boolean,
): FilaSeguimiento[] {
    const porDocumento = indexar(inscripciones, (i) => (i.documento ? normalizarDocumento(i.documento) : ''))
    const porCodigo = indexar(inscripciones, (i) => normalizarCodigo(i.codigoEstudiante))
    const porCorreo = indexar(inscripciones, (i) => normalizarCorreo(i.correo))

    const buscar = (estudiante: EstudianteBase): { inscripcion: InscripcionBase, coincidencia: Coincidencia } | null => {
        const candidatas: Array<[Coincidencia, InscripcionBase | undefined]> = [
            ['DOCUMENTO', porDocumento.get(normalizarDocumento(estudiante.documento))],
            ['CODIGO', porCodigo.get(normalizarCodigo(estudiante.codigo))],
            ['CORREO', porCorreo.get(normalizarCorreo(estudiante.correo))],
        ]
        const hallada = candidatas.find(([, inscripcion]) => inscripcion !== undefined)
        return hallada ? { inscripcion: hallada[1] as InscripcionBase, coincidencia: hallada[0] } : null
    }

    return estudiantes
        .map((estudiante): FilaSeguimiento => {
            const hallada = buscar(estudiante)
            const inscripcion = hallada?.inscripcion
            const secciones = seccionesDeFila(estudiante, asesoresPorSeccion)
            return {
                id: estudiante.id,
                codigo: estudiante.codigo,
                documento: estudiante.documento,
                nombre: estudiante.nombre,
                correo: estudiante.correo,
                celular: estudiante.celular,
                carrera: estudiante.carrera,
                ciclo: estudiante.ciclo,
                turno: estudiante.turno,
                seccion: estudiante.seccion,
                secciones,
                cursos: [...(estudiante.cursos ?? [])].sort(compararCursos),
                asesores: unirAsesores(secciones),
                situacion: situacionDe(inscripcion?.estado),
                estadoInscripcion: inscripcion?.estado ?? null,
                inscripcionId: inscripcion?.id ?? null,
                coincidencia: hallada?.coincidencia ?? null,
                monto: conPago ? (inscripcion?.monto ?? null) : null,
                fechaPago: conPago ? fechaIso(inscripcion?.fechaPago ?? null) : null,
            }
        })
        .sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion) || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Asesores de cada ciclo y sección, listos para `construirFilas`. */
export function asesoresPorSeccion(asesores: readonly AsesorConSecciones[]): Map<string, AsesorRef[]> {
    const mapa = new Map<string, AsesorRef[]>()
    for (const asesor of asesores) {
        for (const { ciclo, seccion } of asesor.secciones) {
            const clave = claveSeccion(ciclo, seccion)
            mapa.set(clave, [...(mapa.get(clave) ?? []), { id: asesor.id, nombre: asesor.nombre }])
        }
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return mapa
}

// ─── Filtros ────────────────────────────────────────────────────────────────

const igual = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase()

/**
 * Filtros que delimitan el grupo de estudiantes (no su situación): los usan los resúmenes. Ciclo, sección, turno, asesor y curso
 * deben cumplirse en **la misma sección** (o, con cursos de SIVIRENO, **en el mismo curso**) del estudiante (specs 033 y 034). Si el filtro
 * deja solo algunas de sus secciones o cursos, la fila sale **proyectada** a ellos (su ciclo, turno y sección pasan a ser los de la primera):
 * quien mira solo ve lo que le corresponde.
 */
export function filtrarAlcance(filas: readonly FilaSeguimiento[], filtros: FiltrosSeguimiento): FilaSeguimiento[] {
    if (filtros.asesorId === undefined && filtros.cursoId === undefined && !filtros.ciclo && !filtros.seccion && !filtros.turno) return [...filas]
    const resultado: FilaSeguimiento[] = []
    for (const fila of filas) {
        if (fila.cursos.length) {
            const cursosEnAlcance = fila.cursos.filter((c) =>
                (filtros.cursoId === undefined || c.id === filtros.cursoId)
                && (filtros.asesorId === undefined || c.docente?.id === filtros.asesorId)
                && (!filtros.ciclo || igual(c.ciclo, filtros.ciclo))
                && (!filtros.seccion || igual(c.seccion, filtros.seccion))
                && (!filtros.turno || igual(c.turno, filtros.turno)))
            if (!cursosEnAlcance.length) continue
            if (cursosEnAlcance.length === fila.cursos.length) {
                resultado.push(fila)
                continue
            }
            const orden = new Map(fila.secciones.map((s, i) => [claveSeccion(s.ciclo, s.seccion), i]))
            const secciones = seccionesDeCursos(cursosEnAlcance, null, orden)
            const [primera] = secciones
            resultado.push({ ...fila, ciclo: primera.ciclo, turno: primera.turno, seccion: primera.seccion, cursos: cursosEnAlcance, secciones, asesores: unirAsesores(secciones) })
            continue
        }
        // Padrón del Excel (sin cursos): no tiene curso que coincida con un filtro de curso
        if (filtros.cursoId !== undefined) continue
        const enAlcance = fila.secciones.filter((s) =>
            (filtros.asesorId === undefined || s.asesores.some((asesor) => asesor.id === filtros.asesorId))
            && (!filtros.ciclo || igual(s.ciclo, filtros.ciclo))
            && (!filtros.seccion || igual(s.seccion, filtros.seccion))
            && (!filtros.turno || igual(s.turno, filtros.turno)))
        if (!enAlcance.length) continue
        if (enAlcance.length === fila.secciones.length) {
            resultado.push(fila)
            continue
        }
        const [primera] = enAlcance
        resultado.push({ ...fila, ciclo: primera.ciclo, turno: primera.turno, seccion: primera.seccion, secciones: enAlcance, asesores: unirAsesores(enAlcance) })
    }
    return resultado
}

/** Alcance más situación y búsqueda libre (nombre, código, documento o correo): el listado de alumnos. */
export function filtrarFilas(filas: readonly FilaSeguimiento[], filtros: FiltrosSeguimiento): FilaSeguimiento[] {
    const palabras = claveDeTexto(filtros.q).split(' ').filter(Boolean)
    return filtrarAlcance(filas, filtros).filter((fila) => {
        if (filtros.situacion === 'NO_PAGADO' && fila.situacion === 'PAGADO') return false
        if (filtros.situacion && filtros.situacion !== 'NO_PAGADO' && fila.situacion !== filtros.situacion) return false
        if (!palabras.length) return true
        const texto = claveDeTexto(`${fila.nombre} ${fila.codigo} ${fila.documento} ${fila.correo ?? ''}`)
        return palabras.every((palabra) => texto.includes(palabra))
    })
}

/** Valores que ofrecen los filtros: salen de todo el padrón, no del grupo ya filtrado. */
export interface OpcionesFiltro {
    ciclos: string[]
    secciones: Array<{ ciclo: string, seccion: string }>
    turnos: string[]
    asesores: AsesorRef[]
    /** Los cursos de SIVIRENO del padrón (spec 034); vacío si viene del Excel. */
    cursos: CursoEstudiante[]
}

export function opcionesDeFiltro(filas: readonly FilaSeguimiento[], asesores: readonly AsesorConSecciones[]): OpcionesFiltro {
    const entradas = filas.flatMap((fila) => fila.secciones)
    const secciones = new Map(entradas.map((s) => [claveSeccion(s.ciclo, s.seccion), { ciclo: s.ciclo, seccion: s.seccion }]))
    const cursos = new Map(filas.flatMap((fila) => fila.cursos).map((c) => [c.id, c]))
    return {
        ciclos: [...new Set(entradas.map((s) => s.ciclo))].sort(compararCiclos),
        secciones: [...secciones.values()].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion)),
        turnos: [...new Set(entradas.map((s) => s.turno).filter((turno): turno is string => Boolean(turno)))].sort(),
        asesores: asesores.map(({ id, nombre }) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        cursos: [...cursos.values()].sort(compararCursos),
    }
}

// ─── Resúmenes ──────────────────────────────────────────────────────────────

export function contar(filas: readonly FilaSeguimiento[], conPago: boolean): Contadores {
    const cuenta = { PAGADO: 0, EN_REVISION: 0, RECHAZADO: 0, SIN_INSCRIPCION: 0 }
    let recaudado = 0
    for (const fila of filas) {
        cuenta[fila.situacion] += 1
        if (fila.situacion === 'PAGADO') recaudado += fila.monto ?? 0
    }
    const alumnos = filas.length
    return {
        alumnos,
        pagaron: cuenta.PAGADO,
        enRevision: cuenta.EN_REVISION,
        rechazados: cuenta.RECHAZADO,
        sinInscripcion: cuenta.SIN_INSCRIPCION,
        noPagaron: alumnos - cuenta.PAGADO,
        avance: alumnos ? Math.round((cuenta.PAGADO / alumnos) * 10000) / 10000 : 0,
        recaudado: conPago ? redondear(recaudado) : null,
    }
}

/**
 * Resumen de las filas dadas: totales, por ciclo, por sección, por asesor y por curso. Un estudiante cuenta una vez en los
 * totales, una vez en cada ciclo, sección y curso en que cursa (specs 033 y 034) y una vez por cada uno de sus asesores.
 */
export function resumir(filas: readonly FilaSeguimiento[], asesores: readonly AsesorConSecciones[], conPago: boolean): ResumenSeguimiento {
    const ciclos = new Map<string, { ciclo: string, filas: Map<number, FilaSeguimiento> }>()
    const secciones = new Map<string, { ciclo: string, seccion: string, turnos: Set<string>, asesores: Map<number, AsesorRef>, filas: FilaSeguimiento[] }>()
    const cursos = new Map<number, { curso: CursoEstudiante, filas: FilaSeguimiento[] }>()
    for (const fila of filas) {
        for (const s of fila.secciones) {
            const cicloClave = s.ciclo.toUpperCase()
            const delCiclo = ciclos.get(cicloClave) ?? { ciclo: s.ciclo, filas: new Map<number, FilaSeguimiento>() }
            delCiclo.filas.set(fila.id, fila)
            ciclos.set(cicloClave, delCiclo)

            const clave = claveSeccion(s.ciclo, s.seccion)
            const delGrupo = secciones.get(clave) ?? { ciclo: s.ciclo, seccion: s.seccion, turnos: new Set<string>(), asesores: new Map<number, AsesorRef>(), filas: [] }
            if (s.turno) delGrupo.turnos.add(s.turno)
            for (const asesor of s.asesores) delGrupo.asesores.set(asesor.id, asesor)
            delGrupo.filas.push(fila)
            secciones.set(clave, delGrupo)
        }
        for (const curso of fila.cursos) {
            const delCurso = cursos.get(curso.id) ?? { curso, filas: [] }
            delCurso.filas.push(fila)
            cursos.set(curso.id, delCurso)
        }
    }

    const porCiclo = [...ciclos.values()]
        .map((c) => ({ ciclo: c.ciclo, ...contar([...c.filas.values()], conPago) }))
        .sort((a, b) => compararCiclos(a.ciclo, b.ciclo))

    const porSeccion = [...secciones.values()]
        .map((g) => ({
            ciclo: g.ciclo,
            seccion: g.seccion,
            turnos: [...g.turnos].sort(),
            asesores: [...g.asesores.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
            ...contar(g.filas, conPago),
        }))
        .sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))

    const porCurso = [...cursos.values()]
        .map(({ curso, filas: delCurso }): ResumenCurso => ({
            id: curso.id,
            codigo: curso.codigo,
            nombre: curso.nombre,
            ciclo: curso.ciclo,
            seccion: curso.seccion,
            turno: curso.turno,
            docente: curso.docente,
            ...contar(delCurso, conPago),
        }))
        .sort(compararCursos)

    const porAsesor = asesores
        .map((asesor): ResumenAsesor => ({
            id: asesor.id,
            nombre: asesor.nombre,
            secciones: [...asesor.secciones].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion)),
            ...contar(filas.filter((fila) => fila.asesores.some((a) => a.id === asesor.id)), conPago),
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

    return {
        totales: contar(filas, conPago),
        porCiclo,
        porSeccion,
        porAsesor,
        porCurso,
        alumnosSinAsesor: filas.filter((fila) => fila.asesores.length === 0).length,
    }
}

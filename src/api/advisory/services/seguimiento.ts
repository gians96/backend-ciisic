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

export interface EstudianteBase {
    id: number
    documento: string
    codigo: string
    correo: string | null
    nombre: string
    celular: string | null
    carrera: string
    ciclo: string
    turno: string | null
    seccion: string
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
    ciclo: string
    turno: string | null
    seccion: string
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

export interface ResumenSeguimiento {
    totales: Contadores
    porCiclo: ResumenCiclo[]
    porSeccion: ResumenSeccion[]
    porAsesor: ResumenAsesor[]
    /** Estudiantes cuyo ciclo y sección no tienen ningún asesor. */
    alumnosSinAsesor: number
}

export interface FiltrosSeguimiento {
    asesorId?: number
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
                asesores: asesoresPorSeccion.get(claveSeccion(estudiante.ciclo, estudiante.seccion)) ?? [],
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

/** Filtros que delimitan el grupo de estudiantes (no su situación): los usan los resúmenes. */
export function filtrarAlcance(filas: readonly FilaSeguimiento[], filtros: FiltrosSeguimiento): FilaSeguimiento[] {
    return filas.filter((fila) => {
        if (filtros.asesorId !== undefined && !fila.asesores.some((asesor) => asesor.id === filtros.asesorId)) return false
        if (filtros.ciclo && !igual(fila.ciclo, filtros.ciclo)) return false
        if (filtros.seccion && !igual(fila.seccion, filtros.seccion)) return false
        if (filtros.turno && !igual(fila.turno, filtros.turno)) return false
        return true
    })
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
}

export function opcionesDeFiltro(filas: readonly FilaSeguimiento[], asesores: readonly AsesorConSecciones[]): OpcionesFiltro {
    const secciones = new Map(filas.map((fila) => [claveSeccion(fila.ciclo, fila.seccion), { ciclo: fila.ciclo, seccion: fila.seccion }]))
    return {
        ciclos: [...new Set(filas.map((fila) => fila.ciclo))].sort(compararCiclos),
        secciones: [...secciones.values()].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion)),
        turnos: [...new Set(filas.map((fila) => fila.turno).filter((turno): turno is string => Boolean(turno)))].sort(),
        asesores: asesores.map(({ id, nombre }) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
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

function agrupar<T>(filas: readonly FilaSeguimiento[], clave: (fila: FilaSeguimiento) => string, crear: (grupo: FilaSeguimiento[]) => T): T[] {
    const grupos = new Map<string, FilaSeguimiento[]>()
    for (const fila of filas) {
        const llave = clave(fila)
        const grupo = grupos.get(llave)
        if (grupo) grupo.push(fila)
        else grupos.set(llave, [fila])
    }
    return [...grupos.values()].map(crear)
}

/**
 * Resumen de las filas dadas: totales, por ciclo, por sección y por asesor. Un estudiante cuenta una
 * vez en los totales, en su ciclo y en su sección, y una vez por cada uno de sus asesores.
 */
export function resumir(filas: readonly FilaSeguimiento[], asesores: readonly AsesorConSecciones[], conPago: boolean): ResumenSeguimiento {
    const porCiclo = agrupar(filas, (fila) => fila.ciclo.toUpperCase(), (grupo) => ({ ciclo: grupo[0].ciclo, ...contar(grupo, conPago) }))
        .sort((a, b) => compararCiclos(a.ciclo, b.ciclo))

    const porSeccion = agrupar(filas, (fila) => claveSeccion(fila.ciclo, fila.seccion), (grupo) => ({
        ciclo: grupo[0].ciclo,
        seccion: grupo[0].seccion,
        turnos: [...new Set(grupo.map((fila) => fila.turno).filter((turno): turno is string => Boolean(turno)))].sort(),
        asesores: grupo[0].asesores,
        ...contar(grupo, conPago),
    })).sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))

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
        alumnosSinAsesor: filas.filter((fila) => fila.asesores.length === 0).length,
    }
}

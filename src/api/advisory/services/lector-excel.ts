import type { CellValue, Worksheet } from 'exceljs'
import { unprocessable } from '../../../core/http-error'
import {
    claveDeTexto,
    claveSeccion,
    compararCiclos,
    compararSecciones,
    etiquetaSeccion,
    limpiarNombreAsesor,
    normalizarCorreo,
    normalizarDocumento,
} from './seguimiento'

/**
 * Lectura del Excel que arma la facultad (spec 025): una hoja `ESTUDIANTES <semestre>` con una fila por
 * alumno y una hoja `RESUMEN` cuya tabla «CICLO · SECCIÓN · … · ASESORES» dice qué docentes atienden
 * cada sección (uno por línea dentro de la celda). Las demás hojas se ignoran.
 */

export interface EstudianteLeido {
    documento: string
    codigo: string
    correo: string | null
    nombre: string
    celular: string | null
    carrera: string
    ciclo: string
    turno: string | null
    seccion: string
    distrito: string | null
    provincia: string | null
    departamento: string | null
}

export interface AsesorLeido {
    nombre: string
    secciones: Array<{ ciclo: string, seccion: string }>
}

export interface PadronLeido {
    semestre: string
    estudiantes: EstudianteLeido[]
    asesores: AsesorLeido[]
    advertencias: string[]
}

/** Tamaños de las columnas de `padron_estudiantes` y `asesores`. */
const LARGO = { documento: 20, codigo: 20, correo: 191, nombre: 200, celular: 20, carrera: 120, ciclo: 10, turno: 5, seccion: 10, lugar: 80, asesor: 200, semestre: 10 }

const CAMPOS = {
    documento: ['DNI', 'DOCUMENTO', 'NUMERODOCUMENTO', 'NDOCUMENTO'],
    codigo: ['CODIGO', 'CODIGOESTUDIANTE', 'CODIGODEESTUDIANTE'],
    correo: ['EMAIL', 'CORREO', 'CORREOELECTRONICO'],
    nombre: ['ALUMNO', 'ESTUDIANTE', 'APELLIDOSYNOMBRES', 'NOMBRES'],
    celular: ['CELULAR', 'TELEFONO'],
    carrera: ['CARRERA', 'PROGRAMA', 'ESCUELA'],
    ciclo: ['CICLO'],
    turno: ['TURNO'],
    seccion: ['SECCION'],
    distrito: ['DISTRITO'],
    provincia: ['PROVINCIA'],
    departamento: ['DEPARTAMENTO'],
    semestre: ['SEMESTRE'],
} as const satisfies Record<string, readonly string[]>

type Campo = keyof typeof CAMPOS
const OBLIGATORIOS: readonly Campo[] = ['documento', 'codigo', 'nombre', 'ciclo', 'seccion']

/** Cabecera sin acentos, signos ni espacios en mayúsculas («SECCIÓN» → `SECCION`, «¿Pago?» → `PAGO`). */
function cabecera(valor: unknown): string {
    return claveDeTexto(valor).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function texto(valor: CellValue | undefined): string {
    if (valor === null || valor === undefined) return ''
    if (typeof valor === 'string') return valor.trim()
    if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
    if (valor instanceof Date) return valor.toISOString().slice(0, 10)
    if ('richText' in valor) return valor.richText.map((parte) => parte.text).join('').trim()
    if ('result' in valor) return texto(valor.result as CellValue)
    if ('text' in valor) return String(valor.text).trim()
    return ''
}

function recortar(valor: string, largo: number): string {
    return valor.length > largo ? valor.slice(0, largo) : valor
}

function opcional(valor: string, largo: number): string | null {
    return valor ? recortar(valor, largo) : null
}

function hojaQueEmpieza(libro: { worksheets: Worksheet[] }, prefijo: string): Worksheet | undefined {
    return libro.worksheets.find((hoja) => cabecera(hoja.name).startsWith(prefijo))
}

function semestreDe(hoja: Worksheet, indice: Partial<Record<Campo, number>>, primeraFila: number): string {
    const delNombre = /(\d{4})\s*[-–/]\s*([12])/.exec(hoja.name)
    if (delNombre) return `${delNombre[1]}-${delNombre[2]}`
    const columna = indice.semestre
    const celda = columna ? texto(hoja.getRow(primeraFila).getCell(columna).value) : ''
    const delDato = /^(\d{4})\s*[-–/]\s*([12])$/.exec(celda)
    return delDato ? `${delDato[1]}-${delDato[2]}` : ''
}

function leerEstudiantes(hoja: Worksheet, advertencias: string[]): { estudiantes: EstudianteLeido[], semestre: string } {
    // La cabecera suele ser la fila 1; se busca en las primeras por si hay un título encima
    let filaCabecera = 0
    let indice: Partial<Record<Campo, number>> = {}
    for (let r = 1; r <= Math.min(hoja.rowCount, 10) && !filaCabecera; r++) {
        const encontrados: Partial<Record<Campo, number>> = {}
        hoja.getRow(r).eachCell({ includeEmpty: false }, (celda, columna) => {
            const nombre = cabecera(texto(celda.value))
            for (const campo of Object.keys(CAMPOS) as Campo[]) {
                if (encontrados[campo] === undefined && (CAMPOS[campo] as readonly string[]).includes(nombre)) encontrados[campo] = columna
            }
        })
        if (encontrados.documento !== undefined && encontrados.codigo !== undefined) {
            filaCabecera = r
            indice = encontrados
        }
    }
    if (!filaCabecera) {
        throw unprocessable('PADRON_COLUMNS_MISSING', 'La hoja de estudiantes no tiene las columnas esperadas.', { file: 'Faltan las columnas DNI y CODIGO' })
    }
    const faltantes = OBLIGATORIOS.filter((campo) => indice[campo] === undefined)
    if (faltantes.length) {
        throw unprocessable('PADRON_COLUMNS_MISSING', 'La hoja de estudiantes no tiene las columnas esperadas.', {
            file: `Faltan las columnas: ${faltantes.map((campo) => CAMPOS[campo][0]).join(', ')}`,
        })
    }

    const dato = (fila: number, campo: Campo): string => {
        const columna = indice[campo]
        return columna ? texto(hoja.getRow(fila).getCell(columna).value) : ''
    }

    const vistos = new Set<string>()
    const estudiantes: EstudianteLeido[] = []
    for (let r = filaCabecera + 1; r <= hoja.rowCount; r++) {
        const codigo = dato(r, 'codigo').replace(/\s+/g, '').toUpperCase()
        const documento = normalizarDocumento(dato(r, 'documento'))
        const nombre = dato(r, 'nombre').replace(/\s+/g, ' ')
        if (!codigo && !documento && !nombre) continue
        const ciclo = dato(r, 'ciclo').toUpperCase()
        const seccion = dato(r, 'seccion').toUpperCase()
        if (!codigo || !nombre || !ciclo || !seccion) {
            advertencias.push(`Fila ${r}: se omitió porque falta el código, el nombre, el ciclo o la sección.`)
            continue
        }
        if (vistos.has(codigo)) {
            advertencias.push(`Fila ${r}: el código ${codigo} está repetido; se conservó la primera aparición.`)
            continue
        }
        vistos.add(codigo)
        if (!/^\d{8}$/.test(documento)) advertencias.push(`Fila ${r}: el DNI «${dato(r, 'documento')}» de ${nombre} no tiene 8 dígitos; se buscará por código y correo.`)
        estudiantes.push({
            documento: recortar(documento, LARGO.documento),
            codigo: recortar(codigo, LARGO.codigo),
            correo: opcional(normalizarCorreo(dato(r, 'correo')), LARGO.correo),
            nombre: recortar(nombre, LARGO.nombre),
            celular: opcional(dato(r, 'celular').replace(/[^\d+]/g, ''), LARGO.celular),
            carrera: recortar(dato(r, 'carrera') || 'No indicada', LARGO.carrera),
            ciclo: recortar(ciclo, LARGO.ciclo),
            turno: opcional(dato(r, 'turno').toUpperCase(), LARGO.turno),
            seccion: recortar(seccion, LARGO.seccion),
            distrito: opcional(dato(r, 'distrito'), LARGO.lugar),
            provincia: opcional(dato(r, 'provincia'), LARGO.lugar),
            departamento: opcional(dato(r, 'departamento'), LARGO.lugar),
        })
    }
    return { estudiantes, semestre: semestreDe(hoja, indice, filaCabecera + 1) }
}

/**
 * Tabla «CICLO · SECCIÓN · … · ASESORES» de la hoja RESUMEN. El nombre de cada asesor va en su propia
 * línea dentro de la celda y a veces entre comillas (Excel las agrega al copiar celdas multilínea).
 */
function leerAsignaciones(hoja: Worksheet): Array<{ ciclo: string, seccion: string, asesores: string[] }> {
    let filaCabecera = 0
    const columnas = { ciclo: 0, seccion: 0, asesores: 0 }
    for (let r = 1; r <= hoja.rowCount && !filaCabecera; r++) {
        const encontrados = { ciclo: 0, seccion: 0, asesores: 0 }
        hoja.getRow(r).eachCell({ includeEmpty: false }, (celda, columna) => {
            const nombre = cabecera(texto(celda.value))
            if (nombre === 'CICLO' && !encontrados.ciclo) encontrados.ciclo = columna
            else if (nombre === 'SECCION' && !encontrados.seccion) encontrados.seccion = columna
            else if ((nombre === 'ASESORES' || nombre === 'ASESOR' || nombre === 'DOCENTES') && !encontrados.asesores) encontrados.asesores = columna
        })
        if (encontrados.ciclo && encontrados.seccion && encontrados.asesores) {
            filaCabecera = r
            Object.assign(columnas, encontrados)
        }
    }
    if (!filaCabecera) return []

    const asignaciones = new Map<string, { ciclo: string, seccion: string, asesores: string[] }>()
    for (let r = filaCabecera + 1; r <= hoja.rowCount; r++) {
        const fila = hoja.getRow(r)
        const ciclo = texto(fila.getCell(columnas.ciclo).value).toUpperCase()
        const seccion = texto(fila.getCell(columnas.seccion).value).toUpperCase()
        if (!ciclo || !seccion) continue
        const nombres = texto(fila.getCell(columnas.asesores).value).split(/\r?\n/).map(limpiarNombreAsesor).filter(Boolean)
        const clave = claveSeccion(ciclo, seccion)
        const existente = asignaciones.get(clave)
        if (existente) existente.asesores.push(...nombres)
        else asignaciones.set(clave, { ciclo, seccion, asesores: nombres })
    }
    return [...asignaciones.values()]
}

/** Lee el libro y devuelve el padrón y los asesores listos para guardar, con las advertencias del camino. */
export async function leerLibroDePadron(contenido: Buffer): Promise<PadronLeido> {
    const { Workbook } = await import('exceljs')
    const libro = new Workbook()
    try {
        // exceljs tipa `load` con el `Buffer` global anterior a los genéricos de Node 22
        await libro.xlsx.load(contenido as unknown as Parameters<typeof libro.xlsx.load>[0])
    } catch {
        throw unprocessable('PADRON_FILE_INVALID', 'No se pudo leer el archivo. Sube el Excel (.xlsx) de la facultad.', { file: 'Archivo no válido' })
    }

    const hojaEstudiantes = hojaQueEmpieza(libro, 'ESTUDIANTES')
    if (!hojaEstudiantes) {
        throw unprocessable('PADRON_SHEET_NOT_FOUND', 'El Excel no tiene una hoja «ESTUDIANTES …».', { file: 'Falta la hoja ESTUDIANTES' })
    }

    const advertencias: string[] = []
    const { estudiantes, semestre } = leerEstudiantes(hojaEstudiantes, advertencias)
    if (!estudiantes.length) throw unprocessable('PADRON_EMPTY', 'La hoja de estudiantes no tiene alumnos.', { file: 'Sin estudiantes' })

    const hojaResumen = hojaQueEmpieza(libro, 'RESUMEN')
    const asignaciones = hojaResumen ? leerAsignaciones(hojaResumen) : []
    if (!hojaResumen) advertencias.push('El Excel no tiene la hoja RESUMEN: ningún alumno quedó con asesor.')
    else if (!asignaciones.length) advertencias.push('La hoja RESUMEN no tiene la tabla CICLO · SECCIÓN · ASESORES: ningún alumno quedó con asesor.')

    // Un asesor puede escribirse distinto en cada fila (mayúsculas, acentos, espacios): se junta por su clave
    const asesores = new Map<string, AsesorLeido>()
    for (const { ciclo, seccion, asesores: nombres } of asignaciones) {
        if (!nombres.length) advertencias.push(`La sección ${etiquetaSeccion(ciclo, seccion)} no tiene asesores en la hoja RESUMEN.`)
        for (const nombre of nombres) {
            const clave = claveDeTexto(nombre)
            const asesor = asesores.get(clave) ?? { nombre: recortar(nombre, LARGO.asesor), secciones: [] }
            if (!asesor.secciones.some((s) => claveSeccion(s.ciclo, s.seccion) === claveSeccion(ciclo, seccion))) asesor.secciones.push({ ciclo, seccion })
            asesores.set(clave, asesor)
        }
    }

    const conAsesor = new Set([...asesores.values()].flatMap((asesor) => asesor.secciones.map((s) => claveSeccion(s.ciclo, s.seccion))))
    const sinAsesor = new Map<string, { ciclo: string, seccion: string, alumnos: number }>()
    for (const e of estudiantes) {
        const clave = claveSeccion(e.ciclo, e.seccion)
        if (!conAsesor.has(clave)) sinAsesor.set(clave, { ciclo: e.ciclo, seccion: e.seccion, alumnos: (sinAsesor.get(clave)?.alumnos ?? 0) + 1 })
    }
    if (hojaResumen && asignaciones.length) {
        for (const s of [...sinAsesor.values()].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))) {
            advertencias.push(`La sección ${etiquetaSeccion(s.ciclo, s.seccion)} tiene ${s.alumnos} alumno(s) pero ningún asesor.`)
        }
    }
    const conAlumnos = new Set(estudiantes.map((e) => claveSeccion(e.ciclo, e.seccion)))
    for (const { ciclo, seccion } of asignaciones) {
        if (!conAlumnos.has(claveSeccion(ciclo, seccion))) advertencias.push(`La sección ${etiquetaSeccion(ciclo, seccion)} de la hoja RESUMEN no tiene alumnos en la hoja de estudiantes.`)
    }

    return { semestre: recortar(semestre, LARGO.semestre), estudiantes, asesores: [...asesores.values()], advertencias }
}

import type { GrupoAsesoria } from './matriculas-jp'
import { claveDeTexto, claveSeccion, compararCiclos, compararSecciones, etiquetaSeccion, limpiarNombreAsesor, normalizarDni } from './seguimiento'

/**
 * Designación de asesores de un semestre (spec 033): qué docentes atienden cada grupo (ciclo + sección) y su DNI. La arma la
 * facultad (una tabla «Designación de asesores»); se lee de un JSON **fuera del repositorio** porque lleva DNI. Todo es puro.
 *
 * Formato:
 *   { "grupos": [{ "grupo": "II-A", "turno": "M" }, …],
 *     "asesores": [{ "nombre": "DRA. MARISOL DAGA CHACA", "dni": "04081923", "grupos": ["II-A"] }, …] }
 * Turnos: `M` mañana, `T` tarde, `N` noche.
 */

export interface AsesorDesignado {
    nombre: string
    /** DNI de 8 dígitos; `null` = no se cambia el que ya tenga. */
    documento: string | null
    grupos: GrupoAsesoria[]
}

export interface Designacion {
    grupos: GrupoAsesoria[]
    asesores: AsesorDesignado[]
}

const TURNOS = ['M', 'T', 'N']

function objeto(valor: unknown, donde: string): Record<string, unknown> {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error(`${donde} debe ser un objeto`)
    return valor as Record<string, unknown>
}

function lista(valor: unknown, donde: string): unknown[] {
    if (!Array.isArray(valor) || !valor.length) throw new Error(`${donde} debe ser una lista con al menos un elemento`)
    return valor
}

/** `II-A1` → ciclo `II`, sección `A1`. */
function partirGrupo(texto: unknown, donde: string): { ciclo: string, seccion: string } {
    const partes = /^([IVX]+)-([A-Z]\d*)$/.exec(String(texto ?? '').trim().toUpperCase())
    if (!partes) throw new Error(`${donde}: «${String(texto)}» no es un grupo válido (por ejemplo II-A o VI-A1)`)
    return { ciclo: partes[1], seccion: partes[2] }
}

/** Valida el JSON de la designación; ante cualquier problema lanza un `Error` con el motivo (nada se escribe). */
export function leerDesignacion(bruto: unknown): Designacion {
    const raiz = objeto(bruto, 'El archivo')
    const grupos: GrupoAsesoria[] = []
    for (const item of lista(raiz.grupos, '«grupos»')) {
        const fila = objeto(item, 'Cada grupo')
        const { ciclo, seccion } = partirGrupo(fila.grupo, 'Grupo')
        const turno = String(fila.turno ?? '').trim().toUpperCase()
        if (!TURNOS.includes(turno)) throw new Error(`Grupo ${etiquetaSeccion(ciclo, seccion)}: el turno debe ser ${TURNOS.join(', ')}`)
        if (grupos.some((g) => claveSeccion(g.ciclo, g.seccion) === claveSeccion(ciclo, seccion))) throw new Error(`El grupo ${etiquetaSeccion(ciclo, seccion)} está repetido`)
        grupos.push({ ciclo, seccion, turno })
    }

    const asesores: AsesorDesignado[] = []
    const nombres = new Set<string>()
    const dnis = new Set<string>()
    for (const item of lista(raiz.asesores, '«asesores»')) {
        const fila = objeto(item, 'Cada asesor')
        const nombre = limpiarNombreAsesor(fila.nombre)
        if (nombre.length < 3) throw new Error('Hay un asesor sin nombre')
        const clave = claveDeTexto(nombre)
        if (nombres.has(clave)) throw new Error(`El asesor ${nombre} está repetido`)
        nombres.add(clave)

        let documento: string | null = null
        if (fila.dni !== undefined && fila.dni !== null && String(fila.dni).trim() !== '') {
            documento = normalizarDni(fila.dni)
            if (!documento) throw new Error(`${nombre}: el DNI debe tener 8 dígitos`)
            if (dnis.has(documento)) throw new Error(`${nombre}: su DNI ya es de otro asesor de la lista`)
            dnis.add(documento)
        }

        const propios: GrupoAsesoria[] = []
        for (const texto of lista(fila.grupos, `Los grupos de ${nombre}`)) {
            const { ciclo, seccion } = partirGrupo(texto, nombre)
            const grupo = grupos.find((g) => claveSeccion(g.ciclo, g.seccion) === claveSeccion(ciclo, seccion))
            if (!grupo) throw new Error(`${nombre}: el grupo ${etiquetaSeccion(ciclo, seccion)} no está en «grupos»`)
            if (propios.includes(grupo)) throw new Error(`${nombre}: el grupo ${etiquetaSeccion(ciclo, seccion)} está repetido`)
            propios.push(grupo)
        }
        asesores.push({ nombre, documento, grupos: propios })
    }

    const sinAsesor = grupos.filter((g) => !asesores.some((a) => a.grupos.includes(g)))
    if (sinAsesor.length) throw new Error(`Grupos sin asesor: ${sinAsesor.map((g) => etiquetaSeccion(g.ciclo, g.seccion)).join(', ')}`)
    return { grupos, asesores }
}

export interface AsesorExistente {
    id: number
    nombre: string
    documento: string | null
    secciones: Array<{ ciclo: string, seccion: string }>
}

export interface CambioAsesor {
    designado: AsesorDesignado
    /** `null`: no existe y se crea. */
    existente: AsesorExistente | null
    documentoAntes: string | null
    cambiaDocumento: boolean
    seccionesAntes: string[]
    seccionesDespues: string[]
    cambiaSecciones: boolean
}

export interface PlanAsesores {
    cambios: CambioAsesor[]
    /** Asesores que ya existen y no están en la designación: no se tocan. */
    noDesignados: AsesorExistente[]
    /** Problemas que impiden aplicar (por ejemplo un DNI que ya es de un asesor fuera de la lista). */
    conflictos: string[]
}

const etiquetas = (secciones: ReadonlyArray<{ ciclo: string, seccion: string }>) =>
    [...secciones].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion)).map((s) => etiquetaSeccion(s.ciclo, s.seccion))

/**
 * Compara la designación con los asesores del evento: se emparejan por nombre (sin acentos ni mayúsculas) y de cada uno se
 * ve qué cambia (DNI, secciones). Un asesor nuevo se crea; los que no están en la lista no se tocan.
 */
export function planearAsesores(designacion: Designacion, existentes: readonly AsesorExistente[]): PlanAsesores {
    const porNombre = new Map(existentes.map((a) => [claveDeTexto(a.nombre), a]))
    const emparejados = new Set<number>()
    const cambios = designacion.asesores.map((designado): CambioAsesor => {
        const existente = porNombre.get(claveDeTexto(designado.nombre)) ?? null
        if (existente) emparejados.add(existente.id)
        const seccionesAntes = existente ? etiquetas(existente.secciones) : []
        const seccionesDespues = etiquetas(designado.grupos)
        return {
            designado,
            existente,
            documentoAntes: existente?.documento ?? null,
            cambiaDocumento: designado.documento !== null && designado.documento !== (existente?.documento ?? null),
            seccionesAntes,
            seccionesDespues,
            cambiaSecciones: seccionesAntes.join(',') !== seccionesDespues.join(','),
        }
    })
    const noDesignados = existentes.filter((a) => !emparejados.has(a.id))
    const conflictos = designacion.asesores.flatMap((designado) => {
        const ajeno = designado.documento ? noDesignados.find((a) => a.documento === designado.documento) : undefined
        return ajeno ? [`El DNI de ${designado.nombre} ya está registrado para ${ajeno.nombre}, que no está en la designación.`] : []
    })
    return { cambios, noDesignados, conflictos }
}

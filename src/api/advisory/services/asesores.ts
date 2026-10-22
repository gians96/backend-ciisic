import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import {
    claveSeccion,
    compararCiclos,
    compararSecciones,
    etiquetaSeccion,
    limpiarNombreAsesor,
    normalizarDni,
} from './seguimiento'

/**
 * Gestión de los docentes (asesores) desde el panel (spec 028): su DNI, su nombre y las secciones que atienden.
 * Hasta ahora solo existían por el Excel de la facultad. Lo que se edita aquí sobrevive a recargar el padrón
 * (ver `importacion.ts`). Todo es de quien gestiona el padrón (`reportes.gestionar`).
 */

export interface SeccionRef {
    ciclo: string
    seccion: string
}

export interface DocenteAdmin {
    id: number
    nombre: string
    /** DNI de 8 dígitos; `null` si aún no se registró (sin él no puede usar la página común). */
    documento: string | null
    secciones: SeccionRef[]
}

export interface ListaDocentes {
    asesores: DocenteAdmin[]
    /** Ciclos y secciones del padrón cargado: lo que se puede asignar. */
    secciones: SeccionRef[]
}

export interface DatosDocente {
    nombre: string
    documento?: string | null
    secciones: SeccionRef[]
}

const ordenar = (lista: SeccionRef[]) => [...lista].sort((a, b) => compararCiclos(a.ciclo, b.ciclo) || compararSecciones(a.seccion, b.seccion))

/** Ciclo y sección como los guarda el padrón: sin espacios sobrantes y en mayúsculas. */
const normalizarSeccion = ({ ciclo, seccion }: SeccionRef): SeccionRef => ({ ciclo: ciclo.trim().toUpperCase(), seccion: seccion.trim().toUpperCase() })

async function seccionesDelPadron(eventoId: number): Promise<SeccionRef[]> {
    const grupos = await prisma.padronEstudiante.groupBy({ by: ['ciclo', 'seccion'], where: { eventoId }, _count: { _all: true } })
    return ordenar(grupos.map(({ ciclo, seccion }) => ({ ciclo, seccion })))
}

export async function listarDocentes(eventoId: number): Promise<ListaDocentes> {
    const [asesores, secciones] = await Promise.all([
        prisma.asesor.findMany({ where: { eventoId }, include: { secciones: true }, orderBy: { nombre: 'asc' } }),
        seccionesDelPadron(eventoId),
    ])
    return {
        asesores: asesores.map((a) => ({
            id: a.id,
            nombre: a.nombre,
            documento: a.documento,
            secciones: ordenar(a.secciones.map(({ ciclo, seccion }) => ({ ciclo, seccion }))),
        })),
        secciones,
    }
}

/** Nombre limpio (espacios y comillas) o `422`; el DNI normalizado a 8 dígitos, `null` si no se indicó. */
function datosLimpios(datos: DatosDocente): { nombre: string, documento: string | null } {
    const nombre = limpiarNombreAsesor(datos.nombre)
    if (nombre.length < 3) throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { nombre: 'Escribe el nombre del docente' })
    const indicado = datos.documento === undefined || datos.documento === null ? '' : String(datos.documento).trim()
    if (!indicado) return { nombre, documento: null }
    const documento = normalizarDni(indicado)
    if (!documento) throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { documento: 'El DNI debe tener 8 dígitos' })
    return { nombre, documento }
}

/**
 * Las secciones deben existir en el padrón (o ya estar asignadas a este docente: un padrón nuevo puede haberlas
 * dejado sin alumnos y no por eso se le quitan solas). Devuelve la lista sin repetidos, como la guarda el padrón.
 */
async function validarSecciones(eventoId: number, pedidas: SeccionRef[], previas: SeccionRef[]): Promise<SeccionRef[]> {
    const permitidas = new Set([...(await seccionesDelPadron(eventoId)), ...previas].map((s) => claveSeccion(s.ciclo, s.seccion)))
    const unicas = new Map<string, SeccionRef>()
    for (const pedida of pedidas.map(normalizarSeccion)) {
        const clave = claveSeccion(pedida.ciclo, pedida.seccion)
        if (!permitidas.has(clave)) {
            throw unprocessable('SECTION_NOT_FOUND', `La sección ${etiquetaSeccion(pedida.ciclo, pedida.seccion)} no está en el padrón de este evento.`, {
                secciones: `La sección ${etiquetaSeccion(pedida.ciclo, pedida.seccion)} no está en el padrón`,
            })
        }
        unicas.set(clave, pedida)
    }
    return ordenar([...unicas.values()])
}

/** Un nombre o un DNI repetidos en el evento llegan como colisión del índice único: se traducen a un `409` claro. */
function traducirDuplicado(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const destino = String(Array.isArray(error.meta?.target) ? error.meta.target.join(',') : (error.meta?.target ?? ''))
        if (destino.includes('documento')) throw conflict('ADVISOR_DOCUMENT_TAKEN', 'Ese DNI ya está registrado para otro docente de este evento.')
        throw conflict('ADVISOR_NAME_TAKEN', 'Ya hay un docente con ese nombre en este evento.')
    }
    throw error
}

export async function crearDocente(eventoId: number, datos: DatosDocente): Promise<DocenteAdmin> {
    const { nombre, documento } = datosLimpios(datos)
    const secciones = await validarSecciones(eventoId, datos.secciones, [])
    try {
        const creado = await prisma.asesor.create({
            data: { eventoId, nombre, documento, secciones: { create: secciones.map((s) => ({ eventoId, ...s })) } },
            include: { secciones: true },
        })
        return { id: creado.id, nombre: creado.nombre, documento: creado.documento, secciones }
    } catch (error) {
        return traducirDuplicado(error)
    }
}

/**
 * Cambia el nombre, el DNI y las secciones del docente (la lista de secciones **reemplaza** a la anterior). Su
 * enlace personal y su último acceso no se tocan.
 */
export async function editarDocente(eventoId: number, asesorId: number, datos: DatosDocente): Promise<DocenteAdmin> {
    const actual = await prisma.asesor.findFirst({ where: { id: asesorId, eventoId }, include: { secciones: true } })
    if (!actual) throw notFound('ADVISOR_NOT_FOUND', 'El docente no existe en este evento.')
    const { nombre, documento } = datosLimpios(datos)
    const secciones = await validarSecciones(eventoId, datos.secciones, actual.secciones.map(({ ciclo, seccion }) => ({ ciclo, seccion })))
    try {
        await prisma.$transaction(async (tx) => {
            await tx.asesor.update({ where: { id: asesorId }, data: { nombre, documento } })
            await tx.asesorSeccion.deleteMany({ where: { asesorId } })
            if (secciones.length) await tx.asesorSeccion.createMany({ data: secciones.map((s) => ({ asesorId, eventoId, ...s })) })
        })
    } catch (error) {
        return traducirDuplicado(error)
    }
    return { id: asesorId, nombre, documento, secciones }
}

export async function eliminarDocente(eventoId: number, asesorId: number): Promise<void> {
    // Sus secciones se borran en cascada; sus estudiantes quedan sin asesor en esas secciones
    const { count } = await prisma.asesor.deleteMany({ where: { id: asesorId, eventoId } })
    if (!count) throw notFound('ADVISOR_NOT_FOUND', 'El docente no existe en este evento.')
}

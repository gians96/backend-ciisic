import fs from 'fs'
import type { EstadoCertificado } from '@prisma/client'
import { notFound } from '../../../core/http-error'
import {
    borrarArchivo,
    escribirArchivoAtomico,
    leerArchivoServido,
    nombreArchivoGenerado,
    rutaCertificadoFirmado,
    rutaCertificadoGenerado,
    rutaPlantilla,
} from '../../../core/almacenamiento'

/**
 * Archivos de los certificados (spec 015): `uploads/certificados/<eventoId>/{generados,firmados}`.
 * La BD guarda solo el nombre, siempre generado por el servidor; las rutas salen únicamente de
 * `almacenamiento.ts` (un nombre con otro formato no abre ningún archivo). Toda escritura es atómica.
 */
export interface ArchivosCertificado {
    eventoId: number
    estado: EstadoCertificado
    archivoGenerado: string | null
    archivoFirmado: string | null
}

export const archivoNoEncontrado = () => notFound('CERTIFICATE_FILE_NOT_FOUND', 'El archivo del certificado no está disponible.')

/** Guarda el PDF generado (`<código>-<generación>.pdf`) y devuelve el nombre que va a la BD. */
export async function guardarGenerado(eventoId: number, codigo: string, generacion: string, bytes: Uint8Array): Promise<string> {
    const nombre = nombreArchivoGenerado(codigo, generacion)
    const ruta = rutaCertificadoGenerado(eventoId, nombre) as string
    await escribirArchivoAtomico(ruta, bytes)
    return nombre
}

/** Borra un generado (sin error si ya no está). Nunca lanza: lo usan las limpiezas. */
export async function borrarGenerado(eventoId: number, archivo: string | null | undefined): Promise<void> {
    await borrarArchivo(rutaCertificadoGenerado(eventoId, archivo)).catch((error: unknown) => {
        console.error(`No se pudo borrar un PDF generado del evento ${eventoId}:`, error instanceof Error ? error.message : error)
    })
}

export function rutaGenerado(c: Pick<ArchivosCertificado, 'eventoId' | 'archivoGenerado'>): string | null {
    return rutaCertificadoGenerado(c.eventoId, c.archivoGenerado)
}

export function rutaFirmado(c: Pick<ArchivosCertificado, 'eventoId' | 'archivoFirmado'>): string | null {
    return rutaCertificadoFirmado(c.eventoId, c.archivoFirmado)
}

/**
 * Versión que se entrega para firmar: el generado si está PREPARADO; el firmado parcial si está
 * EN_FIRMA (el siguiente firmante firma sobre lo ya firmado). `null` en otros estados.
 */
export function rutaParaFirmar(c: ArchivosCertificado): string | null {
    if (c.estado === 'PREPARADO') return rutaGenerado(c)
    if (c.estado === 'EN_FIRMA') return rutaFirmado(c)
    return null
}

/** Firmado completo: solo en FIRMADO. */
export function rutaFirmadoCompleto(c: ArchivosCertificado): string | null {
    return c.estado === 'FIRMADO' ? rutaFirmado(c) : null
}

/** Si el archivo está en disco (para el ZIP: los que faltan se informan en el manifiesto). */
export function existeArchivo(ruta: string | null): ruta is string {
    if (!ruta) return false
    try {
        return fs.statSync(ruta).isFile()
    } catch {
        return false
    }
}

/** Lee a memoria un PDF del certificado (otra petición puede reemplazarlo): 404 si ya no está. */
export function leerPdfCertificado(ruta: string | null): Buffer {
    if (!ruta) throw archivoNoEncontrado()
    return leerArchivoServido(ruta, archivoNoEncontrado)
}

/** PDF de diseño de una plantilla, o `null` si el nombre no es del servidor o el archivo no está. */
export async function leerDisenoPlantilla(archivoDiseno: string): Promise<Uint8Array | null> {
    const ruta = rutaPlantilla(archivoDiseno)
    if (!ruta) return null
    try {
        return await fs.promises.readFile(ruta)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
    }
}

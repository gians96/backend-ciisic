import type { ProveedorConsulta } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { env } from '../../../../config/env'
import type { PersonaDni } from '../providers/types'

const DIA_MS = 24 * 60 * 60 * 1000

/** Persona en caché si la consulta es más reciente que el TTL configurado. */
export async function leerCache(numero: string, ahora = new Date()): Promise<PersonaDni | null> {
    const fila = await prisma.personaConsultada.findUnique({
        where: { tipoDocumento_numeroDocumento: { tipoDocumento: 'dni', numeroDocumento: numero } },
    })
    if (!fila || ahora.getTime() - fila.consultadoEn.getTime() > env.DNI_CACHE_TTL_DAYS * DIA_MS) return null
    return { numero: fila.numeroDocumento, nombres: fila.nombres, apellidoPaterno: fila.apellidoPaterno, apellidoMaterno: fila.apellidoMaterno }
}

export async function guardarCache(persona: PersonaDni, proveedor: ProveedorConsulta): Promise<void> {
    const datos = {
        nombres: persona.nombres.slice(0, 120),
        apellidoPaterno: persona.apellidoPaterno.slice(0, 120),
        apellidoMaterno: persona.apellidoMaterno.slice(0, 120),
        proveedor,
        consultadoEn: new Date(),
    }
    await prisma.personaConsultada.upsert({
        where: { tipoDocumento_numeroDocumento: { tipoDocumento: 'dni', numeroDocumento: persona.numero } },
        create: { tipoDocumento: 'dni', numeroDocumento: persona.numero, ...datos },
        update: datos,
    })
}

/**
 * Nombres oficiales (RENIEC) conocidos para un DNI, sin importar la antigüedad de la
 * consulta. Se usan como fuente de verdad al inscribir y al verificar estudiantes.
 */
export async function nombresOficiales(numero: string): Promise<PersonaDni | null> {
    const fila = await prisma.personaConsultada.findUnique({
        where: { tipoDocumento_numeroDocumento: { tipoDocumento: 'dni', numeroDocumento: numero } },
    })
    return fila
        ? { numero: fila.numeroDocumento, nombres: fila.nombres, apellidoPaterno: fila.apellidoPaterno, apellidoMaterno: fila.apellidoMaterno }
        : null
}

export function apellidosDe(persona: PersonaDni): string {
    return [persona.apellidoPaterno, persona.apellidoMaterno].filter(Boolean).join(' ')
}

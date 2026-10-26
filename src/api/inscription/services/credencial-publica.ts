import { prisma } from '../../../database/prisma'
import { notFound, unprocessable } from '../../../core/http-error'
import { REGEX_CODIGO_CREDENCIAL } from '../../../core/codigos'

/**
 * Credencial 3D de la landing (spec 038): la persona abre `<landing>/credencial/<codigo>` desde el correo y
 * ve lo mismo que se imprime en su credencial, más las tecnologías que ella elige. El código (el mismo
 * del QR) es la llave: solo responde inscripciones **APROBADAS** del evento del token.
 */

/** Tecnologías que se guardan como máximo en una credencial. */
export const MAXIMO_TECNOLOGIAS = 8

/** Forma de un id del catálogo de la landing (`vue`, `tailwind`, `node-js`…); el catálogo mismo no vive aquí. */
export const REGEX_ID_TECNOLOGIA = /^[a-z0-9][a-z0-9-]{0,29}$/

/** Lee la columna JSON con tolerancia: solo ids con forma válida, sin repetir y hasta el máximo. */
export function tecnologiasDe(valor: unknown): string[] {
    if (!Array.isArray(valor)) return []
    const ids = valor.filter((id): id is string => typeof id === 'string' && REGEX_ID_TECNOLOGIA.test(id))
    return [...new Set(ids)].slice(0, MAXIMO_TECNOLOGIAS)
}

function validarCodigo(codigo: string): void {
    if (!REGEX_CODIGO_CREDENCIAL.test(codigo)) throw unprocessable('INVALID_CODE', 'El código de la credencial no es válido.')
}

const sinCredencial = () => notFound('CREDENTIAL_NOT_FOUND', 'No se encontró una credencial con ese código.')

/**
 * Datos públicos de la credencial: nombre, clasificación o tipo (lo que se imprime) y las tecnologías
 * elegidas, y nada más: ni documento, ni correo, ni teléfono, ni montos. Código mal formado → `422
 * INVALID_CODE`; inexistente, de otro evento o sin aprobar → `404 CREDENTIAL_NOT_FOUND`.
 */
export async function credencialPublica(codigo: string, eventoId: number) {
    validarCodigo(codigo)
    const inscripcion = await prisma.inscripcion.findFirst({
        where: { codigoCredencial: codigo, eventoId, estado: { codigo: 'APROBADO' } },
        select: {
            codigoCredencial: true,
            tecnologiasCredencial: true,
            participante: { select: { nombres: true, apellidos: true } },
            tipoInscripcion: { select: { nombre: true, etiqueta: true } },
            clasificacion: { select: { nombre: true } },
            evento: { select: { nombre: true, nombreCorto: true } },
        },
    })
    if (!inscripcion) throw sinCredencial()
    return {
        nombres: inscripcion.participante.nombres,
        apellidos: inscripcion.participante.apellidos,
        codigo: inscripcion.codigoCredencial,
        clasificacion: inscripcion.clasificacion?.nombre ?? null,
        tipo: inscripcion.tipoInscripcion ? { nombre: inscripcion.tipoInscripcion.nombre, etiqueta: inscripcion.tipoInscripcion.etiqueta } : null,
        tecnologias: tecnologiasDe(inscripcion.tecnologiasCredencial),
        evento: { nombre: inscripcion.evento.nombre, nombreCorto: inscripcion.evento.nombreCorto },
    }
}

/** Guarda las tecnologías que la persona eligió (en orden: la primera define el color de su credencial). */
export async function guardarTecnologias(codigo: string, eventoId: number, tecnologias: string[]) {
    validarCodigo(codigo)
    const guardadas = tecnologiasDe(tecnologias)
    const { count } = await prisma.inscripcion.updateMany({
        where: { codigoCredencial: codigo, eventoId, estado: { codigo: 'APROBADO' } },
        data: { tecnologiasCredencial: guardadas },
    })
    if (count === 0) throw sinCredencial()
    return { tecnologias: guardadas }
}

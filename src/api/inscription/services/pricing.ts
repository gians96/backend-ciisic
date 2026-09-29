/**
 * Reglas de precio (spec 002 FR-005 y spec 004):
 * - Categoría estudiantil: precio institucional solo si la verificación de estudiante UNDC
 *   es válida; los estudiantes externos pagan el precio regular.
 * - Categoría general: precio institucional si el correo pertenece al dominio institucional
 *   del evento (limitación conocida: no verifica la propiedad del correo).
 * - Modo legacy (landing anterior): se conserva la regla histórica por dominio de correo.
 */
export interface EntradaPrecio {
    precio: number
    precioInstitucional: number
    esEstudiantil: boolean
    estudianteUndcVerificado: boolean
    correoInstitucional: boolean
    legacy?: boolean
}

export interface Precio {
    monto: number
    descuento: number
    aplicaInstitucional: boolean
}

const redondear = (valor: number) => Math.round(valor * 100) / 100

export function calcularPrecio(entrada: EntradaPrecio): Precio {
    const aplicaInstitucional = entrada.legacy
        ? entrada.correoInstitucional
        : entrada.esEstudiantil ? entrada.estudianteUndcVerificado : entrada.correoInstitucional
    const monto = aplicaInstitucional ? entrada.precioInstitucional : entrada.precio
    return { monto, descuento: Math.max(0, redondear(entrada.precio - monto)), aplicaInstitucional }
}

export function esCorreoInstitucional(correo: string, dominio: string): boolean {
    const partes = correo.trim().toLowerCase().split('@')
    return partes.length === 2 && partes[1] === dominio.trim().toLowerCase()
}

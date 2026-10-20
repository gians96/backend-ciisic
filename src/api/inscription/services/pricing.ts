/**
 * Reglas de precio (spec 002 FR-005 y spec 004):
 * - Categoría estudiantil: precio institucional solo si la verificación de estudiante UNDC
 *   es válida; los estudiantes externos pagan el precio regular.
 * - Categoría general: precio institucional si el correo pertenece al dominio institucional
 *   del evento (limitación conocida: no verifica la propiedad del correo).
 * - Modo legacy (landing anterior): se conserva la regla histórica por dominio de correo.
 * Disponibilidad (spec 016): un tipo puede ofrecerse solo a quien recibe el precio institucional
 * o solo a quien no lo recibe; se decide con el mismo `aplicaInstitucional` (`tipoDisponible`).
 */
import type { DisponibilidadTipo } from '../../../core/catalogos'
import { esCorreoDeEstudiante } from '../../../core/correo-institucional'

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

/**
 * Si el tipo se ofrece a esta persona. Recibe el `aplicaInstitucional` de `calcularPrecio`: así un
 * tipo nunca queda disponible con un precio que no le corresponde. Sin valor equivale a `TODOS`.
 */
export function tipoDisponible(disponiblePara: DisponibilidadTipo | null | undefined, aplicaInstitucional: boolean): boolean {
    if (disponiblePara === 'INSTITUCIONAL') return aplicaInstitucional
    if (disponiblePara === 'EXTERNOS') return !aplicaInstitucional
    return true
}

/** Mensaje de `REGISTRATION_TYPE_NOT_AVAILABLE`: a quién se le ofrece el tipo (o a quién no). */
export function mensajeTipoNoDisponible(disponiblePara: DisponibilidadTipo, esEstudiantil: boolean, dominio: string): string {
    const institucional = esEstudiantil ? `estudiantes verificados con su correo @${dominio}` : `correos @${dominio}`
    return disponiblePara === 'INSTITUCIONAL'
        ? `Este tipo de inscripción es solo para ${institucional}. Elige otro tipo de inscripción.`
        : `Este tipo de inscripción no está disponible para ${institucional}. Si ya te inscribiste antes, se usa el correo con el que estás registrado. Elige otro tipo de inscripción.`
}

/** Mensaje de `REGISTRATION_TYPE_NOT_AVAILABLE` cuando el tipo excluye a los estudiantes de la UNDC (spec 020). */
export const MENSAJE_TIPO_SIN_ESTUDIANTES_UNDC = 'Este tipo de inscripción no está disponible para estudiantes de la UNDC. Elige un plan presencial.'

/**
 * Spec 020: el tipo no admite estudiantes de la UNDC. Es estudiante quien tiene una verificación de
 * SIVIRENO positiva o quien queda inscrito con un correo `<código>@<dominio del evento>`; docentes,
 * administrativos y externos no se ven afectados. Se evalúa con el correo final de la inscripción.
 */
export function estudianteUndcExcluido(
    excluyeEstudiantesUndc: boolean | null | undefined,
    persona: { verificadoComoEstudiante: boolean, correo: string, dominio: string },
): boolean {
    if (excluyeEstudiantesUndc !== true) return false
    return persona.verificadoComoEstudiante || esCorreoDeEstudiante(persona.correo, persona.dominio)
}

export function esCorreoInstitucional(correo: string, dominio: string): boolean {
    const partes = correo.trim().toLowerCase().split('@')
    return partes.length === 2 && partes[1] === dominio.trim().toLowerCase()
}

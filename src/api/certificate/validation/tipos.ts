import * as yup from 'yup'

/**
 * Tipos de certificado (spec 015): catálogo global por código (PARTICIPANTE, ORGANIZADOR, PONENTE
 * y los que agregue el administrador). El código no se edita y no hay DELETE: se desactiva.
 */
export const REGEX_CODIGO_TIPO = /^[A-Z][A-Z0-9_]{1,39}$/

const mayusculas = (valor: unknown) => (typeof valor === 'string' ? valor.toUpperCase() : valor)

const nombre = () => yup.string().trim().min(2, 'El nombre tiene al menos 2 caracteres').max(80, 'El nombre tiene como máximo 80 caracteres')
/** Lo que se imprime en el campo TIPO de la plantilla (p. ej. «PARTICIPANTE»). */
const textoImpreso = () => yup.string().trim().min(1, 'El texto impreso no puede estar vacío').max(80, 'El texto impreso tiene como máximo 80 caracteres')
const orden = () => yup.number().typeError('El orden debe ser un número').integer('El orden debe ser un entero').min(0, 'El orden va de 0 a 9999').max(9999, 'El orden va de 0 a 9999')

export const crearTipoSchema = yup.object({
    codigo: yup.string().trim().transform(mayusculas).required('El código es obligatorio')
        .matches(REGEX_CODIGO_TIPO, 'El código empieza con una letra y lleva de 2 a 40 letras mayúsculas, números o «_»'),
    nombre: nombre().required('El nombre es obligatorio'),
    // Si no se envía, se imprime el nombre en mayúsculas
    textoImpreso: textoImpreso(),
    activo: yup.boolean().typeError('activo debe ser verdadero o falso').default(true),
    orden: orden(),
}).required()

export type CrearTipoInput = yup.InferType<typeof crearTipoSchema>

/** `codigo` se acepta solo si es el mismo (el panel puede enviar el formulario completo). */
export const actualizarTipoSchema = yup.object({
    codigo: yup.string().trim().transform(mayusculas),
    nombre: nombre(),
    textoImpreso: textoImpreso(),
    activo: yup.boolean().typeError('activo debe ser verdadero o falso'),
    orden: orden(),
}).required()

export type ActualizarTipoInput = yup.InferType<typeof actualizarTipoSchema>

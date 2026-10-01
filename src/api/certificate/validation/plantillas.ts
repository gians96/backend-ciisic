import * as yup from 'yup'
import { unprocessable } from '../../../core/http-error'
import { REGEX_FECHA } from '../../../core/fechas'
import { esCodigoFuente } from '../pdf/fuentes'
import {
    ALINEACIONES,
    CAPITALIZACIONES,
    FORMATOS_FECHA,
    LIMITES_CAMPOS,
    POR_DEFECTO_CAMPO,
    REGEX_COLOR,
    TIPOS_CAMPO,
    type CampoPlantilla,
} from '../pdf/tipos'

/**
 * Validación de las plantillas de certificado (spec 015). Los campos (`campos`) se validan en el
 * servicio con `validarCampos`, que conoce las páginas del diseño y responde 422
 * `INVALID_TEMPLATE_FIELDS` con un mensaje por campo (`campos[3].tamano`), para que el editor marque
 * cada error en su sitio. El resto del cuerpo se valida en la ruta (`validateBody`).
 */

/** Coordenadas: tamaño máximo de página de un PDF (200 pulgadas = 14 400 pt), en ambos sentidos. */
export const COORDENADA_MAXIMA = 14_400
/** Id de un campo dentro de la plantilla (lo usan el editor y los avisos). */
export const REGEX_ID_CAMPO = /^[A-Za-z0-9_-]{1,40}$/
export const MAX_FIRMAS_REQUERIDAS = 5
export const MAX_HORAS = 10_000

const redondear = (valor: number) => Math.round(valor * 100) / 100

const numero = (etiqueta: string) => yup.number().typeError(`${etiqueta} debe ser un número`)
const coordenada = (etiqueta: string) => numero(etiqueta)
    .min(-COORDENADA_MAXIMA, `${etiqueta} está fuera de la página`)
    .max(COORDENADA_MAXIMA, `${etiqueta} está fuera de la página`)
const opcion = <T extends string>(valores: readonly T[], etiqueta: string) => yup.string()
    .oneOf([...valores], `${etiqueta}: usa ${valores.join(', ')}`)
    .nullable()

const campoSchema = yup.object({
    id: yup.string().trim().matches(REGEX_ID_CAMPO, 'El id lleva de 1 a 40 letras, números, «-» o «_»').nullable(),
    tipo: yup.string().oneOf([...TIPOS_CAMPO], `Tipo de campo desconocido: usa ${TIPOS_CAMPO.join(', ')}`).required('El tipo es obligatorio'),
    pagina: numero('La página').integer('La página debe ser un entero').min(1, 'La página empieza en 1')
        .max(LIMITES_CAMPOS.paginasMax, `El diseño tiene como máximo ${LIMITES_CAMPOS.paginasMax} páginas`).default(1),
    x: coordenada('x').required('x es obligatorio'),
    y: coordenada('y').required('y es obligatorio'),
    ancho: numero('El ancho').min(1, 'El ancho debe ser de al menos 1 pt').max(COORDENADA_MAXIMA, 'El ancho es demasiado grande').nullable(),
    lado: numero('El lado del QR').min(LIMITES_CAMPOS.ladoQrMin, `El QR mide de ${LIMITES_CAMPOS.ladoQrMin} a ${LIMITES_CAMPOS.ladoQrMax} pt`)
        .max(LIMITES_CAMPOS.ladoQrMax, `El QR mide de ${LIMITES_CAMPOS.ladoQrMin} a ${LIMITES_CAMPOS.ladoQrMax} pt`).nullable(),
    fuente: yup.string().trim().nullable().test('fuente', 'Fuente desconocida: elige una del catálogo', (valor) => valor === null || valor === undefined || esCodigoFuente(valor)),
    tamano: numero('El tamaño').min(LIMITES_CAMPOS.tamanoMin, `El tamaño va de ${LIMITES_CAMPOS.tamanoMin} a ${LIMITES_CAMPOS.tamanoMax} pt`)
        .max(LIMITES_CAMPOS.tamanoMax, `El tamaño va de ${LIMITES_CAMPOS.tamanoMin} a ${LIMITES_CAMPOS.tamanoMax} pt`).nullable(),
    tamanoMinimo: numero('El tamaño mínimo').min(LIMITES_CAMPOS.tamanoMin, `El tamaño mínimo va de ${LIMITES_CAMPOS.tamanoMin} a ${LIMITES_CAMPOS.tamanoMax} pt`)
        .max(LIMITES_CAMPOS.tamanoMax, `El tamaño mínimo va de ${LIMITES_CAMPOS.tamanoMin} a ${LIMITES_CAMPOS.tamanoMax} pt`).nullable(),
    color: yup.string().trim().nullable().matches(REGEX_COLOR, 'El color va como #rrggbb'),
    alineacion: opcion(ALINEACIONES, 'Alineación'),
    capitalizacion: opcion(CAPITALIZACIONES, 'Capitalización'),
    lineasMax: numero('Las líneas').integer('Las líneas deben ser un entero').min(1, `Las líneas van de 1 a ${LIMITES_CAMPOS.lineasMaxMax}`)
        .max(LIMITES_CAMPOS.lineasMaxMax, `Las líneas van de 1 a ${LIMITES_CAMPOS.lineasMaxMax}`).nullable(),
    interlineado: numero('El interlineado').min(LIMITES_CAMPOS.interlineadoMin, `El interlineado va de ${LIMITES_CAMPOS.interlineadoMin} a ${LIMITES_CAMPOS.interlineadoMax}`)
        .max(LIMITES_CAMPOS.interlineadoMax, `El interlineado va de ${LIMITES_CAMPOS.interlineadoMin} a ${LIMITES_CAMPOS.interlineadoMax}`).nullable(),
    texto: yup.string().max(LIMITES_CAMPOS.textoMax, `El texto tiene como máximo ${LIMITES_CAMPOS.textoMax} caracteres`).nullable(),
    formatoFecha: opcion(FORMATOS_FECHA, 'Formato de fecha'),
})

/** Orden fijo de las claves de un campo guardado: dos listas iguales se serializan igual. */
const CLAVES_CAMPO = [
    'id', 'tipo', 'pagina', 'x', 'y', 'ancho', 'lado', 'fuente', 'tamano', 'tamanoMinimo', 'color',
    'alineacion', 'capitalizacion', 'lineasMax', 'interlineado', 'texto', 'formatoFecha',
] as const satisfies readonly (keyof CampoPlantilla)[]

const CLAVES_REDONDEADAS = new Set<string>(['x', 'y', 'ancho', 'lado', 'tamano', 'tamanoMinimo', 'interlineado'])

type CampoValidado = yup.InferType<typeof campoSchema>

/** Id de un campo que llega sin él: `<tipo>-<posición>` (p. ej. `nombre-1`). */
const idPorDefecto = (tipo: string, indice: number) => `${tipo.toLowerCase()}-${indice + 1}`

/** Campo con las claves en orden fijo, sin nulos y con las medidas redondeadas a centésimas de pt. */
function normalizarCampo(campo: CampoValidado, indice: number): CampoPlantilla {
    const salida: Record<string, unknown> = {}
    for (const clave of CLAVES_CAMPO) {
        let valor: unknown = campo[clave as keyof CampoValidado]
        if (clave === 'id' && !valor) valor = idPorDefecto(campo.tipo, indice)
        if (valor === null || valor === undefined || valor === '') continue
        if (CLAVES_REDONDEADAS.has(clave)) valor = redondear(valor as number)
        if (clave === 'color') valor = String(valor).toLowerCase()
        salida[clave] = valor
    }
    return salida as unknown as CampoPlantilla
}

/** Lee `campos` de un cuerpo multipart (texto JSON) o JSON (lista). Un JSON inválido queda como texto y falla al validar. */
export function leerCamposCrudos(valor: unknown): unknown {
    if (typeof valor !== 'string') return valor
    try {
        return JSON.parse(valor)
    } catch {
        return valor
    }
}

const errorCampos = (fields: Record<string, string>) => unprocessable('INVALID_TEMPLATE_FIELDS', 'Revisa los campos de la plantilla.', fields)

const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null && !Array.isArray(valor)

/** Id con el que quedará un campo (el suyo o el de por defecto), o `null` si no se puede saber. */
function idDeCampo(crudo: unknown, indice: number): string | null {
    if (!esObjeto(crudo)) return null
    if (typeof crudo.id === 'string' && crudo.id.trim()) return crudo.id.trim()
    return typeof crudo.tipo === 'string' && (TIPOS_CAMPO as readonly string[]).includes(crudo.tipo) ? idPorDefecto(crudo.tipo, indice) : null
}

/**
 * Valida y normaliza los campos de una plantilla de `paginas` páginas. Lanza 422
 * `INVALID_TEMPLATE_FIELDS` con `fields` (`campos[i].<propiedad>`) si algo no cumple. Cada campo se
 * valida por separado: la respuesta trae a la vez los errores de formato de unos y los de página o
 * id repetido de otros, y el editor los marca todos de una vez.
 */
export async function validarCampos(crudos: unknown, paginas: number): Promise<CampoPlantilla[]> {
    const lista = leerCamposCrudos(crudos)
    if (!Array.isArray(lista)) throw errorCampos({ campos: 'Los campos deben ser una lista' })
    if (lista.length > LIMITES_CAMPOS.maxCampos) throw errorCampos({ campos: `La plantilla admite como máximo ${LIMITES_CAMPOS.maxCampos} campos` })

    const fields: Record<string, string> = {}
    const validados: (CampoValidado | null)[] = []
    for (const [i, crudo] of lista.entries()) {
        const ruta = `campos[${i}]`
        if (!esObjeto(crudo)) {
            fields[ruta] = 'Cada campo debe ser un objeto'
            validados.push(null)
            continue
        }
        try {
            validados.push(await campoSchema.validate(crudo, { abortEarly: false, stripUnknown: true }))
        } catch (error) {
            if (!(error instanceof yup.ValidationError)) throw error
            for (const item of error.inner.length ? error.inner : [error]) {
                const clave = item.path ? `${ruta}.${item.path}` : ruta
                if (!fields[clave]) fields[clave] = item.message
            }
            validados.push(null)
        }
    }

    validados.forEach((campo, i) => {
        if (!campo) return
        const ruta = `campos[${i}]`
        if (campo.pagina > paginas) fields[`${ruta}.pagina`] = `El diseño tiene ${paginas} ${paginas === 1 ? 'página' : 'páginas'}`
        if (campo.tipo === 'TEXTO' && !campo.texto?.trim()) fields[`${ruta}.texto`] = 'Un campo TEXTO necesita su texto'
        if (campo.tamanoMinimo && campo.tamanoMinimo > (campo.tamano ?? POR_DEFECTO_CAMPO.tamano)) {
            fields[`${ruta}.tamanoMinimo`] = 'El tamaño mínimo no puede superar al tamaño'
        }
    })

    // Ids repetidos, también entre campos con otros errores (el editor los corrige todos de una vez)
    const ids = new Map<string, number>()
    lista.forEach((crudo, i) => {
        const id = idDeCampo(crudo, i)
        if (id === null || fields[`campos[${i}].id`]) return
        if (ids.has(id)) fields[`campos[${i}].id`] = `Id repetido (también en campos[${ids.get(id)}])`
        else ids.set(id, i)
    })

    if (Object.keys(fields).length) throw errorCampos(fields)
    return (validados as CampoValidado[]).map(normalizarCampo)
}

/** Copia con las claves de cada objeto ordenadas (MySQL reordena las claves de un JSON al guardarlo). */
function canonico(valor: unknown): unknown {
    if (Array.isArray(valor)) return valor.map(canonico)
    if (valor && typeof valor === 'object') {
        return Object.fromEntries(Object.keys(valor).sort().map((clave) => [clave, canonico((valor as Record<string, unknown>)[clave])]))
    }
    return valor
}

/**
 * Igualdad de dos listas de campos (decide si la versión sube), sin importar el orden de las claves:
 * los campos leídos de la BD vuelven con las claves en el orden de MySQL, no en el de `CLAVES_CAMPO`.
 */
export function mismosCampos(a: unknown, b: unknown): boolean {
    return JSON.stringify(canonico(a ?? [])) === JSON.stringify(canonico(b ?? []))
}

// ─── Cuerpos de las rutas ────────────────────────────────────────────────────

/** Multipart y JSON: un texto vacío equivale a no enviarlo. */
const vacioAIndefinido = (valor: unknown) => (valor === '' ? undefined : valor)
/** `''` o `'null'` (multipart) → null. */
const vacioANulo = (valor: unknown) => (valor === '' || valor === 'null' ? null : valor)

const nombrePlantilla = () => yup.string().trim().min(2, 'El nombre tiene al menos 2 caracteres').max(120, 'El nombre tiene como máximo 120 caracteres')
const horasPorDefecto = () => yup.number().transform((valor, original) => vacioANulo(original) === null ? null : valor)
    .typeError('Las horas deben ser un número').integer('Las horas deben ser un entero').min(0, 'Las horas no pueden ser negativas').max(MAX_HORAS, 'Demasiadas horas').nullable()
const firmasRequeridas = () => yup.number().transform((valor, original) => vacioAIndefinido(original) === undefined ? undefined : valor)
    .typeError('Las firmas deben ser un número').integer('Las firmas deben ser un entero').min(1, `Las firmas requeridas van de 1 a ${MAX_FIRMAS_REQUERIDAS}`)
    .max(MAX_FIRMAS_REQUERIDAS, `Las firmas requeridas van de 1 a ${MAX_FIRMAS_REQUERIDAS}`)

/** `POST /v1/events/:eventId/certificate-templates` (multipart: `file`, `nombre`, `horasPorDefecto`, `firmasRequeridas`, `campos` en JSON). */
export const crearPlantillaSchema = yup.object({
    nombre: nombrePlantilla().transform(vacioAIndefinido),
    horasPorDefecto: horasPorDefecto(),
    firmasRequeridas: firmasRequeridas(),
    // Se valida en el servicio con las páginas del diseño
    campos: yup.mixed(),
}).required()

export type CrearPlantillaInput = yup.InferType<typeof crearPlantillaSchema>

/** `PUT /v1/certificate-templates/:id`: actualización parcial; la versión sube si cambian los campos. */
export const actualizarPlantillaSchema = yup.object({
    nombre: nombrePlantilla(),
    campos: yup.mixed(),
    horasPorDefecto: horasPorDefecto(),
    firmasRequeridas: firmasRequeridas(),
    activa: yup.boolean().typeError('activa debe ser verdadero o falso'),
    /** Versión que tiene el editor: si la plantilla cambió desde entonces, 409 `TEMPLATE_CHANGED`. */
    version: yup.number().typeError('La versión debe ser un número').integer().min(1),
}).required()

export type ActualizarPlantillaInput = yup.InferType<typeof actualizarPlantillaSchema>

/**
 * `POST /v1/certificate-templates/:id/preview`: campos sin guardar (si no, los de la plantilla),
 * tipo de certificado (código) y datos de ejemplo que reemplazan a los predeterminados.
 */
export const vistaPreviaSchema = yup.object({
    campos: yup.mixed(),
    tipoCodigo: yup.string().trim().uppercase().max(40),
    datos: yup.object({
        nombre: yup.string().trim().max(200, 'El nombre tiene como máximo 200 caracteres'),
        documento: yup.string().trim().max(40, 'El documento tiene como máximo 40 caracteres'),
        detalle: yup.string().trim().max(500, 'El detalle tiene como máximo 500 caracteres').nullable(),
        horas: yup.number().typeError('Las horas deben ser un número').integer().min(0).max(MAX_HORAS).nullable(),
        fechaEmision: yup.string().trim().matches(REGEX_FECHA, 'La fecha va como AAAA-MM-DD'),
    }).default(undefined),
}).required()

export type VistaPreviaInput = yup.InferType<typeof vistaPreviaSchema>

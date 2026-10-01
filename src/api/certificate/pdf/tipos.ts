/**
 * Tipos del motor de certificados (spec 015): campos de una plantilla y datos que se estampan.
 *
 * Coordenadas en puntos PDF, absolutas en la página (origen abajo a la izquierda, como el sistema de
 * coordenadas del PDF; si la CropBox está desplazada, el editor suma su origen).
 * - Texto: `y` es la línea base de la primera línea; las siguientes bajan `tamano × interlineado`.
 *   Con `ancho`, la caja es [x, x + ancho]: el texto se alinea dentro, se reduce hasta
 *   `tamanoMinimo` y se parte hasta `lineasMax` líneas. Sin `ancho`, `x` es el ancla: el texto
 *   empieza en x (IZQUIERDA), se centra en x (CENTRO) o termina en x (DERECHA), sin partir ni reducir.
 * - QR: cuadrado de lado `lado` con su esquina inferior izquierda en (x, y), fondo blanco incluido.
 */

export const TIPOS_CAMPO = ['NOMBRE', 'TIPO', 'CODIGO', 'QR', 'FECHA_EMISION', 'HORAS', 'EVENTO', 'DOCUMENTO', 'DETALLE', 'TEXTO'] as const
export type TipoCampo = typeof TIPOS_CAMPO[number]

export const ALINEACIONES = ['IZQUIERDA', 'CENTRO', 'DERECHA'] as const
export type Alineacion = typeof ALINEACIONES[number]

export const CAPITALIZACIONES = ['ORIGINAL', 'MAYUSCULAS', 'TITULO'] as const
export type Capitalizacion = typeof CAPITALIZACIONES[number]

export const FORMATOS_FECHA = ['LARGO', 'CORTO'] as const
export type FormatoFecha = typeof FORMATOS_FECHA[number]

/** Marcadores que admite `texto` (`{nombre}`, `{horas}`…). Uno desconocido se deja tal cual. */
export const MARCADORES = ['nombre', 'tipo', 'evento', 'eventoCorto', 'horas', 'fecha', 'detalle', 'codigo', 'documento'] as const
export type Marcador = typeof MARCADORES[number]

/** Límites que valida el esquema de la plantilla (validation.ts) y que respeta el motor. */
export const LIMITES_CAMPOS = {
    maxCampos: 30,
    tamanoMin: 4,
    tamanoMax: 200,
    ladoQrMin: 36,
    ladoQrMax: 300,
    lineasMaxMax: 10,
    interlineadoMin: 0.8,
    interlineadoMax: 3,
    textoMax: 500,
    paginasMax: 2,
} as const

/** Color `#rrggbb`. */
export const REGEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Valores por defecto de los campos opcionales. */
export const POR_DEFECTO_CAMPO = {
    tamano: 12,
    color: '#000000',
    alineacion: 'IZQUIERDA' as Alineacion,
    capitalizacion: 'ORIGINAL' as Capitalizacion,
    lineasMax: 1,
    interlineado: 1.2,
    formatoFecha: 'LARGO' as FormatoFecha,
} as const

export interface CampoPlantilla {
    /** Identificador estable dentro de la plantilla (lo usan el editor y los avisos). */
    id: string
    tipo: TipoCampo
    /** Página 1-based. */
    pagina: number
    x: number
    y: number
    /** Texto: ancho de la caja (opcional). */
    ancho?: number | null
    /** QR: lado del cuadrado (36–300 pt). */
    lado?: number | null
    /** Código del catálogo de `fuentes.ts`; por defecto MONTSERRAT. */
    fuente?: string | null
    tamano?: number | null
    /** Con `ancho`: tamaño mínimo al que se reduce antes de partir o desbordar (por defecto, `tamano`). */
    tamanoMinimo?: number | null
    color?: string | null
    alineacion?: Alineacion | null
    capitalizacion?: Capitalizacion | null
    lineasMax?: number | null
    interlineado?: number | null
    /** Texto con marcadores. Obligatorio en TEXTO; en los demás reemplaza al valor del tipo. */
    texto?: string | null
    formatoFecha?: FormatoFecha | null
}

/** Datos de un certificado que se estampan (copia fija del certificado y su evento). */
export interface DatosCertificado {
    /** Nombre impreso (`nombre_impreso`). */
    nombre: string
    /** Texto impreso del tipo (`tipos_certificado.texto_impreso`), p. ej. PARTICIPANTE. */
    tipo: string
    /** Código que se imprime (`codigo_impreso`; con el proveedor LOCAL, el mismo código). */
    codigo: string
    /** Columna DATE (medianoche UTC). */
    fechaEmision: Date
    horas: number | null
    evento: string
    eventoCorto: string
    /** Documento ya formateado, p. ej. `DNI 12345678`. */
    documento: string
    detalle: string | null
    /** URL que va en el QR (`url_verificacion` congelada). */
    urlVerificacion: string
}

export type CodigoAviso = 'GLIFO_RESPALDO' | 'GLIFO_FALTANTE' | 'DESBORDA' | 'PAGINA_INEXISTENTE' | 'FUENTE_DESCONOCIDA' | 'FUENTE_SIN_SUBCONJUNTO'

/** Aviso del estampado: el PDF se genera igual, pero conviene revisarlo. */
export interface AvisoEstampado {
    /** `id` del campo, o `null` si es del documento. */
    campo: string | null
    codigo: CodigoAviso
    mensaje: string
}

/** `Subject` del PDF generado: identifica el certificado y su generación aunque la herramienta de firma reescriba el archivo. */
export function subjectDeCertificado(codigo: string, generacion: string): string {
    return `ciisic:${codigo}:${generacion}`
}

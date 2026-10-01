import * as fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type Color, type PDFFont, type PDFPage } from 'pdf-lib'
import { HttpError, unprocessable } from '../../../core/http-error'
import { esCodigoFuente, FUENTE_POR_DEFECTO, FUENTES, fuenteFontkit, bytesFuente, respaldoDe, type CodigoFuente } from './fuentes'
import { dibujarQr } from './qr'
import { ajustarTexto, aplicarCapitalizacion, formatearFecha, normalizarTexto, posicionX, reemplazarMarcadores } from './texto'
import {
    LIMITES_CAMPOS,
    POR_DEFECTO_CAMPO,
    REGEX_COLOR,
    subjectDeCertificado,
    type AvisoEstampado,
    type CampoPlantilla,
    type DatosCertificado,
    type Marcador,
} from './tipos'

/**
 * Estampado de certificados con pdf-lib sobre el PDF de diseño (spec 015). Puppeteer queda solo
 * para la credencial. El resultado:
 * - conserva el diseño (`updateMetadata: false`) y se guarda sin object streams
 *   (`useObjectStreams: false`), más compatible con las herramientas de firma;
 * - lleva `Title` = «Certificado <código impreso>» y `Subject` = `ciisic:<código>:<generación>`,
 *   con lo que se reconoce el firmado aunque la herramienta reescriba el archivo;
 * - embebe solo los glifos usados (`subset`); si el subconjunto falla se repite con la fuente
 *   completa y se avisa.
 * Los caracteres que la fuente elegida no tiene se escriben con DejaVu Sans (aviso
 * GLIFO_RESPALDO); los que tampoco tiene DejaVu se reemplazan por «?» (aviso GLIFO_FALTANTE).
 */
export interface EntradaEstampado {
    /** PDF de diseño de la plantilla. */
    diseno: Uint8Array
    campos: readonly CampoPlantilla[]
    datos: DatosCertificado
    /** Código interno del certificado (va en `Subject`; `datos.codigo` es el impreso). */
    codigo: string
    /** Generación de este archivo (8 caracteres). */
    generacion: string
}

export interface ResultadoEstampado {
    bytes: Uint8Array
    avisos: AvisoEstampado[]
}

const QR_LADO_POR_DEFECTO = 90

export interface Tramo {
    texto: string
    fuente: CodigoFuente
}

function aColor(valor: string | null | undefined): Color {
    const hex = valor && REGEX_COLOR.test(valor) ? valor.slice(1) : POR_DEFECTO_CAMPO.color.slice(1)
    return rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
}

function limitar(valor: number, minimo: number, maximo: number): number {
    return Math.min(maximo, Math.max(minimo, valor))
}

function marcadoresDe(datos: DatosCertificado, campo: CampoPlantilla): Record<Marcador, string> {
    return {
        nombre: datos.nombre,
        tipo: datos.tipo,
        evento: datos.evento,
        eventoCorto: datos.eventoCorto,
        horas: datos.horas === null || datos.horas === undefined ? '' : String(datos.horas),
        fecha: formatearFecha(datos.fechaEmision, campo.formatoFecha ?? POR_DEFECTO_CAMPO.formatoFecha),
        detalle: datos.detalle ?? '',
        codigo: datos.codigo,
        documento: datos.documento,
    }
}

/**
 * Texto de un campo antes de capitalizar; `null` si no hay nada que escribir. Un campo HORAS o
 * DETALLE sin valor no se escribe aunque tenga texto (si no, saldría «horas académicas» solo).
 */
export function textoDelCampo(campo: CampoPlantilla, datos: DatosCertificado): string | null {
    const marcadores = marcadoresDe(datos, campo)
    if ((campo.tipo === 'HORAS' && !marcadores.horas) || (campo.tipo === 'DETALLE' && !marcadores.detalle)) return null
    if (campo.texto) return reemplazarMarcadores(campo.texto, marcadores)
    switch (campo.tipo) {
        case 'NOMBRE': return marcadores.nombre
        case 'TIPO': return marcadores.tipo
        case 'CODIGO': return marcadores.codigo
        case 'FECHA_EMISION': return marcadores.fecha
        case 'HORAS': return marcadores.horas || null
        case 'EVENTO': return marcadores.evento
        case 'DOCUMENTO': return marcadores.documento
        case 'DETALLE': return marcadores.detalle || null
        default: return null
    }
}

/** Fuentes embebidas en un documento, una sola vez cada una (solo las que se usan). */
class FuentesDelDocumento {
    private readonly embebidas = new Map<CodigoFuente, Promise<PDFFont>>()

    constructor(private readonly doc: PDFDocument, private readonly subset: boolean) {}

    obtener(codigo: CodigoFuente): Promise<PDFFont> {
        let fuente = this.embebidas.get(codigo)
        if (!fuente) {
            fuente = this.doc.embedFont(bytesFuente(codigo), { subset: this.subset })
            this.embebidas.set(codigo, fuente)
        }
        return fuente
    }
}

/**
 * Asegura cada carácter: con la fuente elegida, con su respaldo DejaVu o como «?». Devuelve el texto
 * seguro y los caracteres que fueron a respaldo o se reemplazaron.
 */
export function resolverGlifos(texto: string, fuente: CodigoFuente): { texto: string, respaldo: string[], faltantes: string[] } {
    const principal = fuenteFontkit(fuente)
    const respaldo = fuenteFontkit(respaldoDe(fuente))
    const enRespaldo = new Set<string>()
    const faltantes = new Set<string>()
    let seguro = ''
    for (const caracter of texto) {
        const punto = caracter.codePointAt(0) as number
        if (principal.hasGlyphForCodePoint(punto)) {
            seguro += caracter
        } else if (respaldo.hasGlyphForCodePoint(punto)) {
            seguro += caracter
            enRespaldo.add(caracter)
        } else {
            seguro += '?'
            faltantes.add(caracter)
        }
    }
    return { texto: seguro, respaldo: [...enRespaldo], faltantes: [...faltantes] }
}

/** Divide un texto (ya seguro) en tramos de la fuente elegida y de su respaldo. */
export function tramosDe(texto: string, fuente: CodigoFuente): Tramo[] {
    const principal = fuenteFontkit(fuente)
    const respaldo = respaldoDe(fuente)
    const tramos: Tramo[] = []
    for (const caracter of texto) {
        const destino = principal.hasGlyphForCodePoint(caracter.codePointAt(0) as number) ? fuente : respaldo
        const ultimo = tramos[tramos.length - 1]
        if (ultimo && ultimo.fuente === destino) ultimo.texto += caracter
        else tramos.push({ texto: caracter, fuente: destino })
    }
    return tramos
}

async function estamparTexto(pagina: PDFPage, campo: CampoPlantilla, texto: string, fuentes: FuentesDelDocumento, avisos: AvisoEstampado[]): Promise<void> {
    let fuente: CodigoFuente = FUENTE_POR_DEFECTO
    if (campo.fuente && esCodigoFuente(campo.fuente)) fuente = campo.fuente
    else if (campo.fuente) avisos.push({ campo: campo.id, codigo: 'FUENTE_DESCONOCIDA', mensaje: `La fuente «${campo.fuente}» no existe: se usó ${FUENTES[FUENTE_POR_DEFECTO].nombre}.` })

    const capitalizado = aplicarCapitalizacion(normalizarTexto(texto), campo.capitalizacion)
    if (!capitalizado) return
    const glifos = resolverGlifos(capitalizado, fuente)
    if (glifos.respaldo.length) {
        avisos.push({ campo: campo.id, codigo: 'GLIFO_RESPALDO', mensaje: `${FUENTES[fuente].nombre} no tiene «${glifos.respaldo.join('')}»: se escribió con ${FUENTES[respaldoDe(fuente)].nombre}.` })
    }
    if (glifos.faltantes.length) {
        avisos.push({ campo: campo.id, codigo: 'GLIFO_FALTANTE', mensaje: `Ninguna fuente tiene «${glifos.faltantes.join('')}»: se reemplazó por «?».` })
    }

    // Solo se embebe el respaldo si hace falta. El ancho es lineal en el tamaño: se mide a 1 pt y con caché
    const principal = await fuentes.obtener(fuente)
    const respaldo = glifos.respaldo.length ? await fuentes.obtener(respaldoDe(fuente)) : principal
    const pdfDe = (codigo: CodigoFuente): PDFFont => (codigo === fuente ? principal : respaldo)
    const unitarios = new Map<string, number>()
    const anchoUnitario = (linea: string): number => {
        let ancho = unitarios.get(linea)
        if (ancho === undefined) {
            ancho = tramosDe(linea, fuente).reduce((total, tramo) => total + pdfDe(tramo.fuente).widthOfTextAtSize(tramo.texto, 1), 0)
            unitarios.set(linea, ancho)
        }
        return ancho
    }

    const tamano = limitar(campo.tamano ?? POR_DEFECTO_CAMPO.tamano, LIMITES_CAMPOS.tamanoMin, LIMITES_CAMPOS.tamanoMax)
    const tamanoMinimo = campo.tamanoMinimo ? limitar(campo.tamanoMinimo, LIMITES_CAMPOS.tamanoMin, tamano) : tamano
    const ajuste = ajustarTexto({
        texto: glifos.texto,
        tamano,
        tamanoMinimo,
        anchoMax: campo.ancho ?? null,
        lineasMax: campo.lineasMax ?? POR_DEFECTO_CAMPO.lineasMax,
        medir: (linea, s) => anchoUnitario(linea) * s,
    })
    if (ajuste.desborda) {
        avisos.push({ campo: campo.id, codigo: 'DESBORDA', mensaje: `El texto no entra en la caja ni a ${ajuste.tamano} pt: sale de los márgenes.` })
    }

    const color = aColor(campo.color)
    const interlineado = campo.interlineado ?? POR_DEFECTO_CAMPO.interlineado
    for (const [indice, linea] of ajuste.lineas.entries()) {
        if (!linea) continue
        let x = posicionX(campo.alineacion ?? POR_DEFECTO_CAMPO.alineacion, campo.x, campo.ancho, anchoUnitario(linea) * ajuste.tamano)
        const y = campo.y - indice * ajuste.tamano * interlineado
        for (const tramo of tramosDe(linea, fuente)) {
            const pdfFuente = pdfDe(tramo.fuente)
            pagina.drawText(tramo.texto, { x, y, size: ajuste.tamano, font: pdfFuente, color })
            x += pdfFuente.widthOfTextAtSize(tramo.texto, ajuste.tamano)
        }
    }
}

async function estamparCon(entrada: EntradaEstampado, subset: boolean): Promise<ResultadoEstampado> {
    let doc: PDFDocument
    try {
        doc = await PDFDocument.load(entrada.diseno, { updateMetadata: false })
    } catch {
        throw unprocessable('INVALID_PDF', 'El PDF de diseño de la plantilla no se pudo abrir.')
    }
    doc.registerFontkit(fontkit)
    const fuentes = new FuentesDelDocumento(doc, subset)
    const paginas = doc.getPages()
    const avisos: AvisoEstampado[] = []

    for (const campo of entrada.campos) {
        const pagina = paginas[campo.pagina - 1]
        if (!pagina) {
            avisos.push({ campo: campo.id, codigo: 'PAGINA_INEXISTENTE', mensaje: `El campo está en la página ${campo.pagina} y el diseño tiene ${paginas.length}.` })
            continue
        }
        if (campo.tipo === 'QR') {
            if (!entrada.datos.urlVerificacion) continue
            const lado = limitar(campo.lado ?? QR_LADO_POR_DEFECTO, LIMITES_CAMPOS.ladoQrMin, LIMITES_CAMPOS.ladoQrMax)
            dibujarQr(pagina, entrada.datos.urlVerificacion, { x: campo.x, y: campo.y, lado, color: aColor(campo.color) })
            continue
        }
        const texto = textoDelCampo(campo, entrada.datos)
        if (texto) await estamparTexto(pagina, campo, texto, fuentes, avisos)
    }

    doc.setTitle(`Certificado ${entrada.datos.codigo}`)
    doc.setSubject(subjectDeCertificado(entrada.codigo, entrada.generacion))
    const bytes = await doc.save({ useObjectStreams: false })
    return { bytes, avisos }
}

/** Estampa los campos sobre el diseño y devuelve el PDF con sus avisos. */
export async function estampar(entrada: EntradaEstampado): Promise<ResultadoEstampado> {
    try {
        return await estamparCon(entrada, true)
    } catch (error) {
        if (error instanceof HttpError) throw error
        // El subconjunto de glifos de fontkit puede fallar con algunas fuentes: se repite con la fuente completa
        const resultado = await estamparCon(entrada, false)
        resultado.avisos.push({ campo: null, codigo: 'FUENTE_SIN_SUBCONJUNTO', mensaje: 'Las fuentes se incluyeron completas (el archivo pesa más).' })
        return resultado
    }
}

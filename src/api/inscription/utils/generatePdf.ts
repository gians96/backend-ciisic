import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer'
import { renderTemplate } from '../../../core/html'
import { ZONA_HORARIA } from '../../../core/fechas'
import { limitarConcurrencia } from '../../../core/concurrencia'
import { rutaFoto } from '../../../core/almacenamiento'
import { MIME_POR_TIPO, type TipoFoto } from '../../../core/imagenes'
import { uploadsDir } from '../../../middlewares/upload'
import type { InscripcionDetalle } from '../services/mappers'

const formatoFecha = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' })
const formatear = (date?: Date | null) => (date ? formatoFecha.format(date) : '---')
const instante = (date?: Date | null) => (date ? new Date(date).getTime() : 0)

/** Sube al cambiar la plantilla o lo que se imprime: así los PDF guardados dejan de reutilizarse. */
export const VERSION_PLANTILLA = 2

const DIRECTORIO_CREDENCIALES = path.join(uploadsDir, 'credenciales')

/**
 * Huella (12 hex) de todo lo que se imprime en la credencial (spec 014): código, datos de la
 * persona y su foto, tipo de inscripción, fechas y la última edición del evento (nombre, contacto,
 * logo). Si cambia algo de eso, cambia el nombre del archivo y el PDF se vuelve a generar.
 */
export function huellaCredencial(inscripcion: InscripcionDetalle): string {
    const p = inscripcion.participante
    const tipo = inscripcion.tipoInscripcion
    const datos = [
        VERSION_PLANTILLA, inscripcion.id, inscripcion.codigoCredencial ?? '',
        p.nombres, p.apellidos, p.tipoDocumentoId, p.numeroDocumento, p.correo, p.celular ?? '', p.fotoArchivo ?? '',
        tipo?.id ?? null, tipo?.nombre ?? '', tipo?.etiqueta ?? '',
        instante(inscripcion.evento.actualizadoEn), formatear(inscripcion.creadoEn), inscripcion.revisadoEn ? formatear(inscripcion.revisadoEn) : '',
    ]
    return crypto.createHash('sha256').update(JSON.stringify(datos)).digest('hex').slice(0, 12)
}

/** Ruta del PDF de credencial: `uploads/credenciales/<evento>/<id>-<huella>.pdf`. */
export function rutaCredencial(inscripcion: InscripcionDetalle): string {
    return path.join(DIRECTORIO_CREDENCIALES, path.basename(inscripcion.evento.codigo), `${inscripcion.id}-${huellaCredencial(inscripcion)}.pdf`)
}

/**
 * Borra los PDF de credencial de una inscripción (`<id>.pdf` de antes de la spec 014 y
 * `<id>-<huella>.pdf`) en todas las carpetas de eventos, salvo `conservar`. Nunca lanza; devuelve
 * cuántos borró.
 */
export function borrarCredenciales(inscripcionId: number, conservar?: string): number {
    const patron = new RegExp(`^${inscripcionId}(-[0-9a-f]{12})?\\.pdf$`)
    let borrados = 0
    try {
        if (!fs.existsSync(DIRECTORIO_CREDENCIALES)) return 0
        for (const carpeta of fs.readdirSync(DIRECTORIO_CREDENCIALES, { withFileTypes: true })) {
            if (!carpeta.isDirectory()) continue
            const directorio = path.join(DIRECTORIO_CREDENCIALES, carpeta.name)
            for (const archivo of fs.readdirSync(directorio)) {
                const ruta = path.join(directorio, archivo)
                if (!patron.test(archivo) || (conservar && path.resolve(ruta) === path.resolve(conservar))) continue
                fs.rmSync(ruta, { force: true })
                borrados++
            }
        }
    } catch (error) {
        console.error('No se pudieron borrar credenciales anteriores:', (error as Error).message)
    }
    return borrados
}

function logoEnBase64(logoArchivo: string | null): string {
    const candidatos = [
        ...(logoArchivo ? [path.join(uploadsDir, 'logos', path.basename(logoArchivo))] : []),
        path.join(process.cwd(), 'public', 'logo_congreso.png'),
    ]
    const encontrado = candidatos.find((ruta) => fs.existsSync(ruta))
    if (!encontrado) return ''
    const mime = encontrado.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
    return `data:${mime};base64,${fs.readFileSync(encontrado).toString('base64')}`
}

/** Foto del participante como data URL, o '' si no tiene o el archivo ya no está. */
function fotoEnBase64(fotoArchivo: string | null | undefined): string {
    const ruta = rutaFoto(fotoArchivo)
    if (!ruta || !fs.existsSync(ruta)) return ''
    const tipo = path.extname(ruta).slice(1) as TipoFoto
    return `data:${MIME_POR_TIPO[tipo]};base64,${fs.readFileSync(ruta).toString('base64')}`
}

async function htmlDeCredencial(inscripcion: InscripcionDetalle, codigo: string): Promise<string> {
    const plantilla = fs.readFileSync(path.join(__dirname, 'templates', 'inscription.html'), 'utf8')
    const tipo = inscripcion.tipoInscripcion
    const foto = fotoEnBase64(inscripcion.participante.fotoArchivo)
    return renderTemplate(plantilla, {
        LOGO: logoEnBase64(inscripcion.evento.logoArchivo),
        QR: await QRCode.toDataURL(codigo),
        CODIGO: codigo,
        FOTO: foto,
        CLASE_FOTO: foto ? 'con-foto' : 'sin-foto',
        FECHA_GENERACION: formatear(new Date()),
        EVENTO_NOMBRE: inscripcion.evento.nombre,
        EVENTO_NOMBRE_CORTO: inscripcion.evento.nombreCorto,
        EVENTO_TELEFONO: inscripcion.evento.telefonoContacto ?? '---',
        EVENTO_CORREO: inscripcion.evento.correoContacto ?? '---',
        NOMBRES: inscripcion.participante.nombres,
        APELLIDOS: inscripcion.participante.apellidos,
        TIPO_DOCUMENTO: inscripcion.participante.tipoDocumentoId.toUpperCase(),
        NUMERO_DOCUMENTO: inscripcion.participante.numeroDocumento,
        CORREO: inscripcion.participante.correo,
        CELULAR: inscripcion.participante.celular || '---',
        TIPO_INSCRIPCION: tipo ? [tipo.nombre, tipo.etiqueta].filter(Boolean).join(' · ') : '---',
        FECHA_CREACION: formatear(inscripcion.creadoEn),
        FECHA_APROBADA: formatear(inscripcion.revisadoEn ?? new Date()),
    }, ['LOGO', 'QR'])
}

/** Tope de cada paso de puppeteer: un navegador colgado no retiene para siempre uno de los 2 turnos. */
const ESPERA_PUPPETEER_MS = 30_000

/** Orden de inicio de las generaciones (en este proceso). */
let secuenciaGeneraciones = 0
/** Por inscripción, la generación más reciente (por orden de inicio) que ya escribió su PDF. */
const ultimaGeneracionEscrita = new Map<number, number>()

async function imprimir(inscripcion: InscripcionDetalle, destino: string): Promise<string> {
    const generacion = ++secuenciaGeneraciones
    const codigo = inscripcion.codigoCredencial
    if (!codigo) throw new Error('La inscripción no tiene código de credencial (usa asegurarCodigoCredencial)')
    const html = await htmlDeCredencial(inscripcion, codigo)
    const directorio = path.dirname(destino)
    fs.mkdirSync(directorio, { recursive: true })

    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        timeout: ESPERA_PUPPETEER_MS,
        ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    })
    let pdf: Uint8Array
    try {
        const page = await browser.newPage()
        // La plantilla es autocontenida: se bloquea toda carga de red.
        await page.setRequestInterception(true)
        page.on('request', (request) => (request.url().startsWith('data:') ? request.continue() : request.abort()))
        await page.setContent(html, { waitUntil: 'load', timeout: ESPERA_PUPPETEER_MS })
        pdf = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
            printBackground: true,
            preferCSSPageSize: true,
            timeout: ESPERA_PUPPETEER_MS,
        })
    } finally {
        await browser.close()
    }
    // Se escribe aparte y se renombra: quien lea el PDF nunca ve un archivo a medio escribir
    const temporal = path.join(directorio, `.${path.basename(destino)}.${crypto.randomBytes(4).toString('hex')}.tmp`)
    fs.writeFileSync(temporal, pdf)
    fs.renameSync(temporal, destino)
    // Si una generación que empezó después (con datos más nuevos) ya escribió el suyo, este no lo
    // borra: queda como sobrante hasta la próxima generación
    if ((ultimaGeneracionEscrita.get(inscripcion.id) ?? 0) < generacion) {
        ultimaGeneracionEscrita.set(inscripcion.id, generacion)
        borrarCredenciales(inscripcion.id, destino)
    }
    return destino
}

/** Puppeteer: como mucho 2 navegadores a la vez y 30 PDF en espera; si no, 503 `PDF_BUSY`. */
const enTurno = limitarConcurrencia(2, 30)
/** Generaciones en curso por archivo: pedir dos veces el mismo PDF no abre dos navegadores. */
const enCurso = new Map<string, Promise<string>>()

/**
 * Genera la credencial PDF con la marca del evento; el QR codifica `codigoCredencial` (debe estar
 * asignado: ver `asegurarCodigoCredencial`). Todo dato de la persona se escapa (`renderTemplate`);
 * solo el logo y el QR (generados por el servidor) van sin escapar. Borra las versiones anteriores.
 */
export function generarCredencialPdf(inscripcion: InscripcionDetalle): Promise<string> {
    const destino = rutaCredencial(inscripcion)
    const pendiente = enCurso.get(destino)
    if (pendiente) return pendiente
    const promesa = enTurno(() => imprimir(inscripcion, destino)).finally(() => enCurso.delete(destino))
    enCurso.set(destino, promesa)
    return promesa
}

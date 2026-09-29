import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer'
import { renderTemplate } from '../../../core/html'
import { ZONA_HORARIA } from '../../../core/fechas'
import { uploadsDir } from '../../../middlewares/upload'
import type { InscripcionDetalle } from '../services/mappers'

const formatoFecha = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' })
const formatear = (date?: Date | null) => (date ? formatoFecha.format(date) : '---')

/** Ruta del PDF de credencial de una inscripción: `uploads/credenciales/<evento>/<id>.pdf`. */
export function rutaCredencial(inscripcion: Pick<InscripcionDetalle, 'id' | 'evento'>): string {
    return path.join(uploadsDir, 'credenciales', path.basename(inscripcion.evento.codigo), `${inscripcion.id}.pdf`)
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

/**
 * Genera la credencial PDF con la marca del evento. Todo dato de la persona se escapa
 * (`renderTemplate`); solo el logo y el QR (generados por el servidor) van sin escapar.
 */
export async function generarCredencialPdf(inscripcion: InscripcionDetalle): Promise<string> {
    const destino = rutaCredencial(inscripcion)
    fs.mkdirSync(path.dirname(destino), { recursive: true })

    const plantilla = fs.readFileSync(path.join(__dirname, 'templates', 'inscription.html'), 'utf8')
    const tipo = inscripcion.tipoInscripcion
    const html = renderTemplate(plantilla, {
        LOGO: logoEnBase64(inscripcion.evento.logoArchivo),
        QR: await QRCode.toDataURL(String(inscripcion.participanteId)),
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

    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    })
    try {
        const page = await browser.newPage()
        // La plantilla es autocontenida: se bloquea toda carga de red.
        await page.setRequestInterception(true)
        page.on('request', (request) => (request.url().startsWith('data:') ? request.continue() : request.abort()))
        await page.setContent(html, { waitUntil: 'load' })
        await page.pdf({
            path: destino,
            format: 'A4',
            landscape: true,
            margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
            printBackground: true,
            preferCSSPageSize: true,
        })
    } finally {
        await browser.close()
    }
    return destino
}

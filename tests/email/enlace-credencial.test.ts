import fs from 'fs'
import os from 'os'
import path from 'path'
import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import * as configuracion from '../../src/core/configuracion-sistema'
import { enviarCorreoAprobacion, enviarCorreoEnlaceCredencial, filaCredencial3d } from '../../src/api/inscription/utils/sendEmail'
import type { InscripcionDetalle } from '../../src/api/inscription/services/mappers'

/**
 * Correos con el enlace de la credencial 3D (specs 038 y 039): el botón del correo de aprobación (que sigue
 * adjuntando el PDF) y el correo del envío masivo. Brevo se simula con `fetch`: nunca sale un correo real.
 */
jest.mock('../../src/database/prisma', () => {
    const credencialCorreo = { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() }
    return { prisma: { credencialCorreo } }
})

const m = (prisma as unknown as { credencialCorreo: Record<string, jest.Mock> }).credencialCorreo
const fetchMock = jest.fn()
const fetchOriginal = global.fetch

const respuesta = (status: number, cuerpo: unknown) =>
    Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } }))

const credencial = () => ({
    id: 1, proveedor: 'BREVO', nombre: 'Brevo', apiKeyCifrada: cifrar('xkeysib-prueba'), apiKeySufijo: 'ueba', remitenteCorreo: 'no-reply@undc.edu.pe',
    remitenteNombre: 'Inscripción al congreso', esPredeterminada: true, activo: true, ultimoEstado: null, ultimoError: null,
    ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(),
})

const CODIGO = 'K7Q2M9X4TB'
const inscripcion = {
    id: 44,
    codigoCredencial: CODIGO,
    participante: { nombres: 'JHOSEP JAVIER', correo: 'jhosep@example.com' },
    tipoInscripcion: { nombre: 'CON KIT', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL' },
    evento: {
        codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso Internacional', nombreCorto: 'VIII CIISIC 2026', correoContacto: 'congreso@undc.edu.pe',
        fechaInicio: new Date('2026-10-26T00:00:00Z'), remitenteNombre: null, asuntoAprobacion: null, credencialCorreoId: null,
    },
} as unknown as InscripcionDetalle

const conLanding = (urlLanding: string | null) => jest.spyOn(configuracion, 'obtenerConfiguracion').mockResolvedValue({
    undcApiUrl: null, undcApiKeyCifrada: null, undcApiTimeoutMs: 8000, googleClientId: null, urlPanel: null, urlLanding, rutasLegacyActivas: true,
})

const cuerpoEnviado = () => JSON.parse(fetchMock.mock.calls[0][1].body) as { subject: string, htmlContent: string, to: unknown[], attachment?: unknown[] }

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    m.findFirst.mockResolvedValue(credencial())
    m.update.mockResolvedValue({})
    fetchMock.mockReturnValue(respuesta(201, { messageId: '<id@brevo>' }))
})
afterEach(() => { jest.restoreAllMocks() })

describe('botón de la credencial 3D en el correo de aprobación (spec 038)', () => {
    const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ciisic-enlace-')), 'credencial.pdf')
    fs.writeFileSync(pdf, '%PDF-1.4 prueba')

    it('con la landing configurada agrega el enlace con el código y conserva el PDF adjunto', async () => {
        conLanding('https://ciisic-viii.episundc.pe/')
        expect(await enviarCorreoAprobacion(inscripcion, pdf)).toBe(true)
        const { htmlContent, attachment } = cuerpoEnviado()
        expect(htmlContent).toContain(`href="https://ciisic-viii.episundc.pe/credencial/${CODIGO}"`)
        expect(htmlContent).toContain('Ver mi credencial 3D')
        expect(htmlContent).not.toContain('{{')
        // El PDF personal sigue adjunto y el distintivo «Credencial adjunta» se conserva
        expect(attachment).toEqual([{ name: 'credencial-ciisic-viii-2026-44.pdf', content: Buffer.from('%PDF-1.4 prueba').toString('base64') }])
        expect(htmlContent).toContain('Credencial adjunta')
    })

    it.each([
        ['sin la URL de la landing', null, CODIGO],
        ['sin código de credencial', 'https://ciisic-viii.episundc.pe', null],
    ])('%s sale como hoy: sin botón y sin variables sin reemplazar', async (_caso, url, codigo) => {
        conLanding(url)
        expect(await enviarCorreoAprobacion({ ...inscripcion, codigoCredencial: codigo } as unknown as InscripcionDetalle, pdf)).toBe(true)
        const { htmlContent } = cuerpoEnviado()
        expect(htmlContent).not.toContain('Ver mi credencial 3D')
        expect(htmlContent).not.toContain('{{')
        expect(htmlContent).toContain('Credencial adjunta')
    })

    it('la fila se compone aquí: sin enlace no hay fila y el enlace va escapado', () => {
        expect(filaCredencial3d(null)).toBe('')
        const fila = filaCredencial3d('https://x.test/credencial/ABC"><script>')
        expect(fila).not.toContain('"><script>')
        expect(fila).toContain('&quot;&gt;&lt;script&gt;')
    })
})

describe('correo del enlace de la credencial (spec 039)', () => {
    const enlace = `https://ciisic-viii.episundc.pe/credencial/${CODIGO}`

    it('manda a la persona su propio enlace, con su primer nombre y sin adjuntos', async () => {
        expect(await enviarCorreoEnlaceCredencial(inscripcion, enlace)).toBe(true)
        const [url] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.brevo.com/v3/smtp/email')
        const cuerpo = cuerpoEnviado()
        expect(cuerpo.to).toEqual([{ email: 'jhosep@example.com' }])
        expect(cuerpo.subject).toBe('Tu credencial digital del VIII CIISIC 2026')
        expect(cuerpo.attachment).toBeUndefined()
        expect(cuerpo.htmlContent).toContain('Hola Jhosep,')
        expect(cuerpo.htmlContent).toContain(`href="${enlace}"`)
        expect(cuerpo.htmlContent).toContain(CODIGO)
        expect(cuerpo.htmlContent).toContain('congreso@undc.edu.pe')
        expect(cuerpo.htmlContent).not.toContain('{{')
    })

    it('escapa los datos de la persona y del evento', async () => {
        const maliciosa = { ...inscripcion, participante: { nombres: '<img src=x onerror=1>', correo: 'a@example.com' } } as unknown as InscripcionDetalle
        await enviarCorreoEnlaceCredencial(maliciosa, enlace)
        expect(cuerpoEnviado().htmlContent).not.toContain('<img src=x')
    })

    it('devuelve false sin lanzar si no hay credencial de correo o Brevo falla', async () => {
        m.findFirst.mockResolvedValueOnce(null)
        expect(await enviarCorreoEnlaceCredencial(inscripcion, enlace)).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()

        fetchMock.mockReturnValueOnce(respuesta(402, { message: 'not enough credits' }))
        expect(await enviarCorreoEnlaceCredencial(inscripcion, enlace)).toBe(false)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
    })
})

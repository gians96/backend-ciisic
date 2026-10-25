import fs from 'fs'
import os from 'os'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { descifrar } from '../../src/core/crypto'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { credencialParaEvento } from '../../src/api/email-credential/services/email-credential'
import { enviarCorreoAprobacion } from '../../src/api/inscription/utils/sendEmail'
import { generarInformePdf } from '../../src/api/inscription/utils/generatePdf'
import type { InscripcionDetalle } from '../../src/api/inscription/services/mappers'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const credencialCorreo = {
        count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
        update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
    }
    const configuracionSistema = { findUnique: jest.fn() }
    return { prisma: { credencialCorreo, configuracionSistema, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ credencialCorreo })) } }
})
jest.mock('../../src/api/inscription/utils/generatePdf', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/generatePdf'),
    generarInformePdf: jest.fn(),
}))

const m = (prisma as unknown as {
    credencialCorreo: Record<string, jest.Mock>
    configuracionSistema: { findUnique: jest.Mock }
}).credencialCorreo
const mConfig = (prisma as unknown as { configuracionSistema: { findUnique: jest.Mock } }).configuracionSistema
const informe = generarInformePdf as jest.Mock
const superAdmin = () => `Bearer ${tokenDeRol('SUPERADMIN')}`
const fetchMock = jest.fn()
const fetchOriginal = global.fetch

function respuesta(status: number, cuerpo: unknown) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } }))
}

function credencial(cambios: Record<string, unknown> = {}) {
    return {
        id: 1, proveedor: 'BREVO', nombre: 'Brevo', apiKeyCifrada: '', apiKeySufijo: 'abcd', remitenteCorreo: 'no-reply@undc.edu.pe',
        remitenteNombre: 'Inscripción al congreso', esPredeterminada: true, activo: true, ultimoEstado: null, ultimoError: null,
        ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(), eventos: [], ...cambios,
    }
}

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    m.update.mockResolvedValue({})
    reiniciarCacheConfiguracion()
    mConfig.findUnique.mockResolvedValue(null)
    informe.mockResolvedValue('/tmp/informe-ciisic.pdf')
})

describe('acceso a las credenciales de correo (spec 013)', () => {
    const rutas: ['get' | 'post' | 'put' | 'delete', string][] = [
        ['get', '/api/v1/email-credentials'],
        ['post', '/api/v1/email-credentials'],
        ['put', '/api/v1/email-credentials/1'],
        ['delete', '/api/v1/email-credentials/1'],
        ['post', '/api/v1/email-credentials/1/test'],
        ['post', '/api/v1/email-credentials/1/send-test'],
    ]
    const tesorero = () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })
    const comision = () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] })

    it('el Administrador del sistema también las gestiona', async () => {
        m.findMany.mockResolvedValue([credencial()])
        const r = await request(app).get('/api/v1/email-credentials').set('Authorization', `Bearer ${tokenDeRol('ADMIN')}`)
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ id: 1, apiKeyEnmascarada: '••••abcd' })
    })

    it.each(rutas)('%s %s responde 403 al Tesorero y a la Comisión sin tocar la BD', async (metodo, ruta) => {
        for (const token of [tesorero(), comision()]) {
            const r = await request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).send({})
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        for (const mock of Object.values(m)) expect(mock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('una cuenta desactivada pierde el acceso al instante', async () => {
        const r = await request(app).get('/api/v1/email-credentials').set('Authorization', `Bearer ${tokenDeRol('ADMIN', 12, { activo: false })}`)
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('SESSION_INVALIDATED')
    })
})

describe('CRUD de credenciales de correo', () => {
    it('cifra la API key, la enmascara y marca como predeterminada la primera', async () => {
        m.count.mockResolvedValue(0)
        m.create.mockImplementation(({ data }) => Promise.resolve(credencial({ ...data, id: 3 })))
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ nombre: 'Brevo congreso', apiKey: 'xkeysib-secreta-1234', remitenteCorreo: 'Congreso@UNDC.edu.pe' })
        expect(r.status).toBe(201)
        const data = m.create.mock.calls[0][0].data
        expect(data.apiKeyCifrada).not.toContain('xkeysib')
        expect(descifrar(data.apiKeyCifrada)).toBe('xkeysib-secreta-1234')
        expect(data).toMatchObject({ apiKeySufijo: '1234', remitenteCorreo: 'congreso@undc.edu.pe', esPredeterminada: true })
        expect(m.updateMany).toHaveBeenCalledWith({ data: { esPredeterminada: false } })
        expect(r.body.data).toMatchObject({ apiKeyEnmascarada: '••••1234', esPredeterminada: true })
        expect(JSON.stringify(r.body)).not.toContain('xkeysib')
    })

    it('no permite quitar la marca de predeterminada (hay que marcar otra)', async () => {
        m.findUnique.mockResolvedValue(credencial())
        const r = await request(app).put('/api/v1/email-credentials/1').set('Authorization', superAdmin()).send({ esPredeterminada: false })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DEFAULT_CREDENTIAL_REQUIRED')
    })

    it('al eliminar la predeterminada promueve otra', async () => {
        m.findUnique.mockResolvedValue(credencial())
        m.findFirst.mockResolvedValue(credencial({ id: 2, esPredeterminada: false }))
        const r = await request(app).delete('/api/v1/email-credentials/1').set('Authorization', superAdmin())
        expect(r.status).toBe(200)
        expect(m.delete).toHaveBeenCalledWith({ where: { id: 1 } })
        expect(m.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { esPredeterminada: true } })
    })

    it('prueba la cuenta de Brevo sin enviar correos y registra el estado', async () => {
        const { cifrar } = await import('../../src/core/crypto')
        m.findUnique.mockResolvedValue(credencial({ apiKeyCifrada: cifrar('xkeysib-ok') }))
        fetchMock.mockReturnValueOnce(respuesta(200, { email: 'cuenta@undc.edu.pe', companyName: 'UNDC', plan: [{ type: 'free', credits: 297, creditsType: 'sendLimit' }] }))
        const r = await request(app).post('/api/v1/email-credentials/1/test').set('Authorization', superAdmin())
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ ok: true, cuenta: { correo: 'cuenta@undc.edu.pe', planes: [{ tipo: 'free', creditos: 297 }] } })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.brevo.com/v3/account')
        expect(init.headers['api-key']).toBe('xkeysib-ok')
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'OK' }) }))
    })

    it('traduce una API key inválida en un error legible', async () => {
        const { cifrar } = await import('../../src/core/crypto')
        m.findUnique.mockResolvedValue(credencial({ apiKeyCifrada: cifrar('xkeysib-mala') }))
        fetchMock.mockReturnValueOnce(respuesta(401, { code: 'unauthorized', message: 'Key not found' }))
        const r = await request(app).post('/api/v1/email-credentials/1/test').set('Authorization', superAdmin())
        expect(r.body.data).toMatchObject({ ok: false, error: expect.stringContaining('API key de Brevo inválida') })
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
    })
})

describe('elección de la credencial al enviar', () => {
    it('usa la del evento si está activa; si no, la predeterminada', async () => {
        m.findFirst.mockResolvedValueOnce(credencial({ id: 9, esPredeterminada: false }))
        expect(await credencialParaEvento(9)).toMatchObject({ id: 9 })
        expect(m.findFirst.mock.calls[0][0]).toEqual({ where: { id: 9, activo: true } })

        m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(credencial({ id: 1 }))
        expect(await credencialParaEvento(9)).toMatchObject({ id: 1 })
        expect(m.findFirst.mock.calls[2][0]).toEqual({ where: { activo: true }, orderBy: [{ esPredeterminada: 'desc' }, { id: 'asc' }] })
    })
})

describe('correo de aprobación (spec 020)', () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'ciisic-correo-'))
    const rutaInforme = path.join(carpeta, 'informe.pdf')
    fs.writeFileSync(rutaInforme, '%PDF-1.4 informe del evento')
    const inscripcion = {
        id: 44,
        codigoCredencial: 'K7Q2M9X4TB',
        participante: { nombres: 'Ana', correo: 'ana@example.com' },
        evento: {
            codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', correoContacto: 'congreso@undc.edu.pe',
            fechaInicio: new Date('2026-10-26T00:00:00Z'), remitenteNombre: null, asuntoAprobacion: '✅ Tu inscripción ha sido aprobada', credencialCorreoId: null,
        },
    } as unknown as InscripcionDetalle
    const conBrevo = async () => {
        const { cifrar } = await import('../../src/core/crypto')
        m.findFirst.mockResolvedValue(credencial({ apiKeyCifrada: cifrar('xkeysib-envio') }))
        fetchMock.mockReturnValueOnce(respuesta(201, { messageId: '<id@brevo>' }))
    }
    const cuerpo = () => JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const html = () => cuerpo().htmlContent as string

    beforeEach(() => { informe.mockResolvedValue(rutaInforme) })

    it('adjunta el informe del evento y abre la credencial con el enlace de la landing', async () => {
        mConfig.findUnique.mockResolvedValue({ id: 1, urlPanel: null, urlLanding: 'https://congreso.undc.edu.pe/', rutasLegacyActivas: false })
        await conBrevo()
        expect(await enviarCorreoAprobacion(inscripcion)).toBe(true)
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.brevo.com/v3/smtp/email')
        expect(informe).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'ciisic-viii-2026' }))
        expect(cuerpo()).toMatchObject({
            sender: { email: 'no-reply@undc.edu.pe', name: 'Inscripción al congreso' },
            to: [{ email: 'ana@example.com' }],
            subject: '✅ Tu inscripción ha sido aprobada',
            attachment: [{ name: 'informacion-ciisic-viii-2026.pdf', content: fs.readFileSync(rutaInforme).toString('base64') }],
        })
        expect(html()).toContain('Ana')
        expect(html()).toContain('href="https://congreso.undc.edu.pe/credencial/K7Q2M9X4TB"')
        expect(html()).not.toContain('{{')
    })

    it('sin urlLanding configurada sale igual, pero sin enlace', async () => {
        await conBrevo()
        expect(await enviarCorreoAprobacion(inscripcion)).toBe(true)
        expect(html()).not.toContain('/credencial/')
        expect(html()).toContain('Ana')
    })

    it('si el informe no se genera, el correo sale sin adjunto (no bloquea el enlace)', async () => {
        mConfig.findUnique.mockResolvedValue({ id: 1, urlPanel: null, urlLanding: 'https://congreso.undc.edu.pe', rutasLegacyActivas: false })
        informe.mockRejectedValueOnce(new Error('puppeteer cayó'))
        await conBrevo()
        expect(await enviarCorreoAprobacion(inscripcion)).toBe(true)
        expect(cuerpo().attachment).toBeUndefined()
        expect(html()).toContain('/credencial/K7Q2M9X4TB')
    })

    it('no lanza y devuelve false si no hay credencial o Brevo falla', async () => {
        m.findFirst.mockResolvedValue(null)
        expect(await enviarCorreoAprobacion(inscripcion)).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()

        const { cifrar } = await import('../../src/core/crypto')
        m.findFirst.mockResolvedValue(credencial({ apiKeyCifrada: cifrar('xkeysib-envio') }))
        fetchMock.mockReturnValueOnce(respuesta(402, { message: 'not enough credits' }))
        expect(await enviarCorreoAprobacion(inscripcion)).toBe(false)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
    })
})

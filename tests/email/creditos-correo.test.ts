import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { creditosDeEnvio, enviarConBrevo } from '../../src/api/email-credential/services/brevo-client'
import { cerrarTransportesGmail, enviarConGmail } from '../../src/api/email-credential/services/gmail-client'
import { credencialUtilizable, enviarConCredencial, reiniciarEsperasDeCredenciales } from '../../src/api/email-credential/services/email-credential'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Spec 042: créditos de Brevo por credencial (no se envía con una cuenta sin créditos) y confirmación de que
 * el proveedor aceptó el correo. Nada sale a la red: Brevo con `fetch` simulado y Gmail con `nodemailer` simulado.
 */
const mockEnviar = jest.fn()
const mockVerificar = jest.fn()
const mockCrearTransporte = jest.fn(() => ({ sendMail: mockEnviar, verify: mockVerificar, close: jest.fn() }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (...args: unknown[]) => (mockCrearTransporte as (...a: unknown[]) => unknown)(...args) } }))

jest.mock('../../src/database/prisma', () => {
    const credencialCorreo = {
        count: jest.fn(), create: jest.fn(), aggregate: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
        update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
    }
    return { prisma: { credencialCorreo, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ credencialCorreo })) } }
})

const m = (prisma as unknown as { credencialCorreo: Record<string, jest.Mock> }).credencialCorreo
const superAdmin = () => `Bearer ${tokenDeRol('SUPERADMIN')}`
const fetchMock = jest.fn()
const fetchOriginal = global.fetch

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000)

function respuesta(status: number, cuerpo: unknown) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } }))
}

const cuentaConCreditos = (creditos: number) => ({ email: 'cuenta@undc.edu.pe', plan: [{ type: 'free', credits: creditos, creditsType: 'sendLimit' }] })

function brevo(id: number, cambios: Record<string, unknown> = {}) {
    return {
        id, proveedor: 'BREVO', nombre: `Brevo ${id}`, apiKeyCifrada: cifrar(`xkeysib-${id}`), apiKeySufijo: `k00${id}`, remitenteCorreo: `brevo${id}@undc.edu.pe`,
        remitenteNombre: 'CIISIC', esPredeterminada: id === 1, prioridad: id, creditos: 300, creditosEn: new Date(), activo: true, ultimoEstado: null, ultimoError: null,
        ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(), eventos: [], ...cambios,
    }
}

const gmail = (id = 9, cambios: Record<string, unknown> = {}) => brevo(id, {
    proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKeyCifrada: cifrar('abcdefghijklmnop'), remitenteCorreo: 'garias@undc.edu.pe', esPredeterminada: false, creditos: null, creditosEn: null, ...cambios,
})

const correo = {
    remitente: { email: 'brevo1@undc.edu.pe', name: 'CIISIC' },
    para: [{ email: 'ana@example.com' }],
    asunto: 'Hola',
    html: '<p>Hola</p>',
}

const llamadasA = (ruta: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(ruta))
const apiKeyDe = (llamada: unknown[]) => ((llamada[1] as { headers: Record<string, string> }).headers)['api-key']
const remitenteDe = (llamada: unknown[]) => JSON.parse((llamada[1] as { body: string }).body).sender.email

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    fetchMock.mockReset()
    cerrarTransportesGmail()
    reiniciarEsperasDeCredenciales()
    m.update.mockResolvedValue({})
    m.findMany.mockResolvedValue([])
    mockEnviar.mockResolvedValue({ messageId: '<id@gmail>', accepted: ['ana@example.com'], rejected: [] })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('créditos de envío de Brevo', () => {
    it('suma los planes de correo, ignora los de SMS y no inventa créditos', () => {
        const cuenta = (planes: { tipo: string, creditos: number | null, tipoCreditos: string | null }[]) => ({ correo: null, empresa: null, planes })
        expect(creditosDeEnvio(cuenta([{ tipo: 'free', creditos: 295, tipoCreditos: 'sendLimit' }]))).toBe(295)
        expect(creditosDeEnvio(cuenta([{ tipo: 'free', creditos: 100, tipoCreditos: 'sendLimit' }, { tipo: 'payAsYouGo', creditos: 50, tipoCreditos: 'sendLimit' }]))).toBe(150)
        expect(creditosDeEnvio(cuenta([{ tipo: 'sms', creditos: 500, tipoCreditos: 'sendLimit' }, { tipo: 'free', creditos: 0, tipoCreditos: 'sendLimit' }]))).toBe(0)
        expect(creditosDeEnvio(cuenta([{ tipo: 'sms', creditos: 500, tipoCreditos: null }]))).toBeNull()
        expect(creditosDeEnvio(cuenta([{ tipo: 'free', creditos: null, tipoCreditos: null }]))).toBeNull()
        expect(creditosDeEnvio(cuenta([]))).toBeNull()
        expect(creditosDeEnvio(cuenta([{ tipo: 'free', creditos: -3, tipoCreditos: 'sendLimit' }]))).toBe(0)
    })

    it('no intenta con una credencial sin créditos: envía con la siguiente que sí tiene', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0 }), brevo(2, { creditos: 0 }), brevo(3, { creditos: 299 })])
        fetchMock.mockImplementation(() => respuesta(201, { messageId: '<id@brevo>' }))
        expect(await enviarConCredencial(brevo(1, { creditos: 0 }) as never, correo)).toBeNull()
        const envios = llamadasA('/smtp/email')
        expect(envios).toHaveLength(1)
        expect(apiKeyDe(envios[0]!)).toBe('xkeysib-3')
        expect(remitenteDe(envios[0]!)).toBe('brevo3@undc.edu.pe')
        expect(llamadasA('/account')).toHaveLength(0) // las revisiones son recientes: no se pregunta a Brevo
    })

    it('cada envío descuenta un crédito del último dato conocido (solo si se sabe)', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 295 })])
        fetchMock.mockImplementation(() => respuesta(201, { messageId: '<id@brevo>' }))
        await enviarConCredencial(brevo(1, { creditos: 999 }) as never, correo) // la BD manda: 295, no lo que traía quien llama
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ ultimoEstado: 'OK', creditos: 294 }) }))

        m.update.mockClear()
        m.findMany.mockResolvedValue([brevo(1, { creditos: null })])
        await enviarConCredencial(brevo(1, { creditos: null }) as never, correo)
        expect(m.update.mock.calls[0]![0].data).not.toHaveProperty('creditos')
    })

    it('con la revisión vieja (más de 5 min) pregunta a Brevo antes de enviar y guarda lo que responde', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 10, creditosEn: hace(10) })])
        fetchMock.mockImplementation((url: string) => (String(url).endsWith('/account') ? respuesta(200, cuentaConCreditos(250)) : respuesta(201, { messageId: '<id@brevo>' })))
        expect(await enviarConCredencial(brevo(1) as never, correo)).toBeNull()
        expect(llamadasA('/account')).toHaveLength(1)
        expect(m.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ creditos: 250, creditosEn: expect.any(Date) }) })
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'OK', creditos: 249 }) }))
    })

    it('una cuenta sin créditos se vuelve a revisar pasados 5 min: si se renovaron, se usa', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0, creditosEn: hace(6) })])
        fetchMock.mockImplementation((url: string) => (String(url).endsWith('/account') ? respuesta(200, cuentaConCreditos(300)) : respuesta(201, { messageId: '<id@brevo>' })))
        expect(await enviarConCredencial(brevo(1) as never, correo)).toBeNull()
        expect(llamadasA('/smtp/email')).toHaveLength(1)
    })

    it('si al revisar resulta que no tiene créditos, la salta y usa la siguiente', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditosEn: null }), brevo(2)])
        fetchMock.mockImplementation((url: string, init: { headers: Record<string, string> }) => {
            if (String(url).endsWith('/account')) return respuesta(200, cuentaConCreditos(init.headers['api-key'] === 'xkeysib-1' ? 0 : 120))
            return respuesta(201, { messageId: '<id@brevo>' })
        })
        expect(await enviarConCredencial(brevo(1, { creditosEn: null }) as never, correo)).toBeNull()
        expect(llamadasA('/smtp/email').map(apiKeyDe)).toEqual(['xkeysib-2'])
        expect(m.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ creditos: 0 }) })
    })

    it('una API key inválida al revisar deja la cuenta en espera y no se envía con ella', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditosEn: null }), brevo(2)])
        fetchMock.mockImplementation((url: string, init: { headers: Record<string, string> }) => {
            if (String(url).endsWith('/account') && init.headers['api-key'] === 'xkeysib-1') return respuesta(401, { message: 'Key not found' })
            return String(url).endsWith('/account') ? respuesta(200, cuentaConCreditos(50)) : respuesta(201, { messageId: '<id@brevo>' })
        })
        expect(await enviarConCredencial(brevo(1, { creditosEn: null }) as never, correo)).toBeNull()
        expect(llamadasA('/smtp/email').map(apiKeyDe)).toEqual(['xkeysib-2'])
    })

    it('si Brevo no responde al revisar, intenta el envío igual (mejor que no enviar)', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditosEn: null })])
        fetchMock.mockImplementation((url: string) => (String(url).endsWith('/account') ? Promise.reject(new TypeError('red caída')) : respuesta(201, { messageId: '<id@brevo>' })))
        expect(await enviarConCredencial(brevo(1, { creditosEn: null }) as never, correo)).toBeNull()
        expect(llamadasA('/smtp/email')).toHaveLength(1)
    })

    it('Gmail no informa créditos: siempre es elegible, y sin otra con créditos envía por Gmail', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0 }), gmail()])
        expect(await enviarConCredencial(brevo(1, { creditos: 0 }) as never, correo)).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(mockEnviar).toHaveBeenCalledTimes(1)
    })

    it('si ninguna activa tiene créditos no gasta intentos y lo dice', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0 }), brevo(2, { creditos: 0 })])
        const error = await enviarConCredencial(brevo(1, { creditos: 0 }) as never, correo)
        expect(error).toContain('Ninguna credencial activa tiene envíos disponibles')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(m.update).not.toHaveBeenCalled()
    })

    it('el código de acceso tampoco sale por una credencial sin créditos', async () => {
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0 }), brevo(2)])
        expect((await credencialUtilizable())?.id).toBe(2)
        m.findMany.mockResolvedValue([brevo(1, { creditos: 0, creditosEn: hace(10) }), brevo(2, { creditos: 0 })])
        expect((await credencialUtilizable())?.id).toBe(1) // su revisión ya no vale: se prueba de nuevo
    })
})

describe('confirmación de que el mensaje salió', () => {
    it('Brevo: una respuesta exitosa sin identificador del mensaje no cuenta como enviado', async () => {
        fetchMock.mockImplementation(() => respuesta(201, {}))
        await expect(enviarConBrevo('xkeysib-1', correo)).rejects.toThrow('Brevo no confirmó el envío')
        fetchMock.mockImplementation(() => respuesta(201, { messageIds: ['<a@brevo>'] }))
        await expect(enviarConBrevo('xkeysib-1', correo)).resolves.toEqual({ messageId: '<a@brevo>' })
    })

    it('si la primera no confirma, el correo se prueba con la siguiente', async () => {
        m.findMany.mockResolvedValue([brevo(1), brevo(2)])
        fetchMock.mockReturnValueOnce(respuesta(201, {})).mockReturnValueOnce(respuesta(201, { messageId: '<b@brevo>' }))
        expect(await enviarConCredencial(brevo(1) as never, correo)).toBeNull()
        expect(llamadasA('/smtp/email')).toHaveLength(2)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ ultimoEstado: 'ERROR', ultimoError: expect.stringContaining('no confirmó') }) }))
    })

    it('Gmail: no cuenta como enviado si no aceptó al destinatario', async () => {
        const cuenta = { usuario: 'garias@undc.edu.pe', clave: 'abcdefghijklmnop' }
        mockEnviar.mockResolvedValue({ messageId: '<x>', accepted: [], rejected: ['ana@example.com'] })
        await expect(enviarConGmail(cuenta, correo)).rejects.toThrow('Gmail no aceptó al destinatario')
        mockEnviar.mockResolvedValue({ messageId: '<x>', accepted: ['ana@example.com'], rejected: ['otra@example.com'] })
        await expect(enviarConGmail(cuenta, correo)).rejects.toThrow('Gmail no aceptó al destinatario')
        mockEnviar.mockResolvedValue({ messageId: '<x>' })
        await expect(enviarConGmail(cuenta, correo)).rejects.toThrow('Gmail no aceptó al destinatario')
        mockEnviar.mockResolvedValue({ messageId: '<x>', accepted: ['ana@example.com'], rejected: [] })
        await expect(enviarConGmail(cuenta, correo)).resolves.toEqual({ messageId: '<x>' })
    })

    it('«Enviar prueba» devuelve el identificador con el que el proveedor confirmó el envío', async () => {
        m.findUnique.mockResolvedValue(brevo(1))
        fetchMock.mockImplementation(() => respuesta(201, { messageId: '<prueba@brevo>' }))
        const r = await request(app).post('/api/v1/email-credentials/1/send-test').set('Authorization', superAdmin()).send({ correo: 'yo@undc.edu.pe' })
        expect(r.body.data).toMatchObject({ ok: true, messageId: '<prueba@brevo>' })

        fetchMock.mockImplementation(() => respuesta(201, {}))
        const sin = await request(app).post('/api/v1/email-credentials/1/send-test').set('Authorization', superAdmin()).send({ correo: 'yo@undc.edu.pe' })
        expect(sin.body.data).toMatchObject({ ok: false, error: expect.stringContaining('no confirmó el envío') })
    })
})

describe('revisar los créditos desde el panel', () => {
    it('«Probar» guarda los créditos que informa Brevo y la lista los muestra', async () => {
        m.findUnique.mockResolvedValue(brevo(1, { creditos: 12, creditosEn: hace(60) }))
        fetchMock.mockImplementation(() => respuesta(200, cuentaConCreditos(295)))
        const r = await request(app).post('/api/v1/email-credentials/1/test').set('Authorization', superAdmin())
        expect(r.body.data.ok).toBe(true)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'OK', creditos: 295, creditosEn: expect.any(Date) }) }))

        m.findMany.mockResolvedValue([brevo(1, { creditos: 295 }), gmail()])
        const lista = await request(app).get('/api/v1/email-credentials').set('Authorization', superAdmin())
        expect(lista.body.data.map((c: { creditosDisponibles: number | null }) => c.creditosDisponibles)).toEqual([295, null])
        expect(lista.body.data[0]).toHaveProperty('creditosVerificadosEn')
    })

    it('«Probar» una cuenta de Gmail no toca los créditos', async () => {
        m.findUnique.mockResolvedValue(gmail())
        mockVerificar.mockResolvedValue(true)
        await request(app).post('/api/v1/email-credentials/9/test').set('Authorization', superAdmin())
        expect(m.update.mock.calls[0]![0].data).not.toHaveProperty('creditos')
    })

    it('POST /check revisa solo las de Brevo activas, en paralelo, y devuelve la lista al día', async () => {
        const filas = [brevo(1), brevo(2), gmail()]
        m.findMany
            .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // las activas de Brevo
            .mockResolvedValue(filas) // la lista final
        m.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(filas.find((fila) => fila.id === where.id)))
        fetchMock.mockImplementation((url: string, init: { headers: Record<string, string> }) => respuesta(200, cuentaConCreditos(init.headers['api-key'] === 'xkeysib-1' ? 295 : 0)))
        const r = await request(app).post('/api/v1/email-credentials/check').set('Authorization', superAdmin())
        expect(r.status).toBe(200)
        expect(llamadasA('/account').map(apiKeyDe).sort()).toEqual(['xkeysib-1', 'xkeysib-2'])
        expect(m.findMany.mock.calls[0]![0]).toMatchObject({ where: { activo: true, proveedor: 'BREVO' } })
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ creditos: 295 }) }))
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ creditos: 0 }) }))
        expect(r.body.data).toHaveLength(3)
    })

    it('POST /check una cuenta que falla no impide revisar las demás', async () => {
        const filas = [brevo(1), brevo(2)]
        m.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValue(filas)
        m.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(filas.find((fila) => fila.id === where.id)))
        fetchMock.mockImplementation((_url: string, init: { headers: Record<string, string> }) =>
            (init.headers['api-key'] === 'xkeysib-1' ? respuesta(401, { message: 'Key not found' }) : respuesta(200, cuentaConCreditos(7))))
        const r = await request(app).post('/api/v1/email-credentials/check').set('Authorization', superAdmin())
        expect(r.status).toBe(200)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ creditos: 7 }) }))
    })
})

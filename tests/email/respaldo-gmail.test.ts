import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { cifrar, descifrar } from '../../src/core/crypto'
import { CorreoFallido } from '../../src/api/email-credential/services/correo'
import { cerrarTransportesGmail, enviarConGmail, verificarGmail } from '../../src/api/email-credential/services/gmail-client'
import { enviarConCredencial, reiniciarEsperasDeCredenciales } from '../../src/api/email-credential/services/email-credential'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Spec 041: SMTP de Gmail como proveedor y respaldo automático entre credenciales por prioridad.
 * Nada sale a la red: Brevo con `fetch` simulado y Gmail con `nodemailer` simulado.
 */
const mockEnviar = jest.fn()
const mockVerificar = jest.fn()
const mockCerrar = jest.fn()
const mockCrearTransporte = jest.fn(() => ({ sendMail: mockEnviar, verify: mockVerificar, close: mockCerrar }))
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

const CLAVE_GMAIL = 'abcdefghijklmnop'

function respuesta(status: number, cuerpo: unknown) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } }))
}

function credencial(cambios: Record<string, unknown> = {}) {
    return {
        id: 1, proveedor: 'BREVO', nombre: 'Brevo', apiKeyCifrada: cifrar('xkeysib-uno'), apiKeySufijo: 'uno1', remitenteCorreo: 'congreso@undc.edu.pe',
        remitenteNombre: 'CIISIC', esPredeterminada: true, prioridad: 0, creditos: null, creditosEn: new Date(), activo: true, ultimoEstado: null, ultimoError: null,
        ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(), eventos: [], ...cambios,
    }
}

const brevoUno = () => credencial()
const brevoDos = () => credencial({ id: 2, nombre: 'Brevo 2', apiKeyCifrada: cifrar('xkeysib-dos'), remitenteCorreo: 'dos@undc.edu.pe', esPredeterminada: false, prioridad: 1 })
const gmail = (cambios: Record<string, unknown> = {}) => credencial({
    id: 3, proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKeyCifrada: cifrar(CLAVE_GMAIL), apiKeySufijo: 'mnop', remitenteCorreo: 'garias@undc.edu.pe',
    esPredeterminada: false, prioridad: 2, ...cambios,
})

const correo = {
    remitente: { email: 'congreso@undc.edu.pe', name: 'CIISIC' },
    para: [{ email: 'ana@example.com' }],
    asunto: 'Hola',
    html: '<p>Hola</p>',
}

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    cerrarTransportesGmail()
    reiniciarEsperasDeCredenciales()
    m.update.mockResolvedValue({})
    m.findMany.mockResolvedValue([])
    mockEnviar.mockResolvedValue({ messageId: '<id@gmail>', accepted: ['ana@example.com'], rejected: [] })
    mockVerificar.mockResolvedValue(true)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('cliente de Gmail por SMTP', () => {
    it('envía por smtp.gmail.com:465 con SSL, la contraseña de aplicación y el PDF adjunto', async () => {
        const r = await enviarConGmail({ usuario: 'garias@undc.edu.pe', clave: CLAVE_GMAIL }, {
            ...correo, remitente: { email: 'garias@undc.edu.pe', name: 'CIISIC' }, adjuntos: [{ nombre: 'credencial.pdf', contenidoBase64: Buffer.from('%PDF').toString('base64') }],
        })
        expect(r).toEqual({ messageId: '<id@gmail>' })
        expect(mockCrearTransporte).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'garias@undc.edu.pe', pass: CLAVE_GMAIL },
        }))
        expect(mockEnviar).toHaveBeenCalledWith({
            from: { name: 'CIISIC', address: 'garias@undc.edu.pe' },
            to: [{ name: '', address: 'ana@example.com' }],
            subject: 'Hola',
            html: '<p>Hola</p>',
            attachments: [{ filename: 'credencial.pdf', content: Buffer.from('%PDF').toString('base64'), encoding: 'base64' }],
        })
    })

    it('reutiliza la conexión de la misma cuenta y abre otra para otra contraseña', async () => {
        const cuenta = { usuario: 'garias@undc.edu.pe', clave: CLAVE_GMAIL }
        await enviarConGmail(cuenta, correo)
        await enviarConGmail(cuenta, correo)
        expect(mockCrearTransporte).toHaveBeenCalledTimes(1)
        await enviarConGmail({ ...cuenta, clave: 'ponmlkjihgfedcba' }, correo)
        expect(mockCrearTransporte).toHaveBeenCalledTimes(2)
    })

    it.each([
        ['contraseña rechazada', { code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }, /contraseña de aplicación/, true],
        ['límite diario', { code: 'EENVELOPE', responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' }, /límite de envíos/, true],
        ['sin conexión', { code: 'ECONNECTION' }, /No se pudo conectar con smtp\.gmail\.com/, false],
        ['sin respuesta', { code: 'ETIMEDOUT' }, /no respondió a tiempo/, false],
        ['destinatario inexistente', { code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 The email account that you tried to reach does not exist' }, /Gmail respondió 550/, false],
    ])('traduce el error: %s', async (_caso, error, mensaje, deLaCuenta) => {
        mockEnviar.mockRejectedValue(error)
        const fallo = await enviarConGmail({ usuario: 'garias@undc.edu.pe', clave: CLAVE_GMAIL }, correo).catch((e: unknown) => e)
        expect(fallo).toBeInstanceOf(CorreoFallido)
        expect((fallo as CorreoFallido).message).toMatch(mensaje)
        expect((fallo as CorreoFallido).deLaCuenta).toBe(deLaCuenta)
        expect((fallo as CorreoFallido).message).not.toContain(CLAVE_GMAIL)
    })

    it('verifica la cuenta sin enviar nada', async () => {
        expect(await verificarGmail({ usuario: 'garias@undc.edu.pe', clave: CLAVE_GMAIL })).toEqual({ correo: 'garias@undc.edu.pe', empresa: null, planes: [] })
        expect(mockVerificar).toHaveBeenCalledTimes(1)
        expect(mockEnviar).not.toHaveBeenCalled()
    })
})

describe('respaldo entre credenciales (enviarConCredencial)', () => {
    it('si Brevo se queda sin créditos, envía por Gmail con el remitente de Gmail y lo registra', async () => {
        m.findMany.mockResolvedValue([gmail()])
        fetchMock.mockReturnValueOnce(respuesta(402, { code: 'not_enough_credits', message: 'no credits' }))
        expect(await enviarConCredencial(brevoUno() as never, correo)).toBeNull()
        expect(mockEnviar).toHaveBeenCalledTimes(1)
        expect(mockEnviar.mock.calls[0][0].from).toEqual({ name: 'CIISIC', address: 'garias@undc.edu.pe' })
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ ultimoEstado: 'OK' }) }))
    })

    it('una cuenta agotada queda en espera: los envíos siguientes van directo a la siguiente', async () => {
        m.findMany.mockResolvedValue([gmail()])
        fetchMock.mockReturnValueOnce(respuesta(402, { message: 'no credits' }))
        await enviarConCredencial(brevoUno() as never, correo)
        await enviarConCredencial(brevoUno() as never, correo)
        await enviarConCredencial(brevoUno() as never, correo)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(mockEnviar).toHaveBeenCalledTimes(3)
    })

    it('un error del mensaje (no de la cuenta) también prueba la siguiente pero no deja a la primera en espera', async () => {
        m.findMany.mockResolvedValue([gmail()])
        fetchMock.mockImplementation(() => respuesta(400, { code: 'invalid_parameter', message: 'invalid to' }))
        expect(await enviarConCredencial(brevoUno() as never, correo)).toBeNull()
        expect(await enviarConCredencial(brevoUno() as never, correo)).toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('pasa de una a otra por prioridad y, si todas fallan, devuelve el error de la elegida', async () => {
        m.findMany.mockResolvedValue([brevoDos(), gmail()])
        fetchMock.mockImplementation(() => respuesta(402, { message: 'no credits' }))
        mockEnviar.mockRejectedValue({ code: 'EAUTH', responseCode: 535 })
        const error = await enviarConCredencial(brevoUno() as never, correo)
        expect(error).toContain('Brevo')
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).sender.email).toBe('dos@undc.edu.pe')
        expect(mockEnviar).toHaveBeenCalledTimes(1)
    })

    it('prueba como máximo 3 credenciales por correo', async () => {
        const otra = credencial({ id: 4, nombre: 'Otra', apiKeyCifrada: cifrar('xkeysib-cuatro'), prioridad: 3, esPredeterminada: false })
        m.findMany.mockResolvedValue([brevoDos(), gmail(), otra])
        fetchMock.mockImplementation(() => respuesta(500, { message: 'caído' }))
        mockEnviar.mockRejectedValue({ code: 'ECONNECTION' })
        await enviarConCredencial(brevoUno() as never, correo)
        expect(fetchMock.mock.calls.length + mockEnviar.mock.calls.length).toBe(3)
    })

    it('si todas están en espera, las intenta igual (mejor que no enviar)', async () => {
        m.findMany.mockResolvedValue([])
        fetchMock.mockReturnValueOnce(respuesta(402, { message: 'no credits' })).mockReturnValueOnce(respuesta(201, { messageId: 'x' }))
        expect(await enviarConCredencial(brevoUno() as never, correo)).toContain('créditos')
        expect(await enviarConCredencial(brevoUno() as never, correo)).toBeNull()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('un envío que provoca un anónimo no registra nada, pero también tiene respaldo', async () => {
        m.findMany.mockResolvedValue([gmail()])
        fetchMock.mockReturnValueOnce(respuesta(429, {}))
        expect(await enviarConCredencial(brevoUno() as never, correo, { registrar: false })).toBeNull()
        expect(m.update).not.toHaveBeenCalled()
    })

    it('sin otras credenciales, o si falla la BD al buscarlas, solo prueba la elegida', async () => {
        fetchMock.mockImplementation(() => respuesta(402, {}))
        expect(await enviarConCredencial(brevoUno() as never, correo)).toContain('créditos')
        reiniciarEsperasDeCredenciales()
        m.findMany.mockRejectedValue(new Error('BD caída'))
        expect(await enviarConCredencial(brevoUno() as never, correo)).toContain('créditos')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('una prueba exitosa de la cuenta la saca de la espera', async () => {
        const { cifrar: cifrarDeNuevo } = await import('../../src/core/crypto')
        m.findMany.mockResolvedValue([gmail()])
        fetchMock.mockReturnValueOnce(respuesta(402, {}))
        await enviarConCredencial(brevoUno() as never, correo)
        m.findUnique.mockResolvedValue(credencial({ apiKeyCifrada: cifrarDeNuevo('xkeysib-uno') }))
        fetchMock.mockReturnValueOnce(respuesta(200, { email: 'cuenta@undc.edu.pe', plan: [] }))
        await request(app).post('/api/v1/email-credentials/1/test').set('Authorization', superAdmin())
        fetchMock.mockReturnValueOnce(respuesta(201, { messageId: 'x' }))
        await enviarConCredencial(brevoUno() as never, correo)
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })
})

describe('credenciales de Gmail en el panel', () => {
    it('guarda la contraseña de aplicación sin espacios y cifrada; el remitente es la cuenta de Gmail', async () => {
        m.count.mockResolvedValue(1)
        m.aggregate.mockResolvedValue({ _max: { prioridad: 2 } })
        m.create.mockImplementation(({ data }) => Promise.resolve(credencial({ ...data, id: 7 })))
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ proveedor: 'GMAIL_SMTP', nombre: 'Gmail de respaldo', apiKey: 'ABCD efgh ijkl mnop', remitenteCorreo: 'Garias@UNDC.edu.pe' })
        expect(r.status).toBe(201)
        const data = m.create.mock.calls[0][0].data
        expect(descifrar(data.apiKeyCifrada)).toBe(CLAVE_GMAIL)
        expect(data).toMatchObject({ proveedor: 'GMAIL_SMTP', apiKeySufijo: 'mnop', remitenteCorreo: 'garias@undc.edu.pe', esPredeterminada: false, prioridad: 3 })
        expect(r.body.data).toMatchObject({ proveedor: 'GMAIL_SMTP', apiKeyEnmascarada: '••••mnop', prioridad: 3 })
        expect(JSON.stringify(r.body)).not.toContain(CLAVE_GMAIL)
    })

    it.each(['corta', 'abcdefghijklmno1', 'abcdefghijklmnopq'])('rechaza una contraseña de aplicación con otra forma (%s)', async (apiKey) => {
        m.count.mockResolvedValue(1)
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKey: apiKey.padEnd(10, 'x'), remitenteCorreo: 'garias@undc.edu.pe' })
        expect(r.status).toBe(422)
        expect(r.body.fields.apiKey).toContain('16 letras')
        expect(m.create).not.toHaveBeenCalled()
    })

    it('rechaza un proveedor desconocido', async () => {
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ proveedor: 'SENDGRID', nombre: 'Otra', apiKey: 'xkeysib-1234567', remitenteCorreo: 'a@undc.edu.pe' })
        expect(r.status).toBe(422)
        expect(r.body.fields.proveedor).toBeDefined()
    })

    it('al cambiar la cuenta de Gmail exige pegar la contraseña de esa cuenta', async () => {
        m.findUnique.mockResolvedValue(gmail())
        const sin = await request(app).put('/api/v1/email-credentials/3').set('Authorization', superAdmin()).send({ remitenteCorreo: 'otra@undc.edu.pe' })
        expect(sin.status).toBe(422)
        expect(sin.body.fields.apiKey).toContain('Cambiaste la cuenta de Gmail')
        m.update.mockResolvedValue(gmail({ remitenteCorreo: 'otra@undc.edu.pe' }))
        const con = await request(app).put('/api/v1/email-credentials/3').set('Authorization', superAdmin())
            .send({ remitenteCorreo: 'otra@undc.edu.pe', apiKey: 'zzzz yyyy xxxx wwww' })
        expect(con.status).toBe(200)
        expect(descifrar(m.update.mock.calls[0][0].data.apiKeyCifrada)).toBe('zzzzyyyyxxxxwwww')
    })

    it('«Probar» inicia sesión en Gmail sin enviar y muestra la cuenta; un fallo se traduce', async () => {
        m.findUnique.mockResolvedValue(gmail())
        const ok = await request(app).post('/api/v1/email-credentials/3/test').set('Authorization', superAdmin())
        expect(ok.body.data).toMatchObject({ ok: true, cuenta: { correo: 'garias@undc.edu.pe', planes: [] } })
        expect(mockEnviar).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()

        mockVerificar.mockRejectedValue({ code: 'EAUTH', responseCode: 535 })
        cerrarTransportesGmail()
        const mal = await request(app).post('/api/v1/email-credentials/3/test').set('Authorization', superAdmin())
        expect(mal.body.data).toMatchObject({ ok: false, error: expect.stringContaining('contraseña de aplicación') })
        expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'ERROR' }) }))
    })

    it('«Enviar prueba» usa solo esa credencial, sin respaldo', async () => {
        m.findUnique.mockResolvedValue(gmail())
        m.findMany.mockResolvedValue([brevoUno()])
        const r = await request(app).post('/api/v1/email-credentials/3/send-test').set('Authorization', superAdmin()).send({ correo: 'yo@undc.edu.pe' })
        expect(r.body.data.ok).toBe(true)
        expect(mockEnviar).toHaveBeenCalledTimes(1)
        expect(fetchMock).not.toHaveBeenCalled()

        mockEnviar.mockRejectedValue({ code: 'ECONNECTION' })
        const fallo = await request(app).post('/api/v1/email-credentials/3/send-test').set('Authorization', superAdmin()).send({ correo: 'yo@undc.edu.pe' })
        expect(fallo.body.data.ok).toBe(false)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('orden de las credenciales (PUT /v1/email-credentials/order)', () => {
    const ordenar = (ids: unknown) => request(app).put('/api/v1/email-credentials/order').set('Authorization', superAdmin()).send({ ids })
    const existentes = [{ id: 1, activo: true }, { id: 2, activo: true }, { id: 3, activo: false }]

    it('guarda la prioridad por posición y deja como predeterminada a la primera', async () => {
        m.findMany.mockResolvedValueOnce(existentes).mockResolvedValue([brevoDos(), brevoUno(), gmail()])
        const r = await ordenar([2, 1, 3])
        expect(r.status).toBe(200)
        expect(m.update.mock.calls.map(([arg]) => arg)).toEqual([
            { where: { id: 2 }, data: { prioridad: 1, esPredeterminada: true } },
            { where: { id: 1 }, data: { prioridad: 2, esPredeterminada: false } },
            { where: { id: 3 }, data: { prioridad: 3, esPredeterminada: false } },
        ])
        expect(r.body.data).toHaveLength(3)
    })

    it.each([
        ['repetidas', [1, 1, 2], 'INVALID_ORDER'],
        ['incompletas', [1, 2], 'INVALID_ORDER'],
        ['con una que no existe', [1, 2, 9], 'INVALID_ORDER'],
        ['con una inactiva primero', [3, 1, 2], 'DEFAULT_CREDENTIAL_INACTIVE'],
    ])('rechaza un orden con credenciales %s', async (_caso, ids, codigo) => {
        m.findMany.mockResolvedValue(existentes)
        const r = await ordenar(ids)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe(codigo)
        expect(m.update).not.toHaveBeenCalled()
    })

    it('exige una lista de ids', async () => {
        expect((await ordenar([])).status).toBe(422)
        expect((await ordenar('1,2')).status).toBe(422)
    })
})

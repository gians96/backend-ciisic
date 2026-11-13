import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { CorreoFallido } from '../../src/api/email-credential/services/correo'
import { esIpNoAutorizada, enviarConBrevo } from '../../src/api/email-credential/services/brevo-client'
import { cerrarTransportesGmail, enviarConGmail, esFalloDeConexion, ordenDePuertos, verificarGmail } from '../../src/api/email-credential/services/gmail-client'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Spec 046: puerto SMTP de Gmail (465 SSL o 587 STARTTLS) con respaldo al otro puerto si no conecta, y el mensaje
 * claro cuando Brevo bloquea la IP del servidor. Nada sale a la red.
 */
const mockEnviar = jest.fn()
const mockVerificar = jest.fn()
const mockCrearTransporte = jest.fn((opciones: { port: number }) => ({
    sendMail: (...args: unknown[]) => mockEnviar(opciones.port, ...args),
    verify: () => mockVerificar(opciones.port),
    close: jest.fn(),
}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (...args: unknown[]) => (mockCrearTransporte as (...a: unknown[]) => unknown)(...args) } }))

jest.mock('../../src/database/prisma', () => {
    const credencialCorreo = {
        count: jest.fn(), create: jest.fn(), aggregate: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
        update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
    }
    return { prisma: { credencialCorreo, $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ credencialCorreo })) } }
})

const m = (prisma as unknown as { credencialCorreo: Record<string, jest.Mock> }).credencialCorreo
const cuenta = { usuario: 'congreso@undc.edu.pe', clave: 'abcdefghijklmnop' }
const correo = { remitente: { email: 'congreso@undc.edu.pe', name: 'CIISIC' }, para: [{ email: 'ana@example.com' }], asunto: 'Hola', html: '<p>Hola</p>' }
const errorDeConexion = (code = 'ETIMEDOUT') => Object.assign(new Error('conexión'), { code, command: 'CONN' })

beforeEach(() => {
    jest.clearAllMocks()
    cerrarTransportesGmail()
})

describe('puertos de Gmail', () => {
    it('prueba primero el elegido y luego el otro', () => {
        expect(ordenDePuertos(587)).toEqual([587, 465])
        expect(ordenDePuertos(465)).toEqual([465, 587])
        expect(ordenDePuertos(null)).toEqual([465, 587])
        expect(ordenDePuertos(25)).toEqual([465, 587])
    })

    it('587 usa STARTTLS obligatorio y 465 SSL; el host es siempre smtp.gmail.com', async () => {
        mockVerificar.mockResolvedValue(true)
        await verificarGmail({ ...cuenta, puerto: 587 })
        await verificarGmail({ ...cuenta, puerto: 465 })
        expect(mockCrearTransporte).toHaveBeenNthCalledWith(1, expect.objectContaining({ host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true }))
        expect(mockCrearTransporte).toHaveBeenNthCalledWith(2, expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, requireTLS: false }))
    })

    it('si el puerto elegido no conecta, envía por el otro', async () => {
        mockEnviar.mockImplementation(async (puerto: number) => {
            if (puerto === 465) throw errorDeConexion()
            return { messageId: '<id>', accepted: ['ana@example.com'], rejected: [] }
        })
        await expect(enviarConGmail(cuenta, correo)).resolves.toEqual({ messageId: '<id>' })
        expect(mockEnviar.mock.calls.map(([puerto]) => puerto)).toEqual([465, 587])
    })

    it('un error de contraseña no cambia de puerto', async () => {
        mockEnviar.mockRejectedValue(Object.assign(new Error('auth'), { code: 'EAUTH', responseCode: 535 }))
        await expect(enviarConGmail(cuenta, correo)).rejects.toThrow(/contraseña de aplicación/)
        expect(mockEnviar).toHaveBeenCalledTimes(1)
    })

    it('un corte a mitad del envío no se reintenta por el otro puerto (podría duplicar el correo)', async () => {
        mockEnviar.mockRejectedValue(Object.assign(new Error('socket'), { code: 'ESOCKET', command: 'DATA' }))
        await expect(enviarConGmail(cuenta, correo)).rejects.toBeInstanceOf(CorreoFallido)
        expect(mockEnviar).toHaveBeenCalledTimes(1)
    })

    it('si ningún puerto conecta, lo dice', async () => {
        mockVerificar.mockRejectedValue(errorDeConexion('ECONNREFUSED'))
        await expect(verificarGmail(cuenta)).rejects.toThrow(/puerto 465 ni por el 587/)
        expect(mockVerificar).toHaveBeenCalledTimes(2)
    })

    it('reconoce los fallos de conexión', () => {
        expect(esFalloDeConexion(errorDeConexion())).toBe(true)
        expect(esFalloDeConexion({ code: 'ECONNREFUSED' })).toBe(true)
        expect(esFalloDeConexion({ code: 'ESOCKET', command: 'DATA' })).toBe(false)
        expect(esFalloDeConexion({ code: 'EAUTH', command: 'AUTH PLAIN' })).toBe(false)
    })
})

describe('API de credenciales', () => {
    const superAdmin = () => `Bearer ${tokenDeRol('SUPERADMIN')}`
    const gmail = (cambios: Record<string, unknown> = {}) => ({
        id: 3, proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKeyCifrada: cifrar(cuenta.clave), apiKeySufijo: 'mnop', remitenteCorreo: cuenta.usuario, remitenteNombre: null,
        smtpPuerto: null, esPredeterminada: true, prioridad: 0, creditos: null, creditosEn: null, activo: true, ultimoEstado: null, ultimoError: null,
        ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(), eventos: [], ...cambios,
    })

    it('guarda el puerto 587 al crear una de Gmail y lo devuelve', async () => {
        m.count.mockResolvedValue(0)
        m.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => gmail({ smtpPuerto: data.smtpPuerto }))
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKey: 'abcd efgh ijkl mnop', remitenteCorreo: cuenta.usuario, smtpPuerto: 587 })
        expect(r.status).toBe(201)
        expect(m.create.mock.calls[0][0].data.smtpPuerto).toBe(587)
        expect(r.body.data.smtpPuerto).toBe(587)
    })

    it('rechaza un puerto que no es 465 ni 587', async () => {
        const r = await request(app).post('/api/v1/email-credentials').set('Authorization', superAdmin())
            .send({ proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKey: 'abcdefghijklmnop', remitenteCorreo: cuenta.usuario, smtpPuerto: 25 })
        expect(r.status).toBe(422)
    })

    it('al probar, si conectó por el otro puerto lo guarda', async () => {
        m.findUnique.mockResolvedValue(gmail())
        m.update.mockResolvedValue({})
        mockVerificar.mockImplementation(async (puerto: number) => {
            if (puerto === 465) throw errorDeConexion()
            return true
        })
        const r = await request(app).post('/api/v1/email-credentials/3/test').set('Authorization', superAdmin())
        expect(r.status).toBe(200)
        expect(r.body.data.cuenta.puerto).toBe(587)
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: expect.objectContaining({ ultimoEstado: 'OK', smtpPuerto: 587 }) }))
    })
})

describe('Brevo con la IP bloqueada', () => {
    const fetchOriginal = global.fetch
    afterEach(() => { global.fetch = fetchOriginal })

    it('explica que hay que autorizar la IP', async () => {
        const cuerpo = { code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 1.2.3.4. If you performed this action make sure to add the new IP address' }
        expect(esIpNoAutorizada(cuerpo)).toBe(true)
        expect(esIpNoAutorizada({ code: 'unauthorized', message: 'Key not found' })).toBe(false)
        global.fetch = jest.fn(async () => new Response(JSON.stringify(cuerpo), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch
        await expect(enviarConBrevo('xkeysib-x', correo)).rejects.toThrow(/IPs autorizadas/)
    })
})

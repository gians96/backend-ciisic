import { prisma } from '../../src/database/prisma'
import { descifrar } from '../../src/core/crypto'
import { importarSecretosLegados } from '../../src/database/importarSecretosLegados'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tokenConsulta: { count: jest.fn(), create: jest.fn() },
        credencialCorreo: { count: jest.fn(), create: jest.fn() },
    },
}))

const m = prisma as unknown as { tokenConsulta: Record<string, jest.Mock>, credencialCorreo: Record<string, jest.Mock> }
const VARIABLES = ['DECOLECTA_TOKEN', 'BREVO_API_KEY', 'BREVO_SENDER', 'BREVO_SENDER_NAME', 'NUBETEC_TOKEN', 'API_URL']
const anteriores = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))

beforeEach(() => {
    jest.clearAllMocks()
    for (const v of VARIABLES) delete process.env[v]
})
afterAll(() => {
    for (const [v, valor] of Object.entries(anteriores)) {
        if (valor === undefined) delete process.env[v]
        else process.env[v] = valor
    }
})

describe('importación de credenciales del entorno anterior', () => {
    it('importa Decolecta y Brevo cifrados cuando las tablas están vacías', async () => {
        process.env.DECOLECTA_TOKEN = 'sk_1234.decolecta-token'
        process.env.BREVO_API_KEY = 'xkeysib-clave-5678'
        process.env.BREVO_SENDER = 'Remitente@Gmail.com'
        process.env.BREVO_SENDER_NAME = 'Inscripción al congreso'
        m.tokenConsulta.count.mockResolvedValue(0)
        m.credencialCorreo.count.mockResolvedValue(0)

        const avisos = await importarSecretosLegados()

        const token = m.tokenConsulta.create.mock.calls[0][0].data
        expect(token).toMatchObject({ proveedor: 'DECOLECTA', tokenSufijo: 'oken', limiteConsultas: null, periodoRenovacion: 'MENSUAL', prioridad: 1 })
        expect(descifrar(token.tokenCifrado)).toBe('sk_1234.decolecta-token')
        expect(token.fechaRenovacion.getTime()).toBeGreaterThan(Date.now())

        const correo = m.credencialCorreo.create.mock.calls[0][0].data
        expect(correo).toMatchObject({ remitenteCorreo: 'remitente@gmail.com', remitenteNombre: 'Inscripción al congreso', esPredeterminada: true, apiKeySufijo: '5678' })
        expect(descifrar(correo.apiKeyCifrada)).toBe('xkeysib-clave-5678')
        expect(avisos.join(' ')).toContain('se importó')
    })

    it('no sobrescribe lo gestionado desde el panel y avisa qué variables sobran', async () => {
        process.env.DECOLECTA_TOKEN = 'sk_1234.decolecta-token'
        process.env.BREVO_API_KEY = 'xkeysib-clave-5678'
        process.env.BREVO_SENDER = 'remitente@gmail.com'
        process.env.NUBETEC_TOKEN = 'viejo'
        process.env.API_URL = 'https://api-ciisic-vii.episundc.pe'
        m.tokenConsulta.count.mockResolvedValue(2)
        m.credencialCorreo.count.mockResolvedValue(1)

        const avisos = await importarSecretosLegados()

        expect(m.tokenConsulta.create).not.toHaveBeenCalled()
        expect(m.credencialCorreo.create).not.toHaveBeenCalled()
        expect(avisos).toEqual(expect.arrayContaining([
            expect.stringContaining('DECOLECTA_TOKEN ya no se usa'),
            expect.stringContaining('BREVO_API_KEY/BREVO_SENDER/BREVO_SENDER_NAME ya no se usan'),
            'NUBETEC_TOKEN ya no se usa: quítala del entorno.',
            'API_URL ya no se usa: quítala del entorno.',
        ]))
    })

    it('sin variables anteriores no hace nada', async () => {
        expect(await importarSecretosLegados()).toEqual([])
        expect(m.tokenConsulta.count).not.toHaveBeenCalled()
    })
})

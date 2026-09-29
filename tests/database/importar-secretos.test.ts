import { prisma } from '../../src/database/prisma'
import { descifrar } from '../../src/core/crypto'
import { importarSecretosLegados } from '../../src/database/importarSecretosLegados'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        tokenConsulta: { count: jest.fn(), create: jest.fn() },
        credencialCorreo: { count: jest.fn(), create: jest.fn() },
        configuracionSistema: { upsert: jest.fn(), update: jest.fn() },
    },
}))

const m = prisma as unknown as {
    tokenConsulta: Record<string, jest.Mock>
    credencialCorreo: Record<string, jest.Mock>
    configuracionSistema: Record<string, jest.Mock>
}
// El .env local puede traer variables antiguas: se aíslan todas las que el importador revisa
const VARIABLES = [
    'DECOLECTA_TOKEN', 'BREVO_API_KEY', 'BREVO_SENDER', 'BREVO_SENDER_NAME', 'NUBETEC_TOKEN', 'API_URL', 'API_RENIEC_DNI', 'RENIEC_PROVIDER',
    'RENIEC_TOKEN', 'BREVO_SENDER_SUBJECT', 'CORS_ORIGINS', 'DNI_CACHE_TTL_DAYS', 'DNI_LOOKUP_TIMEOUT_MS', 'INTEGRATIONS_ALLOWED_HOSTS',
    'INTEGRATIONS_TIMEOUT_MS', 'VERIFICACION_SECRET', 'VERIFICACION_TTL_HORAS', 'BREVO_API_URL', 'EMAIL_TIMEOUT_MS', 'UPLOADS_DIR',
    'MAX_UPLOAD_BYTES', 'MIGRATE_ON_START', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'BOOTSTRAP_ADMIN_NAMES',
    'BOOTSTRAP_ADMIN_SURNAMES', 'UNDC_API_URL', 'UNDC_API_KEY', 'UNDC_API_TIMEOUT_MS', 'GOOGLE_CLIENT_ID', 'LEGACY_ROUTES_ENABLED',
]
const filaConfiguracion = (cambios: Record<string, unknown> = {}) => ({
    id: 1, undcApiUrl: null, undcApiKeyCifrada: null, undcApiKeySufijo: null, undcApiTimeoutMs: 8000, googleClientId: null,
    urlPanel: null, rutasLegacyActivas: true, actualizadoPorId: null, ...cambios,
})
const anteriores = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    for (const v of VARIABLES) delete process.env[v]
    m.configuracionSistema.upsert.mockResolvedValue(filaConfiguracion())
    m.configuracionSistema.update.mockImplementation(({ data }) => Promise.resolve(filaConfiguracion(data)))
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
        process.env.BREVO_SENDER_NAME = '"Inscripción al congreso"'
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

    it('importa API_UNDC, Google y el interruptor legacy a la configuración del sistema', async () => {
        process.env.UNDC_API_URL = 'https://api-jp.episundc.pe/'
        process.env.UNDC_API_KEY = 'undc_clave_de_prueba_123'
        process.env.UNDC_API_TIMEOUT_MS = '9000'
        process.env.GOOGLE_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com'
        process.env.LEGACY_ROUTES_ENABLED = 'false'

        const avisos = await importarSecretosLegados()

        const data = m.configuracionSistema.update.mock.calls[0][0].data
        expect(data).toMatchObject({
            undcApiUrl: 'https://api-jp.episundc.pe', undcApiKeySufijo: '_123', undcApiTimeoutMs: 9000,
            googleClientId: '1234567890-abcdefg.apps.googleusercontent.com', rutasLegacyActivas: false,
        })
        expect(descifrar(data.undcApiKeyCifrada)).toBe('undc_clave_de_prueba_123')
        expect(avisos.join(' ')).toContain('Se importó a la configuración del sistema')
    })

    it('no pisa la configuración editada en el panel', async () => {
        process.env.UNDC_API_URL = 'https://otra.example'
        process.env.UNDC_API_KEY = 'undc_clave_de_prueba_123'
        m.configuracionSistema.upsert.mockResolvedValue(filaConfiguracion({ actualizadoPorId: 3 }))

        const avisos = await importarSecretosLegados()

        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
        expect(avisos.join(' ')).toContain('ya no se usan')
    })
})

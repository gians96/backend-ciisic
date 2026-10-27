import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { conRecuento } from '../../src/api/email-credential/services/recuento-envios'
import {
    credencialUtilizable, enviarConCredencial, prepararEnvioMasivo, reiniciarEsperasDeCredenciales,
} from '../../src/api/email-credential/services/email-credential'

/**
 * Spec 044: un envío masivo pasa solo de una credencial a la siguiente al llegar al límite. La BD y Brevo están
 * simulados **con estado** (los créditos bajan de verdad), así que se prueba el recorrido completo de los 320 correos.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: { credencialCorreo: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() } },
}))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: jest.fn(), verify: jest.fn(), close: jest.fn() }) } }))

const m = (prisma as unknown as { credencialCorreo: Record<string, jest.Mock> }).credencialCorreo
const fetchMock = jest.fn()
const fetchOriginal = global.fetch

interface Fila {
    id: number, proveedor: 'BREVO' | 'GMAIL_SMTP', nombre: string, apiKeyCifrada: string, apiKeySufijo: string, remitenteCorreo: string, remitenteNombre: string | null,
    esPredeterminada: boolean, prioridad: number, creditos: number | null, creditosEn: Date | null, activo: boolean, ultimoEstado: 'OK' | 'ERROR' | null,
    ultimoError: string | null, ultimaPruebaEn: Date | null, ultimoEnvioEn: Date | null, creadoEn: Date, actualizadoEn: Date
}

let filas: Fila[] = []
/** Envíos que Brevo dice tener de verdad por cada API key (puede diferir de lo que cree la BD). */
let brevoReal: Record<string, number> = {}
/** Respuesta de Brevo al enviar, por API key, para forzar un fallo concreto. */
let reglas: Record<string, () => Promise<Response>> = {}
let numeroMensaje = 0

function respuesta(status: number, cuerpo: unknown) {
    return Promise.resolve(new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } }))
}

function brevo(id: number, cambios: Partial<Fila> = {}): Fila {
    return {
        id, proveedor: 'BREVO', nombre: `Brevo ${id}`, apiKeyCifrada: cifrar(`xkeysib-${id}`), apiKeySufijo: `k00${id}`, remitenteCorreo: `brevo${id}@undc.edu.pe`,
        remitenteNombre: 'CIISIC', esPredeterminada: id === 1, prioridad: id, creditos: 300, creditosEn: new Date(), activo: true, ultimoEstado: null, ultimoError: null,
        ultimaPruebaEn: null, ultimoEnvioEn: null, creadoEn: new Date(), actualizadoEn: new Date(), ...cambios,
    }
}

const gmail = (id: number): Fila => brevo(id, {
    proveedor: 'GMAIL_SMTP', nombre: 'Gmail', apiKeyCifrada: cifrar('abcdefghijklmnop'), remitenteCorreo: 'garias@undc.edu.pe', esPredeterminada: false, creditos: null, creditosEn: null,
})

const ordenar = (lista: Fila[]) => [...lista].sort((a, b) => Number(b.esPredeterminada) - Number(a.esPredeterminada) || a.prioridad - b.prioridad || a.id - b.id)

function instalarBaseSimulada() {
    m.findMany.mockImplementation(async ({ where }: { where?: { activo?: boolean, proveedor?: string } } = {}) =>
        ordenar(filas.filter((f) => (where?.activo === undefined || f.activo === where.activo) && (where?.proveedor === undefined || f.proveedor === where.proveedor))).map((f) => ({ ...f })))
    m.findFirst.mockImplementation(async ({ where }: { where?: { id?: number } } = {}) => {
        const primera = ordenar(filas.filter((f) => f.activo && (where?.id === undefined || f.id === where.id)))[0]
        return primera ? { ...primera } : null
    })
    m.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => {
        const fila = filas.find((f) => f.id === where.id)
        return fila ? { ...fila, eventos: [] } : null
    })
    m.update.mockImplementation(async ({ where, data }: { where: { id: number }, data: Partial<Fila> }) => {
        const fila = filas.find((f) => f.id === where.id)!
        Object.assign(fila, data)
        return { ...fila }
    })
}

function instalarBrevoSimulado() {
    fetchMock.mockImplementation((url: string, init: { headers: Record<string, string> }) => {
        const clave = init.headers['api-key']!
        if (String(url).endsWith('/account')) {
            return respuesta(200, { email: 'cuenta@undc.edu.pe', plan: [{ type: 'free', credits: brevoReal[clave] ?? 0, creditsType: 'sendLimit' }] })
        }
        const regla = reglas[clave]
        if (regla) return regla()
        if ((brevoReal[clave] ?? 0) > 0) {
            brevoReal[clave]! -= 1
            numeroMensaje += 1
            return respuesta(201, { messageId: `<m${numeroMensaje}@brevo>` })
        }
        return respuesta(402, { code: 'not_enough_credits', message: 'Not enough credits' })
    })
}

const correo = { remitente: { email: 'brevo1@undc.edu.pe', name: 'CIISIC' }, para: [{ email: 'ana@example.com' }], asunto: 'Hola', html: '<p>Hola</p>' }
const llamadasA = (ruta: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(ruta))
const apiKeyDe = (llamada: unknown[]) => ((llamada[1] as { headers: Record<string, string> }).headers)['api-key']
const remitenteDe = (llamada: unknown[]) => JSON.parse((llamada[1] as { body: string }).body).sender.email as string

/** Envía `n` correos uno tras otro con la credencial `filas[0]` como elegida (como hace `recorrer`, que la lee de nuevo en cada envío). */
async function enviarN(n: number) {
    const resultados: (string | null)[] = []
    for (let i = 0; i < n; i += 1) resultados.push(await enviarConCredencial({ ...filas[0]! } as never, correo))
    return resultados
}

const estados = () => filas.map((fila) => fila.ultimoEstado)

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    fetchMock.mockReset()
    reiniciarEsperasDeCredenciales()
    filas = []
    brevoReal = {}
    reglas = {}
    numeroMensaje = 0
    instalarBaseSimulada()
    instalarBrevoSimulado()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('320 correos con ANGEL en 295', () => {
    it('los primeros 295 salen por ANGEL y los 25 restantes por LORENA, sin pasar por Gianmarcos (0)', async () => {
        filas = [brevo(1, { creditos: 295 }), brevo(2, { creditos: 0, esPredeterminada: false }), brevo(3, { creditos: 300, esPredeterminada: false }), brevo(4, { creditos: 299, esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 295, 'xkeysib-2': 0, 'xkeysib-3': 300, 'xkeysib-4': 299 }

        const { valor: errores, porCredencial } = await conRecuento(() => enviarN(320))

        expect(errores.every((error) => error === null)).toBe(true)
        const envios = llamadasA('/smtp/email')
        expect(envios).toHaveLength(320)
        expect(envios.slice(0, 295).every((llamada) => apiKeyDe(llamada) === 'xkeysib-1' && remitenteDe(llamada) === 'brevo1@undc.edu.pe')).toBe(true)
        expect(envios.slice(295).every((llamada) => apiKeyDe(llamada) === 'xkeysib-3' && remitenteDe(llamada) === 'brevo3@undc.edu.pe')).toBe(true)
        expect(envios.some((llamada) => ['xkeysib-2', 'xkeysib-4'].includes(apiKeyDe(llamada)!))).toBe(false)
        expect(porCredencial).toEqual([{ credencialId: 1, nombre: 'Brevo 1', enviados: 295 }, { credencialId: 3, nombre: 'Brevo 3', enviados: 25 }])
        expect(filas.map((fila) => fila.creditos)).toEqual([0, 0, 275, 299])
        // Cerca del límite (los últimos 25 de ANGEL) se pregunta a Brevo antes de cada envío; con 300 de sobra no hace falta
        const cuentas = llamadasA('/account')
        expect(cuentas).toHaveLength(25)
        expect(cuentas.every((llamada) => apiKeyDe(llamada) === 'xkeysib-1')).toBe(true)
        // Ninguna quedó con error: cambiar de credencial por créditos no es un fallo
        expect(estados()).toEqual(['OK', null, 'OK', null])
    })

    it('si no alcanza (solo hay 295 envíos en total) los siguientes no se intentan: avisa que se agotó y no llama a Brevo de más', async () => {
        filas = [brevo(1, { creditos: 295 }), brevo(2, { creditos: 0, esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 295, 'xkeysib-2': 0 }

        const { valor: errores, porCredencial, agotado } = await conRecuento(() => enviarN(320))

        expect(errores.slice(0, 295).every((error) => error === null)).toBe(true)
        expect(errores.slice(295).every((error) => error?.includes('Ninguna credencial activa tiene envíos disponibles'))).toBe(true)
        expect(agotado).toBe(true)
        expect(porCredencial).toEqual([{ credencialId: 1, nombre: 'Brevo 1', enviados: 295 }])
        expect(llamadasA('/smtp/email')).toHaveLength(295)
    })

    it('con Gmail de respaldo, al agotarse Brevo sigue por Gmail (que no informa créditos)', async () => {
        const enviados: string[] = []
        const nodemailer = jest.requireMock('nodemailer') as { default: { createTransport: () => unknown } }
        nodemailer.default.createTransport = () => ({ sendMail: async (mensaje: { from: { address: string }, to: { address: string }[] }) => { enviados.push(mensaje.from.address); return { messageId: '<g>', accepted: mensaje.to.map((a) => a.address), rejected: [] } }, verify: jest.fn(), close: jest.fn() })
        filas = [brevo(1, { creditos: 3 }), gmail(9)]
        brevoReal = { 'xkeysib-1': 3 }

        const { valor: errores, porCredencial } = await conRecuento(() => enviarN(5))

        expect(errores.every((error) => error === null)).toBe(true)
        expect(porCredencial).toEqual([{ credencialId: 1, nombre: 'Brevo 1', enviados: 3 }, { credencialId: 9, nombre: 'Gmail', enviados: 2 }])
        expect(enviados).toEqual(['garias@undc.edu.pe', 'garias@undc.edu.pe'])
    })
})

describe('Brevo se queda sin créditos antes de lo que decía el conteo', () => {
    it.each([
        ['402', () => respuesta(402, { message: 'You have not enough credits' })],
        ['400 con el código not_enough_credits', () => respuesta(400, { code: 'not_enough_credits', message: 'x' })],
        ['400 cuyo mensaje habla de créditos', () => respuesta(400, { code: 'invalid_parameter', message: 'Your account has no credit left' })],
    ])('(%s) ese correo sale por la siguiente, ANGEL queda en 0 y no se vuelve a intentar, tampoco tras un reinicio', async (_caso, fallo) => {
        filas = [brevo(1, { creditos: 295 }), brevo(2, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 10, 'xkeysib-2': 300 }
        reglas['xkeysib-1'] = () => ((brevoReal['xkeysib-1'] ?? 0) > 0 ? instalarYEnviar() : fallo())
        function instalarYEnviar() {
            brevoReal['xkeysib-1']! -= 1
            numeroMensaje += 1
            return respuesta(201, { messageId: `<m${numeroMensaje}@brevo>` })
        }

        const errores = await enviarN(20)

        expect(errores.every((error) => error === null)).toBe(true)
        expect(llamadasA('/smtp/email').filter((llamada) => apiKeyDe(llamada) === 'xkeysib-1')).toHaveLength(11) // 10 aceptados y 1 rechazado
        expect(llamadasA('/smtp/email').filter((llamada) => apiKeyDe(llamada) === 'xkeysib-2')).toHaveLength(10)
        expect(filas[0]).toMatchObject({ creditos: 0, ultimoEstado: 'ERROR' })
        expect(filas[0]!.creditosEn).toBeInstanceOf(Date)

        reiniciarEsperasDeCredenciales() // como un reinicio del servidor: la espera en memoria se pierde, el 0 de la BD no
        await enviarN(1)
        expect(llamadasA('/smtp/email').filter((llamada) => apiKeyDe(llamada) === 'xkeysib-1')).toHaveLength(11)
    })

    it.each([
        ['un 429 de velocidad', () => respuesta(429, { code: 'too_many_requests', message: 'rate limit exceeded' })],
        ['un 400 por el tamaño del adjunto', () => respuesta(400, { code: 'invalid_parameter', message: 'attachment size limit exceeded' })],
    ])('%s no deja la cuenta en 0', async (_caso, fallo) => {
        filas = [brevo(1, { creditos: 50 }), brevo(2, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-2': 300 }
        reglas['xkeysib-1'] = fallo

        expect(await enviarN(1)).toEqual([null])
        expect(filas[0]!.creditos).toBe(50)
    })

    it('una cuenta que acepta pero ya no tiene créditos según la revisión (Brevo gratis encola sin error) no se usa', async () => {
        // La BD cree que quedan 100, pero Brevo informa 0: la revisión forzada de antes de un envío masivo lo detecta
        filas = [brevo(1, { creditos: 100 }), brevo(2, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 0, 'xkeysib-2': 300 }
        reglas['xkeysib-1'] = () => respuesta(201, { messageId: '<encolado@brevo>' }) // aceptaría y lo dejaría en cola

        expect(await prepararEnvioMasivo(null)).toEqual({ total: 300, hayDesconocida: false })
        expect(filas[0]).toMatchObject({ creditos: 0 })
        await enviarN(3)
        expect(llamadasA('/smtp/email').every((llamada) => apiKeyDe(llamada) === 'xkeysib-2')).toBe(true)
    })
})

describe('una dirección mala no deja todas las credenciales en error', () => {
    const rechazar = () => respuesta(400, { code: 'invalid_parameter', message: 'email is not valid in to' })

    it('si todas la rechazan, solo queda con error la elegida y el código de acceso sigue disponible por otra', async () => {
        filas = [brevo(1), brevo(2, { esPredeterminada: false }), brevo(3, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 300, 'xkeysib-2': 300, 'xkeysib-3': 300 }
        for (const clave of ['xkeysib-1', 'xkeysib-2', 'xkeysib-3']) reglas[clave] = rechazar

        const error = await enviarConCredencial({ ...filas[0]! } as never, correo)

        expect(error).toContain('400')
        expect(llamadasA('/smtp/email')).toHaveLength(3)
        expect(estados()).toEqual(['ERROR', null, null])
        expect((await credencialUtilizable())?.id).toBe(2)
    })

    it('si otra credencial sí la acepta, la que falló antes queda con error (el problema era de ella)', async () => {
        filas = [brevo(1), brevo(2, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 300, 'xkeysib-2': 300 }
        reglas['xkeysib-1'] = rechazar

        expect(await enviarConCredencial({ ...filas[0]! } as never, correo)).toBeNull()
        expect(estados()).toEqual(['ERROR', 'OK'])
    })
})

describe('prepararEnvioMasivo (antes de reservar la marca de nadie)', () => {
    it('revisa al día cada credencial aunque su revisión sea reciente y suma los envíos que hay', async () => {
        filas = [brevo(1, { creditos: 295 }), brevo(2, { creditos: 0, esPredeterminada: false }), brevo(3, { creditos: 300, esPredeterminada: false }), brevo(4, { creditos: 299, esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 295, 'xkeysib-2': 0, 'xkeysib-3': 300, 'xkeysib-4': 299 }

        expect(await prepararEnvioMasivo(null)).toEqual({ total: 894, hayDesconocida: false })
        expect(llamadasA('/account').map(apiKeyDe).sort()).toEqual(['xkeysib-1', 'xkeysib-2', 'xkeysib-3', 'xkeysib-4'])
        expect(llamadasA('/smtp/email')).toHaveLength(0)
    })

    it('con Gmail entre las activas avisa que hay envíos de los que no se sabe cuántos', async () => {
        filas = [brevo(1, { creditos: 40 }), gmail(9)]
        brevoReal = { 'xkeysib-1': 40 }
        expect(await prepararEnvioMasivo(null)).toEqual({ total: 40, hayDesconocida: true })
    })

    it('si ninguna activa tiene envíos responde 409 EMAIL_CREDITS_EXHAUSTED y no envía nada', async () => {
        filas = [brevo(1, { creditos: 12 }), brevo(2, { esPredeterminada: false })]
        brevoReal = { 'xkeysib-1': 0, 'xkeysib-2': 0 }
        await expect(prepararEnvioMasivo(null)).rejects.toMatchObject({ status: 409, code: 'EMAIL_CREDITS_EXHAUSTED' })
        expect(llamadasA('/smtp/email')).toHaveLength(0)
        expect(filas.map((fila) => fila.creditos)).toEqual([0, 0])
    })

    it('sin credenciales activas responde 409 EMAIL_CREDENTIAL_UNAVAILABLE', async () => {
        filas = [brevo(1, { activo: false })]
        await expect(prepararEnvioMasivo(null)).rejects.toMatchObject({ status: 409, code: 'EMAIL_CREDENTIAL_UNAVAILABLE' })
    })

    it('si el evento tiene su propia credencial, esa va primero aunque no sea la predeterminada', async () => {
        filas = [brevo(1), brevo(2, { esPredeterminada: false, creditos: 5 })]
        brevoReal = { 'xkeysib-1': 300, 'xkeysib-2': 5 }
        const errores = await (async () => {
            const resultados: (string | null)[] = []
            for (let i = 0; i < 7; i += 1) resultados.push(await enviarConCredencial({ ...filas[1]! } as never, correo))
            return resultados
        })()
        expect(errores.every((error) => error === null)).toBe(true)
        const claves = llamadasA('/smtp/email').map(apiKeyDe)
        expect(claves).toEqual(['xkeysib-2', 'xkeysib-2', 'xkeysib-2', 'xkeysib-2', 'xkeysib-2', 'xkeysib-1', 'xkeysib-1'])
    })
})

import jwt from 'jsonwebtoken'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import * as codigos from '../../src/core/codigos'
import { cifrar } from '../../src/core/crypto'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { AUDIENCIA_PARTICIPANTE, SESION_PARTICIPANTE_SEGUNDOS, type CargaSesion } from '../../src/core/sesiones'
import { reiniciarEstadoCodigos, solicitarCodigo, verificarCodigo } from '../../src/api/participant-auth/services/participant-auth'
import { CorreoFallido } from '../../src/api/email-credential/services/brevo-client'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        codigoAcceso: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
        participante: { findUnique: jest.fn() },
        credencialCorreo: { findFirst: jest.fn(), update: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

jest.mock('../../src/api/email-credential/services/brevo-client', () => {
    const real = jest.requireActual('../../src/api/email-credential/services/brevo-client') as typeof import('../../src/api/email-credential/services/brevo-client')
    return { ...real, enviarConBrevo: jest.fn() }
})

type Mocks = Record<string, jest.Mock>
const m = prisma as unknown as { $transaction: jest.Mock } & Record<'codigoAcceso' | 'participante' | 'credencialCorreo' | 'configuracionSistema' | 'tokenAcceso', Mocks>
const enviarConBrevo = (jest.requireMock('../../src/api/email-credential/services/brevo-client') as { enviarConBrevo: jest.Mock }).enviarConBrevo

// ─── «Tabla» codigos_acceso en memoria (solo los filtros que usa el servicio) ─────

interface Fila {
    id: number
    correo: string
    codigoHash: string
    participanteId: number | null
    ip: string | null
    intentos: number
    expiraEn: Date
    usadoEn: Date | null
    invalidadoEn: Date | null
    creadoEn: Date
}

let filas: Fila[] = []
let siguienteId = 1

type Condicion = Record<string, unknown>

function cumple(fila: Fila, where: Condicion = {}): boolean {
    return Object.entries(where).every(([campo, esperado]) => {
        const valor = (fila as unknown as Record<string, unknown>)[campo]
        if (esperado === null) return valor === null
        if (esperado instanceof Date) return valor instanceof Date && valor.getTime() === esperado.getTime()
        if (typeof esperado === 'object') {
            const op = esperado as { gt?: number | Date, lt?: number | Date, not?: unknown, in?: unknown[] }
            const num = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v))
            if (op.gt !== undefined && !(valor !== null && num(valor) > num(op.gt))) return false
            if (op.lt !== undefined && !(valor !== null && num(valor) < num(op.lt))) return false
            if ('not' in op && valor === op.not) return false
            if (op.in !== undefined && !op.in.includes(valor)) return false
            return true
        }
        return valor === esperado
    })
}

const ordenar = (lista: Fila[]) => [...lista].sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime() || b.id - a.id)

function aplicar(fila: Fila, data: Record<string, unknown>) {
    for (const [campo, valor] of Object.entries(data)) {
        const destino = fila as unknown as Record<string, unknown>
        if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
            const op = valor as { increment?: number, decrement?: number }
            if (op.increment) destino[campo] = Number(destino[campo]) + op.increment
            if (op.decrement) destino[campo] = Number(destino[campo]) - op.decrement
        } else {
            destino[campo] = valor
        }
    }
}

function instalarTabla() {
    m.codigoAcceso.findMany.mockImplementation(async ({ where, skip = 0, take }: { where: Condicion, skip?: number, take?: number }) =>
        ordenar(filas.filter((f) => cumple(f, where))).slice(skip, take === undefined ? undefined : skip + take).map((f) => ({ ...f })))
    m.codigoAcceso.findFirst.mockImplementation(async ({ where }: { where: Condicion }) => {
        const fila = ordenar(filas.filter((f) => cumple(f, where)))[0]
        return fila ? { ...fila } : null
    })
    m.codigoAcceso.updateMany.mockImplementation(async ({ where, data }: { where: Condicion, data: Record<string, unknown> }) => {
        const afectadas = filas.filter((f) => cumple(f, where))
        afectadas.forEach((f) => aplicar(f, data))
        return { count: afectadas.length }
    })
    m.codigoAcceso.create.mockImplementation(async ({ data }: { data: Omit<Fila, 'id' | 'intentos' | 'usadoEn' | 'invalidadoEn'> }) => {
        const fila: Fila = { id: siguienteId++, intentos: 0, usadoEn: null, invalidadoEn: null, ...data }
        filas.push(fila)
        return { id: fila.id }
    })
    m.codigoAcceso.deleteMany.mockImplementation(async ({ where }: { where: Condicion }) => {
        const antes = filas.length
        filas = filas.filter((f) => !cumple(f, where))
        return { count: antes - filas.length }
    })
}

/** Simula que pasó el tiempo: corre hacia atrás todas las fechas de la tabla. */
function envejecer(ms: number) {
    for (const f of filas) {
        f.creadoEn = new Date(f.creadoEn.getTime() - ms)
        f.expiraEn = new Date(f.expiraEn.getTime() - ms)
        if (f.usadoEn) f.usadoEn = new Date(f.usadoEn.getTime() - ms)
        if (f.invalidadoEn) f.invalidadoEn = new Date(f.invalidadoEn.getTime() - ms)
    }
}

function insertar(correo: string, codigo: string, cambios: Partial<Fila> = {}): Fila {
    const ahora = Date.now()
    const fila: Fila = {
        id: siguienteId++, correo, codigoHash: codigos.hashCodigoAcceso(correo, codigo), participanteId: 50, ip: '10.0.0.1', intentos: 0,
        expiraEn: new Date(ahora + 10 * 60 * 1000), usadoEn: null, invalidadoEn: null, creadoEn: new Date(ahora), ...cambios,
    }
    filas.push(fila)
    return fila
}

// ─── Datos ──────────────────────────────────────────────────────────────────

const ANA = { id: 50, nombres: 'Ana <b>', apellidos: 'Pérez', correo: 'ana@gmail.com', googleSub: null as string | null }
const BETO = { id: 51, nombres: 'Beto', apellidos: 'Ríos', correo: 'beto@undc.edu.pe', googleSub: 'google-sub-beto' }
let participantes: (typeof ANA)[] = []

const credencial = (cambios: Record<string, unknown> = {}) => ({
    id: 3, proveedor: 'BREVO', nombre: 'Principal', apiKeyCifrada: cifrar('xkeysib-prueba'), apiKeySufijo: 'ueba', remitenteCorreo: 'no-reply@ciisic.pe',
    remitenteNombre: 'CIISIC', esPredeterminada: true, activo: true, ultimoEstado: 'OK', ultimoError: null, ultimaPruebaEn: null, ultimoEnvioEn: null,
    creadoEn: new Date(), actualizadoEn: new Date(), ...cambios,
})

const pedir = (correo: string) => request(app).post('/api/v1/auth/participant/code').send({ correo })
const verificar = (correo: string, codigo: string) => request(app).post('/api/v1/auth/participant/code/verify').send({ correo, codigo })

/** El manejador de errores registra los 503 de negocio con `console.warn`: se silencian en las pruebas que los esperan. */
const silenciarErroresInternos = () => jest.spyOn(console, 'warn').mockImplementation(() => undefined)

/** Deja correr los envíos diferidos (setImmediate + promesas). */
async function esperarEnvios() {
    for (let i = 0; i < 5; i++) await new Promise((resolver) => setImmediate(resolver))
}

/** Código del último correo enviado a esa dirección. */
function codigoEnviadoA(correo: string): string {
    const envio = [...enviarConBrevo.mock.calls].reverse().find(([, c]) => c.para[0].email === correo)
    if (!envio) throw new Error(`No se envió correo a ${correo}`)
    const encontrado = /(\d{6})<\/div>/.exec(envio[1].html as string)
    if (!encontrado) throw new Error('El correo no trae el código')
    return encontrado[1]
}

beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    reiniciarEstadoCodigos()
    reiniciarCacheConfiguracion()
    filas = []
    siguienteId = 1
    participantes = [{ ...ANA }, { ...BETO }]
    instalarTabla()
    m.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
    m.participante.findUnique.mockImplementation(async ({ where }: { where: { correo?: string, id?: number } }) =>
        participantes.find((p) => (where.correo !== undefined ? p.correo === where.correo : p.id === where.id)) ?? null)
    m.credencialCorreo.findFirst.mockResolvedValue(credencial())
    m.credencialCorreo.update.mockResolvedValue({})
    m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, googleClientId: 'cid.apps.googleusercontent.com', urlPanel: 'https://admin.example', rutasLegacyActivas: true, undcApiTimeoutMs: 8000 })
    m.tokenAcceso.update.mockResolvedValue({})
    enviarConBrevo.mockResolvedValue({ messageId: 'x' })
})

// ─── Solicitud ──────────────────────────────────────────────────────────────

describe('POST /v1/auth/participant/code', () => {
    it('responde 202 idéntico para un correo inscrito, uno inexistente y uno vinculado a Google', async () => {
        const respuestas = [await pedir('ana@gmail.com'), await pedir('nadie@gmail.com'), await pedir('beto@undc.edu.pe')]
        for (const r of respuestas) {
            expect(r.status).toBe(202)
            expect(r.headers['cache-control']).toBe('no-store')
        }
        expect(respuestas.map((r) => r.body)).toEqual(Array(3).fill({ success: true, data: { expiraEnSegundos: 600, reintentarEnSegundos: 60 } }))
        // Se busca al participante y se crea la fila siempre; el correo sale solo si existe (también con Google)
        expect(m.participante.findUnique).toHaveBeenCalledTimes(3)
        expect(filas.map((f) => [f.correo, f.participanteId])).toEqual([['ana@gmail.com', 50], ['nadie@gmail.com', null], ['beto@undc.edu.pe', 51]])
        await esperarEnvios()
        expect(enviarConBrevo.mock.calls.map(([, c]) => c.para[0].email)).toEqual(['ana@gmail.com', 'beto@undc.edu.pe'])
    })

    it('normaliza el correo y guarda solo el hash del código', async () => {
        expect((await pedir('  ANA@Gmail.com ')).status).toBe(202)
        await esperarEnvios()
        const codigo = codigoEnviadoA('ana@gmail.com')
        expect(codigo).toMatch(/^\d{6}$/)
        expect(filas).toHaveLength(1)
        const [fila] = filas
        expect(fila.correo).toBe('ana@gmail.com')
        expect(fila.codigoHash).toMatch(/^[0-9a-f]{64}$/)
        expect(fila.codigoHash).toBe(codigos.hashCodigoAcceso('ana@gmail.com', codigo))
        expect(JSON.stringify(m.codigoAcceso.create.mock.calls)).not.toContain(codigo)
        expect(fila.expiraEn.getTime() - fila.creadoEn.getTime()).toBe(600_000)
    })

    it('el correo va en español, sin enlaces, con el código y el aviso; escapa el nombre', async () => {
        await pedir('ana@gmail.com')
        await esperarEnvios()
        const [apiKey, correo] = enviarConBrevo.mock.calls[0]
        expect(apiKey).toBe('xkeysib-prueba')
        expect(correo.remitente).toEqual({ email: 'no-reply@ciisic.pe', name: 'CIISIC' })
        expect(correo.asunto).toMatch(/código de acceso/i)
        expect(correo.html).not.toMatch(/href|https?:\/\//i)
        expect(correo.html).toContain('Si no lo pediste, ignora este correo')
        expect(correo.html).toContain('Ana &lt;b&gt;')
        expect(correo.html).toContain('10 minutos')
    })

    it('espera de 60 s por correo (429 CODE_COOLDOWN con Retry-After); otro correo no espera', async () => {
        expect((await pedir('ana@gmail.com')).status).toBe(202)
        const r = await pedir('ana@gmail.com')
        expect(r.status).toBe(429)
        expect(r.body.code).toBe('CODE_COOLDOWN')
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(55)
        expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60)
        expect((await pedir('beto@undc.edu.pe')).status).toBe(202)
        envejecer(61_000)
        expect((await pedir('ana@gmail.com')).status).toBe(202)
    })

    it('la espera también vale para un correo inexistente (no revela si existe)', async () => {
        await pedir('nadie@gmail.com')
        expect((await pedir('nadie@gmail.com')).body.code).toBe('CODE_COOLDOWN')
    })

    it('máximo 5 por hora por correo', async () => {
        for (let i = 0; i < 5; i++) {
            expect((await pedir('ana@gmail.com')).status).toBe(202)
            envejecer(5 * 60_000)
        }
        const r = await pedir('ana@gmail.com')
        expect(r.status).toBe(429)
        expect(r.body.code).toBe('CODE_COOLDOWN')
        // El más antiguo de la hora lleva 25 min: faltan unos 35 min
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(34 * 60)
        expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(35 * 60)
    })

    it('máximo 10 por día por correo', async () => {
        for (let i = 0; i < 10; i++) insertar('ana@gmail.com', '000000', { creadoEn: new Date(Date.now() - (2 + i) * 60 * 60_000) })
        const r = await pedir('ana@gmail.com')
        expect(r.status).toBe(429)
        expect(r.body.code).toBe('CODE_COOLDOWN')
        expect(r.body.message).toMatch(/por día/)
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(12 * 60 * 60)
    })

    it('dos solicitudes simultáneas del mismo correo crean un solo código (la otra, 429 CODE_COOLDOWN)', async () => {
        const respuestas = await Promise.all([pedir('ana@gmail.com'), pedir('ana@gmail.com')])
        expect(respuestas.map((r) => r.status).sort()).toEqual([202, 429])
        expect(respuestas.find((r) => r.status === 429)?.body.code).toBe('CODE_COOLDOWN')
        expect(filas).toHaveLength(1)
        await esperarEnvios()
        expect(enviarConBrevo).toHaveBeenCalledTimes(1)
    })

    it('presupuesto global de envíos: 400 por hora (503 CODE_LOGIN_UNAVAILABLE con Retry-After), exista o no el correo', async () => {
        silenciarErroresInternos()
        for (let i = 0; i < 400; i++) {
            insertar(`persona${i}@gmail.com`, '000000', { participanteId: 1000 + i, ip: `10.3.${i % 200}.1`, creadoEn: new Date(Date.now() - (50 - i / 10) * 60_000) })
        }
        for (const correo of ['ana@gmail.com', 'nadie@gmail.com']) {
            const r = await pedir(correo)
            expect(r.status).toBe(503)
            expect(r.body.code).toBe('CODE_LOGIN_UNAVAILABLE')
            // Se libera cuando el más antiguo de los 400 sale de la hora (unos 10 min)
            expect(Number(r.headers['retry-after'])).toBeGreaterThan(9 * 60)
            expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(10 * 60)
        }
        expect(filas).toHaveLength(400)
        // Con uno menos se vuelve a enviar; las solicitudes de correos inexistentes no gastan el presupuesto
        filas = filas.slice(1)
        expect((await pedir('nadie@gmail.com')).status).toBe(202)
        expect((await pedir('beto@undc.edu.pe')).status).toBe(202)
        expect((await pedir('ana@gmail.com')).body.code).toBe('CODE_LOGIN_UNAVAILABLE')
    })

    it('presupuesto global de envíos: 2000 por día', async () => {
        silenciarErroresInternos()
        for (let i = 0; i < 2000; i++) {
            insertar(`persona${i}@gmail.com`, '000000', { participanteId: 1000 + i, ip: null, creadoEn: new Date(Date.now() - (2 * 60 + i / 2) * 60_000) })
        }
        const r = await pedir('nadie@gmail.com')
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('CODE_LOGIN_UNAVAILABLE')
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(60 * 60)
    })

    it('máximo 200 por hora por IP, contado en la BD', async () => {
        expect((await pedir('ana@gmail.com')).status).toBe(202)
        const ip = filas[0].ip
        expect(ip).toBeTruthy()
        for (let i = 0; i < 199; i++) insertar(`persona${i}@gmail.com`, '000000', { ip, participanteId: null })
        const r = await pedir('beto@undc.edu.pe')
        expect(r.status).toBe(429)
        expect(r.body.code).toBe('RATE_LIMITED')
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
    })

    it('deja vigentes solo el código más reciente y el nuevo', async () => {
        const viejo = insertar('ana@gmail.com', '111111', { creadoEn: new Date(Date.now() - 5 * 60_000) })
        const reciente = insertar('ana@gmail.com', '222222', { creadoEn: new Date(Date.now() - 2 * 60_000) })
        await pedir('ana@gmail.com')
        expect(viejo.invalidadoEn).not.toBeNull()
        expect(reciente.invalidadoEn).toBeNull()
        expect(filas.filter((f) => f.invalidadoEn === null)).toHaveLength(2)
    })

    it('borra los códigos de más de 7 días', async () => {
        insertar('ana@gmail.com', '111111', { creadoEn: new Date(Date.now() - 8 * 24 * 60 * 60_000) })
        insertar('ana@gmail.com', '222222', { creadoEn: new Date(Date.now() - 6 * 24 * 60 * 60_000) })
        await pedir('nadie@gmail.com')
        await esperarEnvios()
        expect(m.codigoAcceso.deleteMany).toHaveBeenCalledTimes(1)
        expect(filas).toHaveLength(2)
    })

    it('503 CODE_LOGIN_UNAVAILABLE sin credencial predeterminada activa o con un error de hace menos de 15 min', async () => {
        silenciarErroresInternos()
        m.credencialCorreo.findFirst.mockResolvedValue(null)
        const r = await pedir('ana@gmail.com')
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('CODE_LOGIN_UNAVAILABLE')
        expect(m.credencialCorreo.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { activo: true, esPredeterminada: true } }))

        m.credencialCorreo.findFirst.mockResolvedValue(credencial({ ultimoEstado: 'ERROR', ultimoEnvioEn: new Date(Date.now() - 5 * 60_000) }))
        expect((await pedir('ana@gmail.com')).body.code).toBe('CODE_LOGIN_UNAVAILABLE')
        expect(filas).toHaveLength(0)

        // Pasados 15 min se vuelve a intentar (disyuntor que se recupera solo)
        m.credencialCorreo.findFirst.mockResolvedValue(credencial({ ultimoEstado: 'ERROR', ultimoEnvioEn: new Date(Date.now() - 16 * 60_000) }))
        expect((await pedir('ana@gmail.com')).status).toBe(202)
    })

    it('un fallo de Brevo en el envío diferido no tumba el proceso, no registra datos personales ni marca la credencial', async () => {
        const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        enviarConBrevo.mockRejectedValue(new CorreoFallido('Brevo respondió 400: email ana@gmail.com inválido', 400))
        expect((await pedir('ana@gmail.com')).status).toBe(202)
        await esperarEnvios()
        // Lo provocó un anónimo y solo ocurre si el correo existe: su fallo no cambia
        // `accesoCodigo.disponible` (sería un oráculo de qué correos existen)
        expect(m.credencialCorreo.update).not.toHaveBeenCalled()
        expect((await request(app).get('/api/v1/auth/config')).body.data.accesoCodigo).toEqual({ disponible: true })
        expect(consola).toHaveBeenCalledTimes(1)
        const registro = String(consola.mock.calls[0][0])
        expect(registro).toMatch(/solicitud \d+/)
        expect(registro).not.toContain('ana@gmail.com')
        expect(registro).not.toMatch(/\d{6}/)
    })

    it('422 si el correo no es válido', async () => {
        const r = await pedir('no-es-correo')
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })
})

// ─── Verificación ───────────────────────────────────────────────────────────

describe('POST /v1/auth/participant/code/verify', () => {
    it('con el código correcto abre una sesión de participante de 12 h (metodo CODIGO)', async () => {
        await pedir('ana@gmail.com')
        await esperarEnvios()
        const r = await verificar('Ana@Gmail.com', codigoEnviadoA('ana@gmail.com'))
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data).toEqual({
            jwt: expect.any(String),
            tipo: 'PARTICIPANTE',
            participante: { id: 50, nombres: 'Ana <b>', apellidos: 'Pérez', correo: 'ana@gmail.com' },
            expiraEn: expect.any(String),
        })
        const carga = jwt.decode(r.body.data.jwt) as CargaSesion
        expect(carga.aud).toBe(AUDIENCIA_PARTICIPANTE)
        expect(carga.metodo).toBe('CODIGO')
        expect(carga.user).toBeUndefined()
        expect(carga.participante?.id).toBe(50)
        expect(Number(carga.exp) - Number(carga.iat)).toBe(SESION_PARTICIPANTE_SEGUNDOS)
        expect(filas[0].usadoEn).not.toBeNull()
        // Es una sesión de participante, nunca de staff
        const sesion = await request(app).get('/api/v1/auth/session').set('Authorization', `Bearer ${r.body.data.jwt}`)
        expect(sesion.status).toBe(200)
        expect(sesion.body.tipo).toBe('PARTICIPANTE')
        expect((await request(app).post('/api/v1/auth/refresh').set('Authorization', `Bearer ${r.body.data.jwt}`)).status).toBe(403)
    })

    it('acepta espacios o guiones al pegar el código', async () => {
        insertar('ana@gmail.com', '123456')
        expect((await verificar('ana@gmail.com', '123 456')).status).toBe(200)
    })

    it('una cuenta vinculada a Google también entra con el código', async () => {
        await pedir('beto@undc.edu.pe')
        await esperarEnvios()
        const r = await verificar('beto@undc.edu.pe', codigoEnviadoA('beto@undc.edu.pe'))
        expect(r.status).toBe(200)
        expect(r.body.data.participante.id).toBe(51)
    })

    it('acepta el penúltimo código y no cuenta como fallo el intento reservado en el último', async () => {
        await pedir('ana@gmail.com')
        await esperarEnvios()
        const primero = codigoEnviadoA('ana@gmail.com')
        envejecer(61_000)
        await pedir('ana@gmail.com')
        await esperarEnvios()
        expect(codigoEnviadoA('ana@gmail.com')).not.toBe(primero)
        const r = await verificar('ana@gmail.com', primero)
        expect(r.status).toBe(200)
        const [usado, nuevo] = filas
        expect(usado.usadoEn).not.toBeNull()
        expect(nuevo.invalidadoEn).not.toBeNull()
        expect(nuevo.intentos).toBe(0)
    })

    it('el antepenúltimo código ya no sirve', async () => {
        insertar('ana@gmail.com', '111111', { creadoEn: new Date(Date.now() - 3 * 60_000) })
        insertar('ana@gmail.com', '222222', { creadoEn: new Date(Date.now() - 2 * 60_000) })
        insertar('ana@gmail.com', '333333', { creadoEn: new Date(Date.now() - 60_000) })
        const r = await verificar('ana@gmail.com', '111111')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('INVALID_CODE')
    })

    it('cuenta los intentos: el 5.º fallo agota el código', async () => {
        insertar('ana@gmail.com', '123456')
        const restantes: string[] = []
        for (let i = 0; i < 5; i++) {
            const r = await verificar('ana@gmail.com', '000000')
            expect(r.status).toBe(401)
            expect(r.body.code).toBe('INVALID_CODE')
            restantes.push(r.body.fields.restantes)
        }
        expect(restantes).toEqual(['4', '3', '2', '1', '0'])
        const agotado = await verificar('ana@gmail.com', '123456')
        expect(agotado.status).toBe(401)
        expect(agotado.body.code).toBe('CODE_EXPIRED')
    })

    it('el intento se reserva en la BD antes de comparar (intentos < 5)', async () => {
        const fila = insertar('ana@gmail.com', '123456', { intentos: 4 })
        // Otra petición en paralelo gastó el último intento entre la lectura y la reserva
        const original = m.codigoAcceso.updateMany.getMockImplementation()
        m.codigoAcceso.updateMany.mockImplementationOnce(async (args: { where: Condicion }) => {
            fila.intentos = 5
            return original?.(args)
        })
        const r = await verificar('ana@gmail.com', '123456')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('CODE_EXPIRED')
        expect(m.codigoAcceso.updateMany.mock.calls[0][0]).toEqual({
            where: expect.objectContaining({ id: fila.id, intentos: { lt: 5 }, usadoEn: null, invalidadoEn: null }),
            data: { intentos: { increment: 1 } },
        })
    })

    it('401 CODE_EXPIRED si el código venció', async () => {
        insertar('ana@gmail.com', '123456', { creadoEn: new Date(Date.now() - 11 * 60_000), expiraEn: new Date(Date.now() - 60_000) })
        const r = await verificar('ana@gmail.com', '123456')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('CODE_EXPIRED')
    })

    it('un código usado no se reutiliza', async () => {
        insertar('ana@gmail.com', '123456')
        expect((await verificar('ana@gmail.com', '123456')).status).toBe(200)
        const r = await verificar('ana@gmail.com', '123456')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('CODE_EXPIRED')
    })

    it('429 CODE_LOCKED tras 10 fallos en una hora por correo', async () => {
        insertar('ana@gmail.com', '111111', { intentos: 5, creadoEn: new Date(Date.now() - 20 * 60_000), expiraEn: new Date(Date.now() - 10 * 60_000) })
        insertar('ana@gmail.com', '222222', { intentos: 5, creadoEn: new Date(Date.now() - 5 * 60_000) })
        insertar('ana@gmail.com', '333333', { creadoEn: new Date(Date.now() - 60_000) })
        const r = await verificar('ana@gmail.com', '333333')
        expect(r.status).toBe(429)
        expect(r.body.code).toBe('CODE_LOCKED')
        // Se libera cuando el código más antiguo sale de la ventana de 1 h (unos 40 min)
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(39 * 60)
        expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(40 * 60)
        // Otro correo no se bloquea
        insertar('beto@undc.edu.pe', '444444', { participanteId: 51 })
        expect((await verificar('beto@undc.edu.pe', '444444')).status).toBe(200)
    })

    it('el disyuntor global pausa el acceso 1 h tras 150 verificaciones fallidas contra participantes (503 CODE_LOGIN_PAUSED)', async () => {
        const advertencia = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        for (let i = 0; i < 150; i++) {
            insertar(`persona${i}@gmail.com`, '123456', { participanteId: 1000 + i })
            // Desde 50 IP distintas: el tope por IP no los frena
            await expect(verificarCodigo(`persona${i}@gmail.com`, '000000', `10.1.0.${i % 50}`)).rejects.toMatchObject({ code: 'INVALID_CODE' })
        }
        expect(advertencia).toHaveBeenCalledTimes(1)
        insertar('ana@gmail.com', '123456')
        const r = await verificar('ana@gmail.com', '123456')
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('CODE_LOGIN_PAUSED')
        expect(Number(r.headers['retry-after'])).toBeGreaterThan(59 * 60)
        // Tampoco se envían códigos nuevos y el panel deja de ofrecerlo
        expect((await pedir('ana@gmail.com')).body.code).toBe('CODE_LOGIN_PAUSED')
        expect((await request(app).get('/api/v1/auth/config')).body.data.accesoCodigo).toEqual({ disponible: false })
        // Pasada la hora, vuelve
        const enUnaHora = new Date(Date.now() + 61 * 60_000)
        await expect(solicitarCodigo('nadie@gmail.com', '10.0.0.9', enUnaHora)).resolves.toEqual({ expiraEnSegundos: 600, reintentarEnSegundos: 60 })
    })

    it('los fallos con correos inventados no abren el disyuntor y una sola IP se frena en 50 (429 RATE_LIMITED)', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        for (let i = 0; i < 50; i++) {
            insertar(`inventado${i}@gmail.com`, '123456', { participanteId: null })
            expect((await verificar(`inventado${i}@gmail.com`, '000000')).body.code).toBe('INVALID_CODE')
        }
        insertar('inventado50@gmail.com', '123456', { participanteId: null })
        const bloqueada = await verificar('inventado50@gmail.com', '123456')
        expect(bloqueada.status).toBe(429)
        expect(bloqueada.body.code).toBe('RATE_LIMITED')
        expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(59 * 60)
        // Muchos más fallos con correos inventados desde otras redes tampoco pausan el acceso
        for (let i = 0; i < 200; i++) {
            insertar(`otro${i}@gmail.com`, '123456', { participanteId: null })
            await expect(verificarCodigo(`otro${i}@gmail.com`, '000000', `10.2.${Math.floor(i / 40)}.1`)).rejects.toMatchObject({ code: 'INVALID_CODE' })
        }
        insertar('ana@gmail.com', '123456')
        await expect(verificarCodigo('ana@gmail.com', '123456', '10.9.9.9')).resolves.toMatchObject({ tipo: 'PARTICIPANTE' })
        expect((await request(app).get('/api/v1/auth/config')).body.data.accesoCodigo).toEqual({ disponible: true })
    })

    it('un correo que solo es de staff (sin participante) nunca da sesión', async () => {
        jest.spyOn(codigos, 'nuevoCodigoAcceso').mockReturnValueOnce('654321')
        expect((await pedir('garias@undc.edu.pe')).status).toBe(202)
        await esperarEnvios()
        expect(enviarConBrevo).not.toHaveBeenCalled()
        expect(filas[0].participanteId).toBeNull()
        const r = await verificar('garias@undc.edu.pe', '654321')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('CODE_EXPIRED')
        expect(r.body.data).toBeUndefined()
    })

    it('si el participante cambió de correo después de pedir el código, no entra', async () => {
        insertar('ana@gmail.com', '123456')
        participantes[0].correo = 'ana.nueva@gmail.com'
        const r = await verificar('ana@gmail.com', '123456')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('CODE_EXPIRED')
    })

    it('422 si el código no tiene 6 dígitos', async () => {
        for (const codigo of ['12345', '1234567', 'abcdef']) {
            const r = await verificar('ana@gmail.com', codigo)
            expect(r.status).toBe(422)
            expect(r.body.code).toBe('VALIDATION_ERROR')
        }
        expect(m.codigoAcceso.findMany).not.toHaveBeenCalled()
    })
})

// ─── Configuración pública ──────────────────────────────────────────────────

describe('GET /v1/auth/config (accesoCodigo)', () => {
    it('el panel sabe si puede ofrecer el código; la landing (/v1/site/config) no cambia', async () => {
        const panel = await request(app).get('/api/v1/auth/config')
        expect(panel.body.data).toEqual({ google: { clientId: 'cid.apps.googleusercontent.com' }, urlPanel: 'https://admin.example', accesoCodigo: { disponible: true } })

        m.credencialCorreo.findFirst.mockResolvedValue(null)
        expect((await request(app).get('/api/v1/auth/config')).body.data.accesoCodigo).toEqual({ disponible: false })
        m.credencialCorreo.findFirst.mockRejectedValue(new Error('BD caída'))
        expect((await request(app).get('/api/v1/auth/config')).body.data.accesoCodigo).toEqual({ disponible: false })

        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, estado: 'PUBLICADO' }))
        const sitio = await request(app).get('/api/v1/site/config').set('X-Api-Key', TOKEN_SITIO)
        expect(sitio.body.data).toEqual({ google: { clientId: 'cid.apps.googleusercontent.com' }, urlPanel: 'https://admin.example' })
    })
})

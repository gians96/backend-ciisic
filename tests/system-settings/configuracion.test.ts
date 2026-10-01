import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { descifrar } from '../../src/core/crypto'
import { configuracionPublica, configuracionUndc, reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        configuracionSistema: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

const m = prisma as unknown as { configuracionSistema: Record<string, jest.Mock>, tokenAcceso: Record<string, jest.Mock> }
const superAdmin = () => `Bearer ${tokenDeRol('SUPERADMIN', 3)}`
const fetchOriginal = global.fetch
const fetchMock = jest.fn()

let fila: Record<string, unknown>
const nuevaFila = (cambios: Record<string, unknown> = {}) => ({
    id: 1, undcApiUrl: null, undcApiKeyCifrada: null, undcApiKeySufijo: null, undcApiTimeoutMs: 8000, undcUltimoEstado: null,
    undcUltimoError: null, undcUltimaPruebaEn: null, googleClientId: null, urlPanel: null, rutasLegacyActivas: true,
    actualizadoPorId: null, creadoEn: new Date(), actualizadoEn: new Date(), actualizadoPor: null, ...cambios,
})

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
afterAll(() => { global.fetch = fetchOriginal })
beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    fila = nuevaFila()
    m.configuracionSistema.findUnique.mockImplementation(() => Promise.resolve(fila))
    m.configuracionSistema.upsert.mockImplementation(({ update }) => {
        fila = { ...fila, ...(update ?? {}), actualizadoPor: update?.actualizadoPorId ? { id: 3, nombres: 'Sofía', apellidos: 'Admin' } : null }
        return Promise.resolve(fila)
    })
    m.configuracionSistema.update.mockImplementation(({ data }) => {
        fila = { ...fila, ...data }
        return Promise.resolve(fila)
    })
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('configuración del sistema (Owner)', () => {
    const rutas: ['get' | 'put' | 'post', string][] = [
        ['get', '/api/v1/settings'],
        ['put', '/api/v1/settings'],
        ['post', '/api/v1/settings/undc-api/test'],
    ]

    it.each(rutas)('%s %s exige sesión', async (metodo, ruta) => {
        expect((await request(app)[metodo](ruta)).status).toBe(401)
    })

    // 'sistema.configurar' es exclusivo del Owner (spec 013): ni el Administrador del sistema
    it.each(rutas)('%s %s responde 403 al Administrador, al Tesorero y a la Comisión', async (metodo, ruta) => {
        const tokens = [
            tokenDeRol('ADMIN'),
            tokenDeRol('TESORERO', 30, { eventoIds: [2] }),
            tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] }),
        ]
        for (const token of tokens) {
            const r = await request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`).send({ undcApiTimeoutMs: 5000 })
            expect(r.status).toBe(403)
            expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' })
        }
        for (const mock of Object.values(m.configuracionSistema)) expect(mock).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('registra al Owner que la cambió', async () => {
        const r = await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({ undcApiTimeoutMs: 5000 })
        expect(r.status).toBe(200)
        expect(m.configuracionSistema.upsert.mock.calls[0][0].update).toMatchObject({ actualizadoPorId: 3 })
    })

    it('guarda la API key cifrada, la enmascara y actualiza la caché al instante', async () => {
        const r = await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({
            undcApiUrl: 'https://api-jp.episundc.pe/', undcApiKey: 'undc_clave_secreta_9f3a', undcApiTimeoutMs: 9000,
            googleClientId: '1234567890-abc123.apps.googleusercontent.com', urlPanel: 'https://admin-ciisic.episundc.pe/inscripciones',
        })
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data).toMatchObject({
            undcApi: { url: 'https://api-jp.episundc.pe', apiKeyEnmascarada: '••••9f3a', timeoutMs: 9000, configurada: true, ultimoEstado: null },
            google: { clientId: '1234567890-abc123.apps.googleusercontent.com', configurado: true },
            urlPanel: 'https://admin-ciisic.episundc.pe',
            actualizadoPor: { id: 3 },
        })
        expect(JSON.stringify(r.body)).not.toContain('undc_clave_secreta')
        expect(descifrar(String(fila.undcApiKeyCifrada))).toBe('undc_clave_secreta_9f3a')
        // Sin volver a leer la BD
        m.configuracionSistema.findUnique.mockRejectedValue(new Error('no debería consultarse'))
        expect(await configuracionUndc()).toEqual({ url: 'https://api-jp.episundc.pe', apiKey: 'undc_clave_secreta_9f3a', timeoutMs: 9000 })
        expect(await configuracionPublica()).toEqual({ google: { clientId: '1234567890-abc123.apps.googleusercontent.com' }, urlPanel: 'https://admin-ciisic.episundc.pe' })
    })

    it('omitir la key la conserva y null la quita; valida formatos', async () => {
        fila = nuevaFila({ undcApiUrl: 'https://api-jp.episundc.pe', undcApiKeyCifrada: 'x', undcApiKeySufijo: 'abcd' })
        await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({ undcApiTimeoutMs: 5000 })
        expect(fila.undcApiKeyCifrada).toBe('x')
        await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({ undcApiKey: null })
        expect(fila).toMatchObject({ undcApiKeyCifrada: null, undcApiKeySufijo: null })

        const invalida = await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({ googleClientId: 'mi-cliente', undcApiTimeoutMs: 50 })
        expect(invalida.status).toBe(422)
        expect(Object.keys(invalida.body.fields)).toEqual(expect.arrayContaining(['googleClientId', 'undcApiTimeoutMs']))
        const http = await request(app).put('/api/v1/settings').set('Authorization', superAdmin()).send({ undcApiUrl: 'http://api.example.com' })
        expect(http.body.code).toBe('INVALID_URL')
    })

    it('prueba la conexión con API_UNDC y registra el resultado', async () => {
        const { cifrar } = await import('../../src/core/crypto')
        fila = nuevaFila({ undcApiUrl: 'https://api-jp.episundc.pe', undcApiKeyCifrada: cifrar('undc_clave_secreta_9f3a'), undcApiKeySufijo: '9f3a' })
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sucess: true, data: { es_estudiante: false } }), { status: 200 }))
        const ok = await request(app).post('/api/v1/settings/undc-api/test').set('Authorization', superAdmin())
        expect(ok.body.data).toMatchObject({ ok: true, codigoHttp: 200, configuracion: { undcApi: { ultimoEstado: 'OK' } } })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api-jp.episundc.pe/externo/estudiantes/verificar')
        expect(init).toMatchObject({ method: 'POST', redirect: 'manual' })
        expect(init.headers['X-API-Key']).toBe('undc_clave_secreta_9f3a')

        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ msg: 'SCOPE_INSUFICIENTE' }), { status: 403 }))
        const sinPermiso = await request(app).post('/api/v1/settings/undc-api/test').set('Authorization', superAdmin())
        expect(sinPermiso.body.data).toMatchObject({ ok: false, codigoHttp: 403, mensaje: expect.stringContaining('estudiantes:verificar') })
        expect(fila.undcUltimoEstado).toBe('ERROR')
    })

    it('si la URL redirige (la de un sitio web, no la de la API) lo explica sin seguir la redirección', async () => {
        const { cifrar } = await import('../../src/core/crypto')
        fila = nuevaFila({ undcApiUrl: 'https://jp.episundc.pe', undcApiKeyCifrada: cifrar('undc_clave_secreta_9f3a'), undcApiKeySufijo: '9f3a' })
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/' } }))

        const r = await request(app).post('/api/v1/settings/undc-api/test').set('Authorization', superAdmin())

        expect(r.body.data).toMatchObject({ ok: false, codigoHttp: 302, mensaje: expect.stringContaining('https://api-jp.episundc.pe') })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fila.undcUltimoError).toContain('redirige')
    })

    it('sin configurar, la prueba responde 409', async () => {
        const r = await request(app).post('/api/v1/settings/undc-api/test').set('Authorization', superAdmin())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('UNDC_API_NOT_CONFIGURED')
    })
})

describe('configuración pública', () => {
    it('el panel la lee sin sesión y la landing con su token; nunca incluye secretos', async () => {
        fila = nuevaFila({ googleClientId: '1-a.apps.googleusercontent.com', urlPanel: 'https://admin.example', undcApiKeyCifrada: 'secreto' })
        const panel = await request(app).get('/api/v1/auth/config')
        // El panel además sabe si puede ofrecer el código por correo (spec 014); sin credencial de correo, no
        expect(panel.body.data).toEqual({ google: { clientId: '1-a.apps.googleusercontent.com' }, urlPanel: 'https://admin.example', accesoCodigo: { disponible: false } })
        expect((await request(app).get('/api/v1/site/config')).status).toBe(401)
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ id: 2, estado: 'PUBLICADO' }))
        const sitio = await request(app).get('/api/v1/site/config').set('X-Api-Key', TOKEN_SITIO)
        // La landing recibe la forma de siempre
        expect(sitio.body.data).toEqual({ google: { clientId: '1-a.apps.googleusercontent.com' }, urlPanel: 'https://admin.example' })
        expect(JSON.stringify([panel.body, sitio.body])).not.toContain('secreto')
    })

    it('si la BD falla usa los valores por defecto (nada configurado)', async () => {
        m.configuracionSistema.findUnique.mockRejectedValue(new Error('caída'))
        expect(await configuracionPublica()).toEqual({ google: { clientId: null }, urlPanel: null })
    })
})

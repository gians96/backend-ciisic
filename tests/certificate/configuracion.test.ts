import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { descifrar } from '../../src/core/crypto'
import { credencialesUndcCertificados, reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { exigirProveedorConfirmado } from '../../src/api/certificate/codigos/proveedor'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        configuracionSistema: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
        certificado: { count: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { configuracionSistema: Record<'findUnique' | 'upsert' | 'update', Mock>, certificado: { count: Mock } }

const OWNER = () => `Bearer ${tokenDeRol('SUPERADMIN', 3)}`
const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const TESORERO = () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}`
const COMISION = () => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] })}`

let fila: Record<string, unknown>
const nuevaFila = (cambios: Record<string, unknown> = {}) => ({
    id: 1, undcApiUrl: null, undcApiKeyCifrada: null, undcApiKeySufijo: null, undcApiTimeoutMs: 8000, undcUltimoEstado: null,
    undcUltimoError: null, undcUltimaPruebaEn: null, googleClientId: null, urlPanel: 'https://admin-ciisic.episundc.pe', rutasLegacyActivas: true,
    certificadosProveedor: 'LOCAL', certificadosPrefijo: 'CIISIC', certificadosProveedorConfirmado: false,
    certificadosUndcUrl: null, certificadosUndcUsuario: null, certificadosUndcSecretoCifrado: null, certificadosUndcSecretoSufijo: null,
    certificadosUndcTimeoutMs: 10000, certificadosUndcUltimoEstado: null, certificadosUndcUltimoError: null, certificadosUndcUltimaPruebaEn: null,
    actualizadoPorId: null, creadoEn: new Date(), actualizadoEn: new Date('2026-10-01T15:00:00Z'), actualizadoPor: null, ...cambios,
})

/** Conteos de certificados: primero los que ya tienen PDF, después los vigentes con otro prefijo. */
let generados = 0
let conOtroPrefijo = 0

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    fila = nuevaFila()
    generados = 0
    conOtroPrefijo = 0
    m.configuracionSistema.findUnique.mockImplementation(() => Promise.resolve(fila))
    m.configuracionSistema.upsert.mockImplementation(({ update }) => {
        fila = { ...fila, ...(update ?? {}) }
        return Promise.resolve(fila)
    })
    m.configuracionSistema.update.mockImplementation(({ data }) => {
        fila = { ...fila, ...data }
        return Promise.resolve(fila)
    })
    m.certificado.count.mockImplementation(({ where }) => Promise.resolve(where.OR ? generados : conOtroPrefijo))
})

describe('GET/PUT /v1/certificate-settings (certificados.gestionar)', () => {
    it.each([['get'], ['put']] as const)('%s exige sesión y responde 403 al Tesorero y a la Comisión', async (metodo) => {
        expect((await request(app)[metodo]('/api/v1/certificate-settings')).status).toBe(401)
        for (const token of [TESORERO(), COMISION()]) {
            const r = await request(app)[metodo]('/api/v1/certificate-settings').set('Authorization', token).send({ prefijo: 'OTRO' })
            expect(r.status).toBe(403)
        }
        expect(m.configuracionSistema.upsert).not.toHaveBeenCalled()
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
    })

    it('el Administrador ve proveedor, prefijo y la URL de verificación derivada de la URL del panel (sin credenciales UNDC)', async () => {
        fila = nuevaFila({ certificadosUndcUrl: 'https://api-certificados.undc.example', certificadosUndcUsuario: 'ciisic', certificadosUndcSecretoCifrado: 'v1:x:y:z', certificadosUndcSecretoSufijo: 'abcd' })
        const r = await request(app).get('/api/v1/certificate-settings').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body.data).toEqual({
            proveedor: 'LOCAL',
            prefijo: 'CIISIC',
            proveedorConfirmado: false,
            urlVerificacionBase: 'https://admin-ciisic.episundc.pe/verificar',
            ejemploCodigo: expect.stringMatching(/^CIISIC-\d{4}-000123-7KQ2XM$/),
            ejemploUrlVerificacion: expect.stringMatching(/^https:\/\/admin-ciisic\.episundc\.pe\/verificar\/CIISIC-\d{4}-000123-7KQ2XM$/),
            prefijoBloqueado: false,
            certificadosGenerados: 0,
            certificadosConOtroPrefijo: 0,
            proveedores: [
                { codigo: 'LOCAL', nombre: expect.any(String), disponible: true },
                { codigo: 'UNDC', nombre: expect.any(String), disponible: false },
            ],
            undc: { credencialesConfiguradas: true, disponible: false },
            actualizadoEn: '2026-10-01T15:00:00.000Z',
        })
        const texto = JSON.stringify(r.body)
        expect(texto).not.toContain('api-certificados.undc.example')
        expect(texto).not.toContain('abcd')
        expect(texto).not.toContain('ciisic"')
    })

    it('sin URL del panel la base de verificación es null', async () => {
        fila = nuevaFila({ urlPanel: null })
        const r = await request(app).get('/api/v1/certificate-settings').set('Authorization', ADMIN())
        expect(r.body.data).toMatchObject({ urlVerificacionBase: null, ejemploUrlVerificacion: null })
    })

    it('cambia el prefijo (en mayúsculas) mientras no haya certificados generados; deja el proveedor sin confirmar', async () => {
        fila = nuevaFila({ certificadosProveedorConfirmado: true })
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ prefijo: 'ciisic8' })
        expect(r.status).toBe(200)
        expect(m.configuracionSistema.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { certificadosPrefijo: 'CIISIC8', certificadosProveedorConfirmado: false, actualizadoPorId: 2 },
        })
        expect(r.body.data).toMatchObject({ prefijo: 'CIISIC8', proveedorConfirmado: false, ejemploCodigo: expect.stringMatching(/^CIISIC8-/) })
    })

    it('con certificados generados el prefijo queda bloqueado (409 CERTIFICATE_SETTINGS_LOCKED); el mismo prefijo no es un cambio', async () => {
        generados = 3
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ prefijo: 'OTRO' })
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ code: 'CERTIFICATE_SETTINGS_LOCKED', message: expect.stringContaining('3 certificados generados') })
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
        // El conteo considera generados, firmados y los estados con PDF, aunque luego se hayan anulado
        const where = m.certificado.count.mock.calls[0][0].where
        expect(where.OR).toEqual(expect.arrayContaining([{ generadoEn: { not: null } }, { archivoFirmado: { not: null } }]))

        const igual = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ prefijo: 'ciisic' })
        expect(igual.status).toBe(200)
        expect(igual.body.data).toMatchObject({ prefijoBloqueado: true, certificadosGenerados: 3 })
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
    })

    it('informa cuántos vigentes conservan otro prefijo', async () => {
        conOtroPrefijo = 2
        const r = await request(app).get('/api/v1/certificate-settings').set('Authorization', ADMIN())
        expect(r.body.data.certificadosConOtroPrefijo).toBe(2)
        const where = m.certificado.count.mock.calls.find(([arg]) => !arg.where.OR)[0].where
        expect(where).toEqual({ estado: { not: 'ANULADO' }, NOT: { codigo: { startsWith: 'CIISIC-' } } })
    })

    it.each([['ci'], ['CIISIC-8'], ['con espacio'], ['X'.repeat(21)]])('valida el prefijo %s', async (prefijo) => {
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ prefijo })
        if (prefijo === 'ci') {
            // «ci» en mayúsculas es válido (2 caracteres)
            expect(r.status).toBe(200)
            return
        }
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { prefijo: expect.any(String) } })
    })

    it('confirmar el proveedor LOCAL habilita la descarga para firmar al instante (caché)', async () => {
        await expect(exigirProveedorConfirmado()).rejects.toMatchObject({ status: 409, code: 'PROVIDER_NOT_CONFIRMED' })
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ proveedorConfirmado: true })
        expect(r.status).toBe(200)
        expect(r.body.data.proveedorConfirmado).toBe(true)
        m.configuracionSistema.findUnique.mockRejectedValue(new Error('no debería consultarse'))
        await expect(exigirProveedorConfirmado()).resolves.toMatchObject({ proveedor: 'LOCAL', proveedorConfirmado: true })
    })

    it('elegir UNDC quita la confirmación; confirmarlo responde 501 mientras no haya API y no guarda nada', async () => {
        fila = nuevaFila({ certificadosProveedorConfirmado: true })
        const pendiente = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ proveedor: 'UNDC', proveedorConfirmado: true })
        expect(pendiente.status).toBe(501)
        expect(pendiente.body.code).toBe('CERTIFICATE_PROVIDER_PENDING')
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()

        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ proveedor: 'UNDC' })
        expect(r.status).toBe(200)
        expect(m.configuracionSistema.update.mock.calls[0][0].data).toMatchObject({ certificadosProveedor: 'UNDC', certificadosProveedorConfirmado: false })
        expect(r.body.data).toMatchObject({ proveedor: 'UNDC', proveedorConfirmado: false })

        const desconocido = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ proveedor: 'OTRO' })
        expect(desconocido.status).toBe(422)
    })

    it('quitar la confirmación no prueba el proveedor', async () => {
        fila = nuevaFila({ certificadosProveedor: 'UNDC', certificadosProveedorConfirmado: true })
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN()).send({ proveedorConfirmado: false })
        expect(r.status).toBe(200)
        expect(m.configuracionSistema.update.mock.calls[0][0].data).toMatchObject({ certificadosProveedorConfirmado: false })
    })

    it('ignora campos que no son suyos (URL de verificación, credenciales UNDC)', async () => {
        const r = await request(app).put('/api/v1/certificate-settings').set('Authorization', ADMIN())
            .send({ urlVerificacion: 'https://otro.example.com', certificadosUndcSecreto: 'secreto', urlPanel: 'https://otro.example.com' })
        expect(r.status).toBe(200)
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
        expect(r.body.data.urlVerificacionBase).toBe('https://admin-ciisic.episundc.pe/verificar')
    })
})

describe('credenciales de la API de certificados UNDC (Sistema, solo Owner)', () => {
    it('el Owner las guarda con el secreto cifrado; la API devuelve solo el sufijo', async () => {
        const r = await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({
            certificadosUndcUrl: 'https://certificados.undc.edu.pe/api/', certificadosUndcUsuario: 'ciisic', certificadosUndcSecreto: 'secreto-undc-7788', certificadosUndcTimeoutMs: 15000,
        })
        expect(r.status).toBe(200)
        expect(r.body.data.certificadosUndc).toEqual({
            url: 'https://certificados.undc.edu.pe/api', usuario: 'ciisic', secretoEnmascarado: '••••7788', timeoutMs: 15000,
            configurada: true, disponible: false, ultimoEstado: null, ultimoError: null, ultimaPruebaEn: null,
        })
        expect(JSON.stringify(r.body)).not.toContain('secreto-undc')
        expect(descifrar(String(fila.certificadosUndcSecretoCifrado))).toBe('secreto-undc-7788')
        m.configuracionSistema.findUnique.mockRejectedValue(new Error('no debería consultarse'))
        expect(await credencialesUndcCertificados()).toEqual({ url: 'https://certificados.undc.edu.pe/api', usuario: 'ciisic', secreto: 'secreto-undc-7788', timeoutMs: 15000 })
    })

    it('omitir el secreto lo conserva, null lo quita y cambiar la URL borra el último resultado', async () => {
        fila = nuevaFila({
            certificadosUndcUrl: 'https://certificados.undc.edu.pe', certificadosUndcUsuario: 'ciisic', certificadosUndcSecretoCifrado: 'x', certificadosUndcSecretoSufijo: 'abcd',
            certificadosUndcUltimoEstado: 'ERROR', certificadosUndcUltimoError: 'falló', certificadosUndcUltimaPruebaEn: new Date(),
        })
        await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({ certificadosUndcTimeoutMs: 5000 })
        expect(fila).toMatchObject({ certificadosUndcSecretoCifrado: 'x', certificadosUndcUltimoEstado: 'ERROR' })
        await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({ certificadosUndcUrl: 'https://certificados2.undc.edu.pe' })
        expect(fila).toMatchObject({ certificadosUndcUltimoEstado: null, certificadosUndcUltimoError: null, certificadosUndcUltimaPruebaEn: null })
        await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({ certificadosUndcSecreto: null })
        expect(fila).toMatchObject({ certificadosUndcSecretoCifrado: null, certificadosUndcSecretoSufijo: null })
    })

    it('valida la URL (https, sin destinos internos) y el timeout', async () => {
        const http = await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({ certificadosUndcUrl: 'http://certificados.undc.edu.pe' })
        expect(http.status).toBe(422)
        expect(http.body.code).toBe('INVALID_URL')
        const timeout = await request(app).put('/api/v1/settings').set('Authorization', OWNER()).send({ certificadosUndcTimeoutMs: 50 })
        expect(timeout.status).toBe(422)
        expect(Object.keys(timeout.body.fields)).toEqual(['certificadosUndcTimeoutMs'])
    })

    it('el Administrador (certificados.gestionar) no las ve ni las cambia', async () => {
        const put = await request(app).put('/api/v1/settings').set('Authorization', ADMIN()).send({ certificadosUndcSecreto: 'secreto-undc-7788' })
        expect(put.status).toBe(403)
        const get = await request(app).get('/api/v1/settings').set('Authorization', ADMIN())
        expect(get.status).toBe(403)
        expect(m.configuracionSistema.upsert).not.toHaveBeenCalled()
    })

    it('POST /v1/settings/certificados-undc/test responde 501 CERTIFICATE_PROVIDER_PENDING (solo Owner)', async () => {
        expect((await request(app).post('/api/v1/settings/certificados-undc/test')).status).toBe(401)
        const admin = await request(app).post('/api/v1/settings/certificados-undc/test').set('Authorization', ADMIN())
        expect(admin.status).toBe(403)
        const r = await request(app).post('/api/v1/settings/certificados-undc/test').set('Authorization', OWNER())
        expect(r.status).toBe(501)
        expect(r.body).toMatchObject({ success: false, code: 'CERTIFICATE_PROVIDER_PENDING' })
        expect(m.configuracionSistema.update).not.toHaveBeenCalled()
    })

    it('GET /v1/settings incluye el bloque certificadosUndc aunque la fila no tenga aún las columnas', async () => {
        const { certificadosUndcUrl, certificadosUndcTimeoutMs, ...sinColumnas } = nuevaFila()
        void certificadosUndcUrl
        void certificadosUndcTimeoutMs
        fila = sinColumnas
        const r = await request(app).get('/api/v1/settings').set('Authorization', OWNER())
        expect(r.status).toBe(200)
        expect(r.body.data.certificadosUndc).toMatchObject({ url: null, timeoutMs: 10000, configurada: false, disponible: false })
    })
})

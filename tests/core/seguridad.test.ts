import express from 'express'
import request from 'supertest'
import { asegurarDestinoPublico, esDireccionInterna, validarUrlSaliente } from '../../src/core/url-saliente'
import { tipoCuentaUndc } from '../../src/core/correo-institucional'
import { esCuentaGlobal, limitador } from '../../src/middlewares/rate-limit'

describe('URLs salientes (anti-SSRF sin lista de hosts)', () => {
    it('acepta https público y localhost por http solo fuera de producción', () => {
        expect(validarUrlSaliente('https://api-jp.episundc.pe/', { produccion: true })).toBe('https://api-jp.episundc.pe')
        expect(validarUrlSaliente('http://localhost:3020', { produccion: false })).toBe('http://localhost:3020')
        expect(() => validarUrlSaliente('http://localhost:3020', { produccion: true })).toThrow(expect.objectContaining({ code: 'INVALID_URL' }))
        expect(() => validarUrlSaliente('http://api.example.com', { produccion: false })).toThrow(expect.objectContaining({ code: 'INVALID_URL' }))
    })

    it('rechaza credenciales embebidas y destinos internos en producción', () => {
        expect(() => validarUrlSaliente('https://user:pass@api.example.com', { produccion: true })).toThrow(expect.objectContaining({ code: 'INVALID_URL' }))
        for (const url of ['https://127.0.0.1', 'https://10.1.2.3', 'https://192.168.1.10', 'https://169.254.169.254', 'https://[::1]', 'https://[::ffff:10.0.0.1]', 'https://servicio.internal', 'https://db.local']) {
            expect(() => validarUrlSaliente(url, { produccion: true })).toThrow(expect.objectContaining({ code: 'HOST_NOT_ALLOWED' }))
        }
    })

    it('clasifica direcciones internas IPv4 e IPv6', () => {
        expect(esDireccionInterna('100.64.1.1')).toBe(true)
        expect(esDireccionInterna('fd00::1')).toBe(true)
        expect(esDireccionInterna('8.8.8.8')).toBe(false)
        expect(esDireccionInterna('::ffff:a00:1')).toBe(true)
        expect(esDireccionInterna('::ffff:8.8.8.8')).toBe(false)
        expect(esDireccionInterna('2001:4860:4860::8888')).toBe(false)
    })

    it('antes de llamar resuelve el host y rechaza si alguna IP es interna', async () => {
        const publica = async () => [{ address: '34.120.1.1' }]
        const mixta = async () => [{ address: '34.120.1.1' }, { address: '10.0.0.8' }]
        await expect(asegurarDestinoPublico('https://api.example.com', { produccion: true, resolver: publica })).resolves.toBeUndefined()
        await expect(asegurarDestinoPublico('https://api.example.com', { produccion: true, resolver: mixta })).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' })
        await expect(asegurarDestinoPublico('https://api.example.com', { produccion: false, resolver: mixta })).resolves.toBeUndefined()
    })
})

describe('correo institucional UNDC (reglas fijas)', () => {
    it('distingue estudiante, personal y externo', () => {
        expect(tipoCuentaUndc('2021003668@undc.edu.pe')).toBe('ESTUDIANTE')
        expect(tipoCuentaUndc('GARIAS@UNDC.EDU.PE')).toBe('PERSONAL')
        expect(tipoCuentaUndc('j.perez@undc.edu.pe')).toBe('PERSONAL')
        expect(tipoCuentaUndc('2021003668@alumnos.undc.edu.pe')).toBe('EXTERNO')
        expect(tipoCuentaUndc('ana@gmail.com')).toBe('EXTERNO')
    })
})

describe('límite por token de acceso', () => {
    it('corta por token aunque el BFF envíe IPs de visitante distintas', async () => {
        const app = express()
        app.use((req, _res, next) => {
            Object.assign(req, { tokenAccesoId: 7, clienteIp: String(req.headers['x-client-ip']) })
            next()
        })
        app.get('/x', limitador(60_000, 2, 'límite', { clave: 'token', omitirEnPruebas: false }), (_req, res) => { res.json({ ok: true }) })
        const avisos = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const estados = []
        for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) estados.push((await request(app).get('/x').set('X-Client-Ip', ip)).status)
        expect(estados).toEqual([200, 200, 429])
        expect(avisos).toHaveBeenCalledWith(expect.stringContaining('token 7'))
        avisos.mockRestore()
    })
})

describe('límite por cuenta de staff (spec 013)', () => {
    it('corta a una cuenta por evento y exime a las cuentas globales', async () => {
        const app = express()
        app.use((req, _res, next) => {
            Object.assign(req, { actor: { id: Number(req.headers['x-actor']), alcance: req.headers['x-alcance'] } })
            next()
        })
        app.get('/x', limitador(60_000, 2, 'límite', { clave: 'actor', omitirEnPruebas: false, exenta: esCuentaGlobal }), (_req, res) => { res.json({ ok: true }) })
        const llamar = (actor: number, alcance: string) => request(app).get('/x').set('X-Actor', String(actor)).set('X-Alcance', alcance)
        const estados = async (actor: number, alcance: string) => {
            const lista = []
            for (let i = 0; i < 3; i++) lista.push((await llamar(actor, alcance)).status)
            return lista
        }
        expect(await estados(40, 'EVENTO')).toEqual([200, 200, 429])
        // Otra cuenta tiene su propio cupo; una global no tiene tope
        expect(await estados(41, 'EVENTO')).toEqual([200, 200, 429])
        expect(await estados(2, 'GLOBAL')).toEqual([200, 200, 200])
    })
})

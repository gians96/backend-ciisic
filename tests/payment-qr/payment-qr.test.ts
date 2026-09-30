import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_QR, REGEX_ARCHIVO_QR } from '../../src/core/almacenamiento'
import { tokenDeRol } from '../helpers/tokens'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        inscripcion: { count: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        $transaction: jest.fn(),
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock, findUniqueOrThrow: Mock, findMany: Mock, update: Mock }
    inscripcion: { count: Mock }
    tokenAcceso: { findUnique: Mock }
    $transaction: Mock
}

const ADMIN = `Bearer ${tokenDeRol('ADMIN')}`
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 3)])

/** Deja un QR en `uploads/qr` como si se hubiera subido. */
function qrEnDisco(ext = 'png'): string {
    const archivo = `qr-${randomUUID()}.${ext}`
    fs.mkdirSync(DIRECTORIO_QR, { recursive: true })
    fs.writeFileSync(path.join(DIRECTORIO_QR, archivo), PNG)
    return archivo
}
const existe = (archivo: string) => fs.existsSync(path.join(DIRECTORIO_QR, archivo))
const archivosEnDisco = () => (fs.existsSync(DIRECTORIO_QR) ? fs.readdirSync(DIRECTORIO_QR).length : 0)

function evento(qrArchivo: string | null = null) {
    return {
        id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', esPrincipal: true,
        fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'), credencialCorreoId: null, credencialCorreo: null,
        datosPago: { titular: 'UNDC', bancos: [], billeteras: [{ codigo: 'yape', nombre: 'Yape', telefono: '999888777', qrArchivo }] },
    }
}

const subir = (buffer: Buffer, filename = 'qr.png', contentType = 'image/png') =>
    request(app).post('/api/v1/payment-qr').set('Authorization', ADMIN).attach('file', buffer, { filename, contentType })

beforeEach(() => {
    jest.clearAllMocks()
    m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    m.inscripcion.count.mockResolvedValue(0)
})

describe('subida del QR (panel)', () => {
    it('exige una sesión de administrador', async () => {
        const res = await request(app).post('/api/v1/payment-qr').attach('file', PNG, { filename: 'qr.png', contentType: 'image/png' })
        expect(res.status).toBe(401)
    })

    it.each([
        ['PNG', PNG, 'qr.png', 'image/png', 'png'],
        ['JPG', JPG, 'yape.jpeg', 'image/jpeg', 'jpg'],
        ['WebP', WEBP, 'plin.webp', 'image/webp', 'webp'],
    ])('guarda un %s en uploads/qr con un nombre generado por el servidor', async (_tipo, buffer, filename, contentType, ext) => {
        const res = await subir(buffer, filename, contentType)
        expect(res.status).toBe(201)
        const { archivo } = res.body.data
        expect(archivo).toMatch(REGEX_ARCHIVO_QR)
        expect(archivo.endsWith(`.${ext}`)).toBe(true)
        expect(fs.readFileSync(path.join(DIRECTORIO_QR, archivo)).equals(buffer)).toBe(true)
    })

    it('rechaza lo que no es una imagen', async () => {
        const res = await subir(Buffer.from('%PDF-1.4'), 'qr.pdf', 'application/pdf')
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('INVALID_FILE_TYPE')
    })

    it('rechaza un archivo cuyo contenido no es la imagen declarada y no escribe nada', async () => {
        const antes = archivosEnDisco()
        const res = await subir(Buffer.from('<svg onload="alert(1)"></svg>'), 'qr.png', 'image/png')
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('INVALID_FILE_CONTENT')
        expect(archivosEnDisco()).toBe(antes)
    })

    it('rechaza imágenes de más de 2 MB', async () => {
        const res = await subir(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))
        expect(res.status).toBe(413)
    })

    it('pide el archivo si no se envía', async () => {
        const res = await request(app).post('/api/v1/payment-qr').set('Authorization', ADMIN)
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('FILE_REQUIRED')
    })
})

describe('imagen del QR', () => {
    it('el panel la ve con su sesión', async () => {
        const archivo = qrEnDisco()
        const res = await request(app).get(`/api/v1/payment-qr/${archivo}`).set('Authorization', ADMIN)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/png')
        expect(res.headers['cache-control']).toContain('private')
        expect((await request(app).get(`/api/v1/payment-qr/${archivo}`)).status).toBe(401)
    })

    it.each(['..%2F..%2F.env', 'qr-otro.png', `qr-${randomUUID()}.svg`, `qr-${randomUUID()}.png`])('no sirve nombres ajenos o inexistentes (%s)', async (nombre) => {
        const res = await request(app).get(`/api/v1/payment-qr/${nombre}`).set('Authorization', ADMIN)
        expect(res.status).toBe(404)
    })

    it('la landing solo recibe los QR que usa su evento', async () => {
        const propio = qrEnDisco()
        const ajeno = qrEnDisco()
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento(propio)))

        const res = await request(app).get(`/api/v1/site/payment-qr/${propio}`).set('X-Api-Key', TOKEN_SITIO)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('image/png')
        expect(res.headers['cache-control']).toContain('public')

        expect((await request(app).get(`/api/v1/site/payment-qr/${ajeno}`).set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        expect((await request(app).get(`/api/v1/site/payment-qr/${propio}`)).status).toBe(401)
    })
})

describe('datos de pago con QR subido', () => {
    const conQr = (qrArchivo: string) => ({ datosPago: evento(qrArchivo).datosPago })

    /** El evento guardado: el actual con los cambios del último `update`. */
    function eventoActual(actual: ReturnType<typeof evento>, otrosEventos: unknown[] = []) {
        const guardado = () => {
            const llamadas = m.evento.update.mock.calls
            return { ...actual, ...(llamadas.length ? llamadas[llamadas.length - 1][0].data : {}) }
        }
        m.evento.findUnique.mockResolvedValue(actual)
        m.evento.update.mockImplementation(async ({ data }) => ({ ...actual, ...data }))
        m.evento.findUniqueOrThrow.mockImplementation(async () => guardado())
        m.evento.findMany.mockImplementation(async () => [{ datosPago: guardado().datosPago }, ...otrosEventos])
    }

    it('no guarda un QR que no se subió', async () => {
        eventoActual(evento())
        const res = await request(app).put('/api/v1/events/2').set('Authorization', ADMIN).send(conQr(`qr-${randomUUID()}.png`))
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('QR_NOT_FOUND')
        expect(m.evento.update).not.toHaveBeenCalled()
    })

    it('valida el formato del nombre', async () => {
        eventoActual(evento())
        const res = await request(app).put('/api/v1/events/2').set('Authorization', ADMIN).send(conQr('../../.env'))
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('al reemplazar el QR borra el anterior', async () => {
        const anterior = qrEnDisco()
        const nuevo = qrEnDisco()
        eventoActual(evento(anterior))
        const res = await request(app).put('/api/v1/events/2').set('Authorization', ADMIN).send(conQr(nuevo))
        expect(res.status).toBe(200)
        expect(res.body.data.datosPago.billeteras[0].qrArchivo).toBe(nuevo)
        expect(existe(anterior)).toBe(false)
        expect(existe(nuevo)).toBe(true)
    })

    it('conserva el QR anterior si otro evento lo sigue usando (evento copiado)', async () => {
        const anterior = qrEnDisco()
        const nuevo = qrEnDisco()
        eventoActual(evento(anterior), [{ datosPago: evento(anterior).datosPago }])
        const res = await request(app).put('/api/v1/events/2').set('Authorization', ADMIN).send(conQr(nuevo))
        expect(res.status).toBe(200)
        expect(existe(anterior)).toBe(true)
    })
})

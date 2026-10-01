import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import QRCode from 'qrcode'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_FOTOS, DIRECTORIO_UPLOADS, nuevoNombreFoto, REGEX_ARCHIVO_FOTO } from '../../src/core/almacenamiento'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        inscripcion: { findMany: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as { participante: Record<'findUnique' | 'update' | 'updateMany', Mock>, inscripcion: { findMany: Mock } }
const SESION = `Bearer ${tokenDeParticipante(50, 'ana@gmail.com')}`

const participante = (cambios: Record<string, unknown> = {}) => ({
    id: 50, correo: 'ana@gmail.com', nombres: 'ANA', apellidos: 'PEREZ', tipoDocumentoId: 'dni', numeroDocumento: '70009999', celular: '987654321',
    googleSub: null, googleVinculadoEn: null, fotoArchivo: null, fotoActualizadaEn: null, ...cambios,
})

// ─── Imágenes de prueba ────────────────────────────────────────────────────

function chunk(tipo: string, datos: string): Buffer {
    const cuerpo = Buffer.from(datos, 'latin1')
    const cabecera = Buffer.alloc(8)
    cabecera.writeUInt32BE(cuerpo.length, 0)
    cabecera.write(tipo, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([cabecera.subarray(4), cuerpo])), 0)
    return Buffer.concat([cabecera, cuerpo, crc])
}

function segmento(marcador: number, datos: Buffer | string): Buffer {
    const cuerpo = Buffer.isBuffer(datos) ? datos : Buffer.from(datos, 'latin1')
    const cabecera = Buffer.from([0xff, marcador, 0, 0])
    cabecera.writeUInt16BE(cuerpo.length + 2, 2)
    return Buffer.concat([cabecera, cuerpo])
}

/** JPEG mínimo con EXIF (GPS) y un comentario. */
const JPEG_CON_EXIF = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segmento(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
    segmento(0xe1, 'Exif\0\0GPS -12.0464 -77.0428 secreto'),
    segmento(0xfe, 'comentario secreto'),
    segmento(0xdb, Buffer.alloc(65, 1)),
    segmento(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segmento(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34]),
    Buffer.from([0xff, 0xd9]),
])

let PNG_REAL: Buffer
let PNG_CON_TEXTO: Buffer

beforeAll(async () => {
    PNG_REAL = await QRCode.toBuffer('foto de prueba')
    // Tras la firma (8) y el IHDR (25): un chunk tEXt con datos personales
    PNG_CON_TEXTO = Buffer.concat([PNG_REAL.subarray(0, 33), chunk('tEXt', 'Author\0GPS secreto'), PNG_REAL.subarray(33)])
})

const fotosEnDisco = () => (fs.existsSync(DIRECTORIO_FOTOS) ? fs.readdirSync(DIRECTORIO_FOTOS) : [])
const subir = (buffer: Buffer, opciones: { filename?: string, contentType?: string, consentimiento?: string | null, token?: string } = {}) => {
    const r = request(app).put('/api/v1/me/photo').set('Authorization', opciones.token ?? SESION)
    if (opciones.consentimiento !== null) r.field('consentimiento', opciones.consentimiento ?? 'true')
    return r.attach('file', buffer, { filename: opciones.filename ?? 'foto.png', contentType: opciones.contentType ?? 'image/png' })
}

beforeEach(() => {
    jest.clearAllMocks()
    fs.rmSync(DIRECTORIO_FOTOS, { recursive: true, force: true })
    m.participante.findUnique.mockResolvedValue(participante())
    m.participante.updateMany.mockResolvedValue({ count: 1 })
    m.inscripcion.findMany.mockResolvedValue([])
})

describe('perfil del inscrito', () => {
    it('GET /me agrega celular, foto y si su cuenta está vinculada a Google', async () => {
        const actualizadaEn = new Date('2026-10-01T15:00:00Z')
        m.participante.findUnique.mockResolvedValue(participante({ googleSub: 'g-123', fotoArchivo: nuevoNombreFoto('jpg'), fotoActualizadaEn: actualizadaEn }))
        const r = await request(app).get('/api/v1/me').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.body.data).toEqual({
            id: 50, nombres: 'ANA', apellidos: 'PEREZ', correo: 'ana@gmail.com', tipoDocumento: 'dni', numeroDocumento: '70009999', celular: '987654321',
            foto: { tiene: true, actualizadaEn: actualizadaEn.toISOString() }, google: { vinculado: true },
        })
        expect(JSON.stringify(r.body)).not.toMatch(/g-123|foto-/)
    })

    it('PATCH /me/profile solo cambia el celular y valida su formato', async () => {
        m.participante.update.mockResolvedValue(participante({ celular: '+51987000111' }))
        const r = await request(app).patch('/api/v1/me/profile').set('Authorization', SESION)
            .send({ celular: ' +51987000111 ', nombres: 'OTRO', correo: 'x@gmail.com', numeroDocumento: '1' })
        expect(r.status).toBe(200)
        expect(m.participante.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { celular: '+51987000111' } })
        expect(r.body.data).toMatchObject({ celular: '+51987000111', nombres: 'ANA', foto: { tiene: false, actualizadaEn: null }, google: { vinculado: false } })

        for (const celular of ['12345', 'abc987654321', '+51 987 000 111', '']) {
            const malo = await request(app).patch('/api/v1/me/profile').set('Authorization', SESION).send({ celular })
            expect(malo.status).toBe(422)
            expect(malo.body.code).toBe('VALIDATION_ERROR')
        }
        expect(m.participante.update).toHaveBeenCalledTimes(1)
    })
})

describe('foto del fotocheck', () => {
    it('guarda un PNG válido sin metadatos, borra la foto anterior y los PDF con la foto vieja', async () => {
        fs.mkdirSync(DIRECTORIO_FOTOS, { recursive: true })
        const anterior = nuevoNombreFoto('jpg')
        fs.writeFileSync(path.join(DIRECTORIO_FOTOS, anterior), 'foto anterior')
        m.participante.findUnique.mockResolvedValue(participante({ fotoArchivo: anterior }))
        m.inscripcion.findMany.mockResolvedValue([{ id: 29 }])
        const pdf = path.join(DIRECTORIO_UPLOADS, 'credenciales', 'ciisic-viii-2026', '29-0123456789ab.pdf')
        fs.mkdirSync(path.dirname(pdf), { recursive: true })
        fs.writeFileSync(pdf, '%PDF-1.4 con la foto anterior')

        const r = await subir(PNG_CON_TEXTO)
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.body.data.foto.tiene).toBe(true)
        expect(new Date(r.body.data.foto.actualizadaEn).getTime()).toBeGreaterThan(Date.now() - 60_000)

        const archivos = fotosEnDisco()
        expect(archivos).toHaveLength(1)
        const [nombre] = archivos
        expect(nombre).toMatch(REGEX_ARCHIVO_FOTO)
        expect(nombre.endsWith('.png')).toBe(true)
        const guardado = fs.readFileSync(path.join(DIRECTORIO_FOTOS, nombre))
        expect(guardado.equals(PNG_REAL)).toBe(true)
        expect(guardado.toString('latin1')).not.toMatch(/secreto|tEXt/)

        // Cambio condicionado a la foto leída (no pisa un cambio simultáneo)
        expect(m.participante.updateMany).toHaveBeenCalledWith({
            where: { id: 50, fotoArchivo: anterior },
            data: { fotoArchivo: nombre, fotoActualizadaEn: expect.any(Date) },
        })
        expect(fs.existsSync(path.join(DIRECTORIO_FOTOS, anterior))).toBe(false)
        expect(m.inscripcion.findMany).toHaveBeenCalledWith({ where: { participanteId: 50 }, select: { id: true } })
        expect(fs.existsSync(pdf)).toBe(false)
    })

    it('guarda un JPEG válido sin EXIF ni comentarios', async () => {
        const r = await subir(JPEG_CON_EXIF, { filename: 'foto.jpg', contentType: 'image/jpeg' })
        expect(r.status).toBe(200)
        const [nombre] = fotosEnDisco()
        expect(nombre).toMatch(/^foto-.+\.jpg$/)
        const guardado = fs.readFileSync(path.join(DIRECTORIO_FOTOS, nombre))
        expect(guardado.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
        expect(guardado.length).toBeLessThan(JPEG_CON_EXIF.length)
        expect(guardado.toString('latin1')).not.toMatch(/Exif|GPS|secreto/)
        expect(m.participante.updateMany.mock.calls[0][0].where).toEqual({ id: 50, fotoArchivo: null })
    })

    it('rechaza texto disfrazado de PNG, un PNG declarado como JPEG y otros tipos, sin escribir nada', async () => {
        const disfrazado = await subir(Buffer.from('<svg onload="alert(1)"></svg>'), { filename: 'foto.png' })
        expect(disfrazado.status).toBe(422)
        expect(disfrazado.body.code).toBe('INVALID_FILE_CONTENT')

        const cruzado = await subir(PNG_REAL, { filename: 'foto.jpg', contentType: 'image/jpeg' })
        expect(cruzado.status).toBe(422)
        expect(cruzado.body.code).toBe('INVALID_FILE_CONTENT')

        const danado = await subir(Buffer.concat([PNG_REAL.subarray(0, 40)]))
        expect(danado.status).toBe(422)
        expect(danado.body.code).toBe('INVALID_FILE_CONTENT')

        const webp = await subir(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), { filename: 'foto.webp', contentType: 'image/webp' })
        expect(webp.status).toBe(422)
        expect(webp.body.code).toBe('INVALID_FILE_TYPE')

        expect(fotosEnDisco()).toEqual([])
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('más de 2 MB responde 413', async () => {
        const r = await subir(Buffer.concat([PNG_REAL, Buffer.alloc(2 * 1024 * 1024)]))
        expect(r.status).toBe(413)
        expect(r.body.code).toBe('UPLOAD_LIMIT_EXCEEDED')
        expect(fotosEnDisco()).toEqual([])
    })

    it('una bomba de descompresión (PNG pequeño de 25 000 × 25 000 px) responde 422 IMAGE_TOO_LARGE sin escribir nada', async () => {
        const ihdr = Buffer.from(PNG_REAL.subarray(8, 33))
        ihdr.writeUInt32BE(25_000, 8)
        ihdr.writeUInt32BE(25_000, 12)
        ihdr.writeUInt32BE(zlib.crc32(ihdr.subarray(4, 21)), 21)
        const bomba = Buffer.concat([PNG_REAL.subarray(0, 8), ihdr, PNG_REAL.subarray(33)])
        const r = await subir(bomba)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('IMAGE_TOO_LARGE')
        expect(fotosEnDisco()).toEqual([])
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('sin consentimiento responde 422 CONSENT_REQUIRED; sin archivo, FILE_REQUIRED', async () => {
        for (const consentimiento of [null, 'false', 'si']) {
            const r = await subir(PNG_REAL, { consentimiento })
            expect(r.status).toBe(422)
            expect(r.body.code).toBe('CONSENT_REQUIRED')
        }
        const sinArchivo = await request(app).put('/api/v1/me/photo').set('Authorization', SESION).field('consentimiento', 'true')
        expect(sinArchivo.status).toBe(422)
        expect(sinArchivo.body.code).toBe('FILE_REQUIRED')
        expect(fotosEnDisco()).toEqual([])
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('si otra pestaña cambia la foto a la vez, reintenta; si no lo logra, 409 y no deja el archivo', async () => {
        m.participante.updateMany.mockResolvedValueOnce({ count: 0 })
        expect((await subir(PNG_REAL)).status).toBe(200)
        expect(m.participante.updateMany).toHaveBeenCalledTimes(2)

        fs.rmSync(DIRECTORIO_FOTOS, { recursive: true, force: true })
        m.participante.updateMany.mockResolvedValue({ count: 0 })
        const r = await subir(PNG_REAL)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PHOTO_CONFLICT')
        expect(fotosEnDisco()).toEqual([])
    })

    it('GET /me/photo entrega la imagen sin caché; 404 si no tiene', async () => {
        const nombre = nuevoNombreFoto('png')
        fs.mkdirSync(DIRECTORIO_FOTOS, { recursive: true })
        fs.writeFileSync(path.join(DIRECTORIO_FOTOS, nombre), PNG_REAL)
        m.participante.findUnique.mockResolvedValue(participante({ fotoArchivo: nombre }))
        const r = await request(app).get('/api/v1/me/photo').set('Authorization', SESION).buffer(true)
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('image/png')
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(Buffer.from(r.body).equals(PNG_REAL)).toBe(true)

        m.participante.findUnique.mockResolvedValue(participante())
        const sin = await request(app).get('/api/v1/me/photo').set('Authorization', SESION)
        expect(sin.status).toBe(404)
        expect(sin.body.code).toBe('PHOTO_NOT_FOUND')

        // Nombre fuera del formato del servidor o archivo que ya no está
        for (const fotoArchivo of ['../../.env', nuevoNombreFoto('jpg')]) {
            m.participante.findUnique.mockResolvedValue(participante({ fotoArchivo }))
            expect((await request(app).get('/api/v1/me/photo').set('Authorization', SESION)).status).toBe(404)
        }
    })

    it('DELETE /me/photo la quita de la BD y del disco (idempotente)', async () => {
        const nombre = nuevoNombreFoto('jpg')
        fs.mkdirSync(DIRECTORIO_FOTOS, { recursive: true })
        fs.writeFileSync(path.join(DIRECTORIO_FOTOS, nombre), 'foto')
        m.participante.findUnique.mockResolvedValue(participante({ fotoArchivo: nombre, fotoActualizadaEn: new Date() }))
        const r = await request(app).delete('/api/v1/me/photo').set('Authorization', SESION)
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ foto: { tiene: false } })
        expect(m.participante.updateMany).toHaveBeenCalledWith({ where: { id: 50, fotoArchivo: nombre }, data: { fotoArchivo: null, fotoActualizadaEn: null } })
        expect(fotosEnDisco()).toEqual([])

        m.participante.findUnique.mockResolvedValue(participante())
        m.participante.updateMany.mockClear()
        const otra = await request(app).delete('/api/v1/me/photo').set('Authorization', SESION)
        expect(otra.body.data).toEqual({ foto: { tiene: false } })
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })

    it('un token de staff no entra a ninguna ruta de foto ni de perfil (403)', async () => {
        const admin = `Bearer ${tokenDeRol('SUPERADMIN')}`
        expect((await subir(PNG_REAL, { token: admin })).status).toBe(403)
        expect((await request(app).get('/api/v1/me/photo').set('Authorization', admin)).status).toBe(403)
        expect((await request(app).delete('/api/v1/me/photo').set('Authorization', admin)).status).toBe(403)
        expect((await request(app).patch('/api/v1/me/profile').set('Authorization', admin).send({ celular: '987654321' })).status).toBe(403)
        expect((await request(app).put('/api/v1/me/photo').attach('file', PNG_REAL, 'foto.png')).status).toBe(401)
        expect(fotosEnDisco()).toEqual([])
        expect(m.participante.updateMany).not.toHaveBeenCalled()
    })
})

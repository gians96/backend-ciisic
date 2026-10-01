import fs from 'fs'
import path from 'path'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_FOTOS, nuevoNombreFoto } from '../../src/core/almacenamiento'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/** `GET /v1/inscriptions/:id/photo`: foto del participante para el escáner de asistencia (spec 014). */
jest.mock('../../src/database/prisma', () => ({ prisma: { inscripcion: { findUnique: jest.fn() } } }))

const m = prisma as unknown as { inscripcion: { findUnique: jest.Mock } }

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen de prueba')])
const archivo = nuevoNombreFoto('png')

/** Inscripción 5 del evento 2; su participante tiene `fotoArchivo`. */
let fotoArchivo: string | null = archivo

const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const pedir = (token: string, id = 5) => request(app).get(`/api/v1/inscriptions/${id}/photo`).set(con(token))

beforeAll(() => {
    fs.mkdirSync(DIRECTORIO_FOTOS, { recursive: true })
    fs.writeFileSync(path.join(DIRECTORIO_FOTOS, archivo), PNG)
})

beforeEach(() => {
    jest.clearAllMocks()
    fotoArchivo = archivo
    m.inscripcion.findUnique.mockImplementation(({ where, select }) => {
        if (where.id !== 5) return Promise.resolve(null)
        // El resolutor de la guarda pide el evento; el servicio, la foto del participante
        return Promise.resolve(select?.eventoId ? { eventoId: 2 } : { participante: { fotoArchivo } })
    })
})

describe('foto de la inscripción', () => {
    it('la Comisión del evento con «asistencia.marcar» la ve, sin caché', async () => {
        const r = await pedir(tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] }))
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('image/png')
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(Buffer.from(r.body).equals(PNG)).toBe(true)
    })

    it('también con «inscripciones.ver» (Tesorero del evento) y las cuentas globales', async () => {
        expect((await pedir(tokenDeRol('TESORERO', 30, { eventoIds: [2] }))).status).toBe(200)
        expect((await pedir(tokenDeRol('ADMIN'))).status).toBe(200)
    })

    it('una cuenta de otro evento recibe 403 EVENT_NOT_ASSIGNED', async () => {
        for (const token of [
            tokenDeRol('COMISION', 41, { eventoIds: [3], permisos: ['asistencia.marcar'] }),
            tokenDeRol('TESORERO', 31, { eventoIds: [3] }),
        ]) {
            const r = await pedir(token)
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
        }
    })

    it('sin «asistencia.marcar» ni «inscripciones.ver» responde 403 FORBIDDEN', async () => {
        const r = await pedir(tokenDeRol('COMISION', 42, { eventoIds: [2], permisos: ['ponencias.ver'] }))
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
    })

    it('un participante o una solicitud sin sesión no la ven', async () => {
        expect((await pedir(tokenDeParticipante(50))).status).toBe(403)
        expect((await request(app).get('/api/v1/inscriptions/5/photo')).status).toBe(401)
    })

    it('sin foto, con un nombre que no generó el servidor o con el archivo borrado responde 404 PHOTO_NOT_FOUND', async () => {
        const admin = tokenDeRol('ADMIN')
        for (const valor of [null, '../../.env', nuevoNombreFoto('jpg')]) {
            fotoArchivo = valor
            const r = await pedir(admin)
            expect(r.status).toBe(404)
            expect(r.body.code).toBe('PHOTO_NOT_FOUND')
        }
    })

    it('una inscripción inexistente responde 404', async () => {
        const global = await pedir(tokenDeRol('ADMIN'), 6)
        expect(global.status).toBe(404)
        expect(global.body.code).toBe('INSCRIPTION_NOT_FOUND')
        const porEvento = await pedir(tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] }), 6)
        expect(porEvento.status).toBe(404)
    })
})

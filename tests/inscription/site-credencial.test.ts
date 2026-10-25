import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { registroDeToken, TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findFirst: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    inscripcion: { findFirst: Mock }
    tokenAcceso: { findUnique: Mock, update: Mock }
}

const evento = {
    id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', estado: 'PUBLICADO', esPrincipal: true,
    fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'),
}
const fila = {
    codigoCredencial: 'K7Q2M9X4TB',
    participante: { nombres: 'Ana', apellidos: 'Pérez' },
    tipoInscripcion: { nombre: 'General', etiqueta: 'CON KIT' },
    clasificacion: null,
    evento: { nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' },
}

const credencial = (codigo: string) => request(app).get(`/api/v1/site/credential/${codigo}`).set('X-Api-Key', TOKEN_SITIO)

beforeEach(() => {
    jest.clearAllMocks()
    m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken(evento))
    m.inscripcion.findFirst.mockResolvedValue(fila)
})

describe('credencial por código para la landing (spec 020)', () => {
    it('devuelve solo lo que se imprime en la credencial, sin caché', async () => {
        const r = await credencial('K7Q2M9X4TB')
        expect(r.status).toBe(200)
        expect(r.body).toEqual({
            success: true,
            data: {
                nombres: 'Ana', apellidos: 'Pérez', codigo: 'K7Q2M9X4TB', clasificacion: null,
                tipo: { nombre: 'General', etiqueta: 'CON KIT' },
                evento: { nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026' },
            },
        })
        expect(r.headers['cache-control']).toBe('no-store')
        const texto = JSON.stringify(r.body)
        for (const privado of ['correo', 'documento', 'celular', 'numeroOperacion']) expect(texto).not.toContain(privado)
    })

    it('busca solo entre APROBADAS y del evento del token (el evento no viene del enlace)', async () => {
        await credencial('K7Q2M9X4TB')
        expect(m.inscripcion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { codigoCredencial: 'K7Q2M9X4TB', eventoId: 2, estado: { codigo: 'APROBADO' } },
        }))
    })

    it('sin clasificación la devuelve en null y sin tipo también', async () => {
        m.inscripcion.findFirst.mockResolvedValue({ ...fila, tipoInscripcion: null, clasificacion: { nombre: 'Estudiante UNDC' } })
        const r = await credencial('K7Q2M9X4TB')
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ clasificacion: 'Estudiante UNDC', tipo: null })
    })

    it.each([
        ['minusculas', 'k7q2m9x4tb'],
        ['con guion', 'K7Q2M9X4T-B'],
        ['muy corto', 'K7Q2M9'],
        ['mucho largo', 'K7Q2M9X4TBB'],
    ])('un código mal formado responde 422 INVALID_CODE sin consultar la BD (%s)', async (_caso, codigo) => {
        const r = await credencial(codigo)
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ success: false, code: 'INVALID_CODE' })
        expect(m.inscripcion.findFirst).not.toHaveBeenCalled()
    })

    it('inexistente o de otro evento responde 404 CREDENTIAL_NOT_FOUND', async () => {
        m.inscripcion.findFirst.mockResolvedValue(null)
        const r = await credencial('ZZZZZZZZZZ')
        expect(r.status).toBe(404)
        expect(r.body).toMatchObject({ success: false, code: 'CREDENTIAL_NOT_FOUND' })
    })

    it('exige el token del evento', async () => {
        const r = await request(app).get('/api/v1/site/credential/K7Q2M9X4TB')
        expect(r.status).toBe(401)
        expect(r.body).toMatchObject({ success: false, code: 'EVENT_TOKEN_REQUIRED' })
        expect(m.inscripcion.findFirst).not.toHaveBeenCalled()
    })

    it('con el token de otro evento el código no sirve (el evento sale del token)', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue(registroDeToken({ ...evento, id: 3, codigo: 'otro-2026' }))
        await credencial('K7Q2M9X4TB')
        expect(m.inscripcion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { codigoCredencial: 'K7Q2M9X4TB', eventoId: 3, estado: { codigo: 'APROBADO' } },
        }))
    })
})

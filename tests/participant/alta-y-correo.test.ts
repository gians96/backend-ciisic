import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { HttpError } from '../../src/core/http-error'
import { consultarDni } from '../../src/api/document-lookup/services/lookup'
import { enviarAvisoCambioCorreo } from '../../src/api/inscription/utils/sendEmail'
import { tokenDeRol } from '../helpers/tokens'

/** Alta de participantes desde el panel y aviso al cambiar el correo (spec 014). */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        participante: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { findFirst: jest.fn() },
    },
}))
jest.mock('../../src/api/document-lookup/services/lookup', () => ({
    ...jest.requireActual('../../src/api/document-lookup/services/lookup'),
    consultarDni: jest.fn(),
}))
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/sendEmail'),
    enDiferido: jest.fn((_descripcion: string, tarea: () => Promise<unknown>) => {
        void tarea()
    }),
    enviarAvisoCambioCorreo: jest.fn(async () => true),
}))

type Mock = jest.Mock
const m = prisma as unknown as { participante: { findUnique: Mock, create: Mock, update: Mock }, inscripcion: { findFirst: Mock } }
const consulta = consultarDni as Mock
const aviso = enviarAvisoCambioCorreo as Mock

const admin = () => ({ Authorization: `Bearer ${tokenDeRol('ADMIN')}` })
const ahora = new Date('2026-10-01T15:00:00Z')

function participante(cambios: Record<string, unknown> = {}) {
    return {
        id: 7, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '999888777',
        googleSub: 'g-ana', googleVinculadoEn: ahora, fotoArchivo: null, fotoActualizadaEn: null, creadoEn: ahora, actualizadoEn: ahora, ...cambios,
    }
}

const alta = (cuerpo: Record<string, unknown>) => request(app).post('/api/v1/participants').set(admin()).send(cuerpo)
const BASE = { tipoDocumento: 'dni', numeroDocumento: '44556677', correo: 'Ponente@Gmail.com' }

beforeEach(() => {
    jest.clearAllMocks()
    m.participante.findUnique.mockResolvedValue(null)
    m.participante.create.mockImplementation(({ data }) => Promise.resolve(participante({ id: 31, googleSub: null, googleVinculadoEn: null, ...data })))
    consulta.mockResolvedValue({ numero: '44556677', nombres: 'LUIS ALBERTO', apellidoPaterno: 'QUISPE', apellidoMaterno: 'MAMANI', fuente: 'PROVEEDOR', proveedor: 'DECOLECTA' })
})

describe('POST /v1/participants', () => {
    it('con DNI toma los nombres de la consulta DNI del panel y responde como el detalle', async () => {
        const r = await alta({ ...BASE, nombres: 'Luis', apellidos: 'Quispe', celular: '911222333' })
        expect(r.status).toBe(201)
        expect(consulta).toHaveBeenCalledWith('44556677', 'PANEL')
        expect(m.participante.create.mock.calls[0][0].data).toEqual({
            tipoDocumentoId: 'dni', numeroDocumento: '44556677', nombres: 'LUIS ALBERTO', apellidos: 'QUISPE MAMANI', correo: 'ponente@gmail.com', celular: '911222333',
        })
        expect(r.body).toEqual({
            success: true,
            data: {
                id: 31, tipoDocumento: 'dni', numeroDocumento: '44556677', nombres: 'LUIS ALBERTO', apellidos: 'QUISPE MAMANI', correo: 'ponente@gmail.com',
                celular: '911222333', googleVinculado: false, googleVinculadoEn: null, creadoEn: ahora.toISOString(), actualizadoEn: ahora.toISOString(), inscripciones: [],
            },
        })
    })

    it('si la consulta DNI falla usa los nombres enviados; el celular es opcional', async () => {
        consulta.mockRejectedValue(new HttpError(503, 'LOOKUP_UNAVAILABLE', 'No disponible'))
        const r = await alta({ ...BASE, nombres: 'Luis', apellidos: 'Quispe' })
        expect(r.status).toBe(201)
        expect(m.participante.create.mock.calls[0][0].data).toMatchObject({ nombres: 'Luis', apellidos: 'Quispe', celular: '' })
    })

    it('si la consulta DNI falla y faltan los nombres responde 422 NAMES_REQUIRED', async () => {
        for (const error of [new HttpError(503, 'LOOKUP_UNAVAILABLE', 'x'), new HttpError(404, 'DOCUMENT_NOT_FOUND', 'x')]) {
            consulta.mockRejectedValueOnce(error)
            const r = await alta({ ...BASE, nombres: 'Luis' })
            expect(r.status).toBe(422)
            expect(r.body).toMatchObject({ code: 'NAMES_REQUIRED', fields: { apellidos: expect.any(String) } })
        }
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('con carné de extranjería no consulta: los nombres son obligatorios', async () => {
        const sinNombres = await alta({ tipoDocumento: 'ce', numeroDocumento: 'X12345678', correo: 'ce@gmail.com' })
        expect(sinNombres.status).toBe(422)
        expect(sinNombres.body.code).toBe('NAMES_REQUIRED')
        const conNombres = await alta({ tipoDocumento: 'ce', numeroDocumento: 'X12345678', correo: 'ce@gmail.com', nombres: 'John', apellidos: 'Smith' })
        expect(conNombres.status).toBe(201)
        expect(consulta).not.toHaveBeenCalled()
    })

    it('documento ya registrado: 409 PARTICIPANT_EXISTS con el id, sin gastar una consulta DNI', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.tipoDocumentoId_numeroDocumento ? { id: 7 } : null))
        const r = await alta(BASE)
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ success: false, code: 'PARTICIPANT_EXISTS', fields: { id: '7' } })
        expect(consulta).not.toHaveBeenCalled()
    })

    it('correo de otra persona: 409 EMAIL_IN_USE (también si gana otra alta a la vez)', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.correo === 'ponente@gmail.com' ? { id: 8 } : null))
        const r = await alta(BASE)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EMAIL_IN_USE')

        m.participante.findUnique.mockResolvedValue(null)
        m.participante.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_participantes_correo' } }))
        const carrera = await alta(BASE)
        expect(carrera.status).toBe(409)
        expect(carrera.body.code).toBe('EMAIL_IN_USE')
    })

    it('si otra alta con el mismo documento gana la carrera, 409 PARTICIPANT_EXISTS con su id', async () => {
        m.participante.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ id: 12 })
        m.participante.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_participantes_documento' } }))
        const r = await alta(BASE)
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ code: 'PARTICIPANT_EXISTS', fields: { id: '12' } })
    })

    it('valida el cuerpo: correo obligatorio y documento con formato', async () => {
        const sinCorreo = await alta({ tipoDocumento: 'dni', numeroDocumento: '44556677' })
        expect(sinCorreo.status).toBe(422)
        expect(sinCorreo.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { correo: expect.any(String) } })
        const dniMalo = await alta({ ...BASE, numeroDocumento: '123' })
        expect(dniMalo.status).toBe(422)
        expect(dniMalo.body.fields).toHaveProperty('numeroDocumento')
        expect(m.participante.findUnique).not.toHaveBeenCalled()
    })
})

describe('PUT /v1/participants/:id con otro correo', () => {
    const editar = (cuerpo: Record<string, unknown>) => request(app).put('/api/v1/participants/7').set(admin()).send(cuerpo)

    beforeEach(() => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 7 ? participante() : null))
        m.participante.update.mockImplementation(({ data }) => Promise.resolve(participante(data)))
        m.inscripcion.findFirst.mockResolvedValue({ evento: { nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', correoContacto: null, remitenteNombre: null, credencialCorreoId: 3, fechaInicio: ahora } })
    })

    it('deshace Google, avisa al correo anterior con el nuevo enmascarado y registra solo ids', async () => {
        const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
        const r = await editar({ correo: 'Nuevo@Gmail.com' })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ correo: 'nuevo@gmail.com', googleVinculado: false })
        expect(m.participante.update.mock.calls[0][0].data).toMatchObject({ correo: 'nuevo@gmail.com', googleSub: null, googleVinculadoEn: null })

        expect(aviso).toHaveBeenCalledTimes(1)
        expect(aviso.mock.calls[0][0]).toEqual({
            nombres: 'Ana', correoAnterior: 'ana@gmail.com', correoNuevo: 'n***@g***.com', evento: expect.objectContaining({ nombreCorto: 'VIII CIISIC 2026', credencialCorreoId: 3 }),
        })
        expect(m.inscripcion.findFirst.mock.calls[0][0]).toMatchObject({ where: { participanteId: 7 }, orderBy: { id: 'desc' } })

        // Auditoría: ids de la cuenta (ADMIN = 2) y del participante, sin correos ni nombres
        expect(info).toHaveBeenCalledTimes(1)
        const linea = String(info.mock.calls[0][0])
        expect(linea).toContain('cuenta 2')
        expect(linea).toContain('participante 7')
        expect(linea).not.toMatch(/@|Ana/)
        info.mockRestore()
    })

    it('el mismo correo con otras mayúsculas o un cambio solo del celular no avisan', async () => {
        const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
        expect((await editar({ correo: 'ANA@gmail.com' })).status).toBe(200)
        expect((await editar({ celular: '911222333' })).status).toBe(200)
        expect(aviso).not.toHaveBeenCalled()
        expect(info).not.toHaveBeenCalled()
        for (const [{ data }] of m.participante.update.mock.calls) expect(data).not.toHaveProperty('googleSub')
        info.mockRestore()
    })

    it('el correo de otra persona responde 409 EMAIL_IN_USE sin cambiar ni avisar', async () => {
        m.participante.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 7 ? participante() : { id: 9 }))
        const r = await editar({ correo: 'otra@gmail.com' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EMAIL_IN_USE')
        expect(m.participante.update).not.toHaveBeenCalled()
        expect(aviso).not.toHaveBeenCalled()
    })

    it('si otra edición toma el correo a la vez, 409 EMAIL_IN_USE', async () => {
        m.participante.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_participantes_correo' } }))
        const r = await editar({ correo: 'nuevo@gmail.com' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EMAIL_IN_USE')
        expect(aviso).not.toHaveBeenCalled()
    })

    it('un participante inexistente responde 404', async () => {
        const r = await request(app).put('/api/v1/participants/99').set(admin()).send({ correo: 'x@gmail.com' })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('PARTICIPANT_NOT_FOUND')
    })

    it('el formulario completo del panel con el celular vacío (alta sin celular) se guarda sin tocar el celular', async () => {
        // El panel en producción envía `{...form}`: con `celular: ''` respondía 422 «Celular inválido»
        const r = await editar({ nombres: 'Ana María', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '' })
        expect(r.status).toBe(200)
        expect(m.participante.update.mock.calls[0][0].data).toEqual({ nombres: 'Ana María', apellidos: 'Pérez', correo: 'ana@gmail.com' })
        // Un celular con formato inválido sigue siendo 422
        const malo = await editar({ celular: '12ab' })
        expect(malo.status).toBe(422)
        expect(malo.body.fields).toHaveProperty('celular')
    })
})

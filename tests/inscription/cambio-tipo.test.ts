import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { borrarCredenciales } from '../../src/api/inscription/utils/generatePdf'
import { etiquetaDeTipo } from '../../src/api/inscription/services/cambio-tipo'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => {
    const tx = {
        inscripcion: { updateMany: jest.fn() },
        cambioTipoInscripcion: { create: jest.fn() },
        inscripcionPonencia: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
        ponenciaEspecializada: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
    }
    return {
        prisma: {
            inscripcion: { findUnique: jest.fn() },
            tipoInscripcion: { findFirst: jest.fn() },
            cambioTipoInscripcion: { findMany: jest.fn() },
            evento: { findUnique: jest.fn(), findFirst: jest.fn() },
            $transaction: jest.fn(async (fn: (cliente: unknown) => unknown) => fn(tx)),
            __tx: tx,
        },
    }
})

// Los PDF de credencial no se tocan en disco
jest.mock('../../src/api/inscription/utils/generatePdf', () => ({
    ...jest.requireActual('../../src/api/inscription/utils/generatePdf'),
    borrarCredenciales: jest.fn(),
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    inscripcion: { findUnique: Mock }
    tipoInscripcion: { findFirst: Mock }
    cambioTipoInscripcion: { findMany: Mock }
    $transaction: Mock
    __tx: {
        inscripcion: { updateMany: Mock }
        cambioTipoInscripcion: { create: Mock }
        inscripcionPonencia: { findMany: Mock, updateMany: Mock, count: Mock }
        ponenciaEspecializada: { findMany: Mock }
        $queryRaw: Mock
    }
}
const tx = m.__tx
const borrar = borrarCredenciales as Mock

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', esPrincipal: true, estado: 'PUBLICADO' }

const categoriaGeneral = { id: 3, codigo: 'PROFESIONALES', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', esEstudiantil: false, delegacionId: null }
const categoriaDocentes = { id: 4, codigo: 'DOCENTES', nombre: 'Docente, egresados y administrativos de la Facultad Ingeniería UNDC', esEstudiantil: false, delegacionId: null }

/** Tipo tal como lo devuelve Prisma con su categoría. */
function tipo(cambios: Record<string, unknown> = {}) {
    return {
        id: 7, categoriaId: 3, codigo: 'general_con_kit', nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', etiqueta: 'CON KIT', precio: new Prisma.Decimal(140),
        precioInstitucional: new Prisma.Decimal(120), modalidad: 'PRESENCIAL', categoria: categoriaGeneral, ...cambios,
    }
}

const tipoDocentes = () => tipo({ id: 9, categoriaId: 4, codigo: 'docentes_con_kit', nombre: categoriaDocentes.nombre, precio: new Prisma.Decimal(120), categoria: categoriaDocentes })
const tipoVirtual = () => tipo({ id: 11, codigo: 'general_virtual', etiqueta: 'VIRTUAL', precio: new Prisma.Decimal(50), precioInstitucional: new Prisma.Decimal(50), modalidad: 'VIRTUAL' })

function inscripcion(cambios: Record<string, unknown> = {}) {
    return {
        id: 5, eventoId: 2, participanteId: 50, delegacionId: null, tipoInscripcionId: 7, clasificacionId: null, estadoId: 2,
        creadoEn: new Date('2026-10-01T17:18:00Z'), actualizadoEn: new Date('2026-10-01T17:18:00Z'),
        banco: null, billeteraDigital: 'yape', tipoOperacion: null, modalidadPago: 'billetera', numeroOperacion: '13960309',
        monto: new Prisma.Decimal(120), descuento: new Prisma.Decimal(20), tieneDescuento: true, fechaPago: new Date('2026-10-01T00:00:00Z'),
        voucherArchivo: 'voucher-5.png', esCorreoInstitucional: true, motivoRechazo: null, revisadoPorId: null, revisadoEn: new Date('2026-10-01T18:00:00Z'),
        credencialEnviadaEn: null, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        evento,
        participante: { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '02442123', nombres: 'Jair', apellidos: 'Ferreyros', correo: 'jferreyros@undc.edu.pe', celular: '951881199' },
        tipoInscripcion: tipo(),
        clasificacion: null,
        estado: { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' },
        revisadoPor: null,
        delegacion: null,
        ...cambios,
    }
}

const owner = () => ({ Authorization: `Bearer ${tokenDeRol('SUPERADMIN', 1)}` })
const cambiar = (cuerpo: Record<string, unknown> = { tipoInscripcionId: 9 }, cabeceras = owner()) => request(app).patch('/api/v1/inscriptions/5/type').set(cabeceras).send(cuerpo)

beforeEach(() => {
    jest.clearAllMocks()
    m.$transaction.mockImplementation(async (fn: (cliente: unknown) => unknown) => fn(tx))
    // Primera lectura: la inscripción como está; la segunda (tras guardar): ya con el tipo nuevo
    m.inscripcion.findUnique.mockReset()
    m.inscripcion.findUnique.mockResolvedValueOnce(inscripcion()).mockResolvedValue(inscripcion({ tipoInscripcionId: 9, tipoInscripcion: tipoDocentes(), descuento: new Prisma.Decimal(0), tieneDescuento: false }))
    m.tipoInscripcion.findFirst.mockResolvedValue(tipoDocentes())
    m.cambioTipoInscripcion.findMany.mockResolvedValue([])
    tx.inscripcion.updateMany.mockResolvedValue({ count: 1 })
    tx.cambioTipoInscripcion.create.mockResolvedValue({ id: 1 })
    tx.inscripcionPonencia.findMany.mockResolvedValue([])
    tx.inscripcionPonencia.updateMany.mockResolvedValue({ count: 0 })
    tx.inscripcionPonencia.count.mockResolvedValue(0)
    tx.ponenciaEspecializada.findMany.mockResolvedValue([])
    tx.$queryRaw.mockResolvedValue([])
})

describe('quién puede cambiar el tipo (spec 035)', () => {
    it('el Owner lo cambia', async () => {
        const r = await cambiar()
        expect(r.status).toBe(200)
        expect(r.body.success).toBe(true)
        expect(r.body.data.tipoInscripcion).toMatchObject({ id: 9, categoria: { id: 4 } })
        expect(tx.inscripcion.updateMany).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['el Administrador del sistema', () => tokenDeRol('ADMIN', 2)],
        ['el Tesorero', () => tokenDeRol('TESORERO', 30, { eventoIds: [2] })],
        ['la Comisión', () => tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })],
    ])('%s recibe 403 y no se toca nada', async (_quien, token) => {
        const r = await cambiar({ tipoInscripcionId: 9 }, { Authorization: `Bearer ${token()}` })
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('FORBIDDEN')
        expect(m.inscripcion.findUnique).not.toHaveBeenCalled()
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('sin sesión es 401', async () => {
        const r = await request(app).patch('/api/v1/inscriptions/5/type').send({ tipoInscripcionId: 9 })
        expect(r.status).toBe(401)
    })
})

describe('validación del cuerpo', () => {
    it.each([
        ['sin tipo', {}],
        ['tipo que no es número', { tipoInscripcionId: 'abc' }],
        ['tipo cero', { tipoInscripcionId: 0 }],
        ['tipo decimal', { tipoInscripcionId: 1.5 }],
        ['motivo de más de 500 caracteres', { tipoInscripcionId: 9, motivo: 'x'.repeat(501) }],
    ])('%s es 422 y no lee la inscripción', async (_caso, cuerpo) => {
        const r = await cambiar(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(m.inscripcion.findUnique).not.toHaveBeenCalled()
    })

    it('un id de inscripción inválido es 400', async () => {
        const r = await request(app).patch('/api/v1/inscriptions/abc/type').set(owner()).send({ tipoInscripcionId: 9 })
        expect(r.status).toBe(400)
    })
})

describe('el cambio', () => {
    it('mueve a la persona al tipo nuevo, conserva lo pagado y quita el descuento que ya no corresponde', async () => {
        // Pagó S/ 120 con el descuento de su correo institucional (lista 140); el tipo nuevo cuesta S/ 120
        const r = await cambiar({ tipoInscripcionId: 9, motivo: '  Es docente de la facultad  ' })
        expect(r.status).toBe(200)
        expect(tx.inscripcion.updateMany).toHaveBeenCalledWith({
            where: { id: 5, tipoInscripcionId: 7, delegacionId: null },
            data: { tipoInscripcionId: 9, descuento: 0, tieneDescuento: false },
        })
        // El monto no se toca: es lo que dice el voucher
        expect(tx.inscripcion.updateMany.mock.calls[0][0].data).not.toHaveProperty('monto')
        expect(r.body.data.pago).toMatchObject({ monto: 120, descuento: 0, tieneDescuento: false })
        expect(r.body.data.ponenciasActualizadas).toBe(0)
    })

    it('deja el historial con el texto de los dos tipos, el motivo y quién lo hizo', async () => {
        await cambiar({ tipoInscripcionId: 9, motivo: '  Es docente de la facultad  ' })
        expect(tx.cambioTipoInscripcion.create).toHaveBeenCalledWith({
            data: {
                inscripcionId: 5,
                anterior: 'PROFESIONALES Y PUBLICO EN GENERAL · CON KIT',
                nuevo: 'Docente, egresados y administrativos de la Facultad Ingeniería UNDC · CON KIT',
                motivo: 'Es docente de la facultad',
                realizadoPorId: 1,
            },
        })
    })

    it('sin motivo guarda null', async () => {
        await cambiar({ tipoInscripcionId: 9, motivo: '   ' })
        expect(tx.cambioTipoInscripcion.create.mock.calls[0][0].data.motivo).toBeNull()
    })

    it('el cambio y su historial van en una sola transacción', async () => {
        await cambiar()
        expect(m.$transaction).toHaveBeenCalledTimes(1)
    })

    it('descarta los PDF de credencial guardados: llevan el tipo', async () => {
        await cambiar()
        expect(borrar).toHaveBeenCalledWith(5)
    })

    it('el descuento se recalcula contra el precio de lista del tipo nuevo', async () => {
        // Pagó S/ 120; el tipo nuevo cuesta S/ 140 (y 120 con correo institucional): sigue siendo un descuento de S/ 20
        m.tipoInscripcion.findFirst.mockResolvedValue(tipo({ id: 12, codigo: 'otro', nombre: 'OTRO', etiqueta: null, precio: new Prisma.Decimal(140) }))
        await cambiar({ tipoInscripcionId: 12 })
        expect(tx.inscripcion.updateMany.mock.calls[0][0].data).toEqual({ tipoInscripcionId: 12, descuento: 20, tieneDescuento: true })
    })

    it('pagar de más no es un descuento', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ monto: new Prisma.Decimal(140), descuento: new Prisma.Decimal(0), tieneDescuento: false }))
        await cambiar()
        expect(tx.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ descuento: 0, tieneDescuento: false })
    })

    it('una cortesía nunca tiene descuento aunque el tipo cueste más', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ modalidadPago: 'cortesia', monto: new Prisma.Decimal(0), descuento: new Prisma.Decimal(0), tieneDescuento: false }))
        await cambiar()
        expect(tx.inscripcion.updateMany.mock.calls[0][0].data).toEqual({ tipoInscripcionId: 9, descuento: 0, tieneDescuento: false })
    })

    it('una cortesía sin tipo recibe uno y el historial dice «Sin tipo»', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ modalidadPago: 'cortesia', tipoInscripcionId: null, tipoInscripcion: null, monto: new Prisma.Decimal(0), descuento: new Prisma.Decimal(0), tieneDescuento: false }))
        const r = await cambiar()
        expect(r.status).toBe(200)
        expect(tx.inscripcion.updateMany.mock.calls[0][0].where).toEqual({ id: 5, tipoInscripcionId: null, delegacionId: null })
        expect(tx.cambioTipoInscripcion.create.mock.calls[0][0].data.anterior).toBe('Sin tipo')
    })

    it('se puede pasar a un tipo inactivo (es una corrección deliberada)', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue({ ...tipoDocentes(), activo: false })
        const r = await cambiar()
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.findFirst.mock.calls[0][0].where).not.toHaveProperty('activo')
    })

    it.each(['PENDIENTE', 'EN_REVISION', 'RECHAZADO', 'CANCELADO'])('también en una inscripción %s', async (codigo) => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ estado: { id: 1, codigo, nombre: codigo } }))
        const r = await cambiar()
        expect(r.status).toBe(200)
    })
})

describe('lo que no se puede cambiar', () => {
    it('el mismo tipo es 409 TYPE_UNCHANGED', async () => {
        const r = await cambiar({ tipoInscripcionId: 7 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('TYPE_UNCHANGED')
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('un tipo inexistente, de otro evento o de una delegación es 422 REGISTRATION_TYPE_INVALID', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue(null)
        const r = await cambiar({ tipoInscripcionId: 999 })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('REGISTRATION_TYPE_INVALID')
        // La búsqueda exige el mismo evento y una categoría que no sea de delegación
        expect(m.tipoInscripcion.findFirst.mock.calls[0][0].where).toEqual({ id: 999, categoria: { eventoId: 2, delegacionId: null } })
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('una inscripción de una delegación es 409 INSCRIPTION_IN_DELEGATION', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ delegacionId: 8 }))
        const r = await cambiar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INSCRIPTION_IN_DELEGATION')
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('una inscripción con el tipo de un plan de delegación tampoco se mueve aquí', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ tipoInscripcion: tipo({ categoria: { ...categoriaGeneral, delegacionId: 8 } }) }))
        const r = await cambiar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INSCRIPTION_IN_DELEGATION')
    })

    it('una inscripción inexistente es 404', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(null)
        const r = await cambiar()
        expect(r.status).toBe(404)
        expect(m.$transaction).not.toHaveBeenCalled()
    })

    it('si otra petición cambió la inscripción mientras tanto, es 409 y no queda historial', async () => {
        tx.inscripcion.updateMany.mockResolvedValue({ count: 0 })
        const r = await cambiar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INSCRIPTION_CHANGED')
        expect(tx.cambioTipoInscripcion.create).not.toHaveBeenCalled()
        expect(borrar).not.toHaveBeenCalled()
    })
})

describe('ponencias especializadas al cambiar la modalidad de asistencia', () => {
    const pendientes = [{ id: 101, ponenciaId: 21 }, { id: 102, ponenciaId: 22 }]

    it('sin cambio de modalidad no se tocan las ponencias', async () => {
        await cambiar()
        expect(tx.inscripcionPonencia.findMany).not.toHaveBeenCalled()
        expect(tx.inscripcionPonencia.updateMany).not.toHaveBeenCalled()
    })

    it('de presencial a virtual, sus ponencias pendientes pasan a virtual y liberan el aforo', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue(tipoVirtual())
        tx.inscripcionPonencia.findMany.mockResolvedValue(pendientes)
        const r = await cambiar({ tipoInscripcionId: 11 })
        expect(r.status).toBe(200)
        expect(r.body.data.ponenciasActualizadas).toBe(2)
        // Solo las vigentes, sin asistencia, de su inscripción y que aún no terminan
        expect(tx.inscripcionPonencia.findMany.mock.calls[0][0].where).toEqual({
            inscripcionCongresoId: 5, estado: 'INSCRITO', asistioEn: null, modoAsistencia: { not: 'VIRTUAL' }, ponencia: { horaFin: { gt: expect.any(Date) } },
        })
        expect(tx.inscripcionPonencia.updateMany).toHaveBeenCalledWith({ where: { id: { in: [101, 102] } }, data: { modoAsistencia: 'VIRTUAL' } })
        // Pasar a virtual no pide cupo
        expect(tx.inscripcionPonencia.count).not.toHaveBeenCalled()
    })

    it('de virtual a presencial pide cupo en cada ponencia y, con lugar, las pasa a presencial', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ tipoInscripcionId: 11, tipoInscripcion: tipoVirtual() }))
        m.tipoInscripcion.findFirst.mockResolvedValue(tipo())
        tx.inscripcionPonencia.findMany.mockResolvedValue(pendientes)
        tx.ponenciaEspecializada.findMany.mockResolvedValue([{ id: 21, tema: 'IA', cupo: 20 }, { id: 22, tema: 'Cloud', cupo: null }])
        tx.inscripcionPonencia.count.mockResolvedValue(19)
        const r = await cambiar({ tipoInscripcionId: 7 })
        expect(r.status).toBe(200)
        expect(r.body.data.ponenciasActualizadas).toBe(2)
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
        expect(tx.inscripcionPonencia.updateMany).toHaveBeenCalledWith({ where: { id: { in: [101, 102] } }, data: { modoAsistencia: 'PRESENCIAL' } })
    })

    it('si una ponencia ya no tiene cupo presencial, es 409 TALK_FULL_ON_TYPE_CHANGE con su nombre y no se cambia nada', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion({ tipoInscripcionId: 11, tipoInscripcion: tipoVirtual() }))
        m.tipoInscripcion.findFirst.mockResolvedValue(tipo())
        tx.inscripcionPonencia.findMany.mockResolvedValue(pendientes)
        tx.ponenciaEspecializada.findMany.mockResolvedValue([{ id: 21, tema: 'IA', cupo: 20 }])
        tx.inscripcionPonencia.count.mockResolvedValue(20)
        const r = await cambiar({ tipoInscripcionId: 7 })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('TALK_FULL_ON_TYPE_CHANGE')
        expect(r.body.message).toContain('«IA»')
        expect(tx.inscripcionPonencia.updateMany).not.toHaveBeenCalled()
        // La transacción se aborta: no se borran los PDF
        expect(borrar).not.toHaveBeenCalled()
    })

    it('sin ponencias pendientes no hay nada que actualizar', async () => {
        m.tipoInscripcion.findFirst.mockResolvedValue(tipoVirtual())
        const r = await cambiar({ tipoInscripcionId: 11 })
        expect(r.status).toBe(200)
        expect(r.body.data.ponenciasActualizadas).toBe(0)
        expect(tx.inscripcionPonencia.updateMany).not.toHaveBeenCalled()
    })
})

describe('historial en el detalle', () => {
    it('el detalle trae las correcciones de la más reciente a la más antigua, con su autor', async () => {
        m.inscripcion.findUnique.mockReset()
        m.inscripcion.findUnique.mockResolvedValue(inscripcion())
        m.cambioTipoInscripcion.findMany.mockResolvedValue([
            { id: 8, creadoEn: new Date('2026-10-23T19:05:00Z'), anterior: 'A · CON KIT', nuevo: 'B · CON KIT', motivo: 'Es docente', realizadoPor: { id: 1, nombres: 'Gianmarcos', apellidos: 'Arias' } },
            { id: 2, creadoEn: new Date('2026-10-20T15:00:00Z'), anterior: 'Sin tipo', nuevo: 'A · CON KIT', motivo: null, realizadoPor: null },
        ])
        const r = await request(app).get('/api/v1/inscriptions/5').set(owner())
        expect(r.status).toBe(200)
        expect(r.body.data.cambiosTipo).toEqual([
            { id: 8, creadoEn: '2026-10-23T19:05:00.000Z', anterior: 'A · CON KIT', nuevo: 'B · CON KIT', motivo: 'Es docente', realizadoPor: { id: 1, nombres: 'Gianmarcos', apellidos: 'Arias' } },
            { id: 2, creadoEn: '2026-10-20T15:00:00.000Z', anterior: 'Sin tipo', nuevo: 'A · CON KIT', motivo: null, realizadoPor: null },
        ])
        expect(m.cambioTipoInscripcion.findMany.mock.calls[0][0]).toMatchObject({ where: { inscripcionId: 5 }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }] })
    })

    it('el detalle sin correcciones trae una lista vacía', async () => {
        const r = await request(app).get('/api/v1/inscriptions/5').set(owner())
        expect(r.body.data.cambiosTipo).toEqual([])
    })

    it('la respuesta del cambio también trae el historial', async () => {
        m.cambioTipoInscripcion.findMany.mockResolvedValue([{ id: 1, creadoEn: new Date('2026-10-23T19:05:00Z'), anterior: 'A', nuevo: 'B', motivo: null, realizadoPor: { id: 1, nombres: 'Test', apellidos: 'Owner' } }])
        const r = await cambiar()
        expect(r.body.data.cambiosTipo).toHaveLength(1)
    })
})

describe('etiquetaDeTipo', () => {
    const categoria = (nombre: string) => ({ nombre })

    it('sin tipo (cortesía) es «Sin tipo»', () => {
        expect(etiquetaDeTipo(null)).toBe('Sin tipo')
        expect(etiquetaDeTipo(undefined)).toBe('Sin tipo')
    })

    it('el nombre y la etiqueta, sin repetir la categoría cuando el tipo ya la nombra', () => {
        expect(etiquetaDeTipo({ nombre: 'PROFESIONALES Y PUBLICO EN GENERAL', etiqueta: 'CON KIT', categoria: categoria('PROFESIONALES Y PUBLICO EN GENERAL') })).toBe('PROFESIONALES Y PUBLICO EN GENERAL · CON KIT')
        expect(etiquetaDeTipo({ nombre: 'Estudiantes UNDC', etiqueta: null, categoria: categoria('ESTUDIANTES') })).toBe('Estudiantes UNDC')
    })

    it('agrega la categoría entre paréntesis si el tipo no la nombra', () => {
        expect(etiquetaDeTipo({ nombre: 'Con kit', etiqueta: 'PRESENCIAL', categoria: categoria('Público general') })).toBe('Con kit · PRESENCIAL (Público general)')
    })

    it('no pasa de 400 caracteres (el límite de la columna)', () => {
        expect(etiquetaDeTipo({ nombre: 'x'.repeat(500), etiqueta: null, categoria: categoria('y') })).toHaveLength(400)
    })
})

import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aCreada, aLegacy, type InscripcionDetalle } from '../../src/api/inscription/services/mappers'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn(), findFirst: jest.fn() },
        cambioTipoInscripcion: { findMany: jest.fn() },
    },
}))

const m = prisma as unknown as {
    inscripcion: { findUnique: jest.Mock, findMany: jest.Mock, count: jest.Mock }
    evento: { findUnique: jest.Mock, findFirst: jest.Mock }
    cambioTipoInscripcion: { findMany: jest.Mock }
}

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', esPrincipal: true, estado: 'PUBLICADO' }

function tipo(cambios: Record<string, unknown> = {}) {
    return {
        id: 14, codigo: 'estudiantes_virtual', nombre: 'ESTUDIANTES', etiqueta: 'VIRTUAL', precio: new Prisma.Decimal(30), precioInstitucional: new Prisma.Decimal(30),
        modalidad: 'VIRTUAL', categoria: { id: 3, codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES', esEstudiantil: true }, ...cambios,
    }
}

function inscripcion(cambios: Record<string, unknown> = {}) {
    return {
        id: 5, eventoId: 2, participanteId: 50, tipoInscripcionId: 14, clasificacionId: null, estadoId: 1,
        creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        banco: null, billeteraDigital: 'yape', tipoOperacion: null, modalidadPago: 'billetera', numeroOperacion: 'OP-777',
        monto: new Prisma.Decimal(30), descuento: new Prisma.Decimal(0), tieneDescuento: false, fechaPago: new Date('2026-09-19T00:00:00Z'),
        voucherArchivo: 'voucher-5.png', esCorreoInstitucional: false, motivoRechazo: null, revisadoPorId: null, revisadoEn: null,
        credencialEnviadaEn: null, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        evento,
        participante: { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321' },
        tipoInscripcion: tipo(),
        clasificacion: null,
        estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' },
        revisadoPor: null,
        ...cambios,
    }
}

const tesorero = () => ({ Authorization: `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}` })
const comision = () => ({ Authorization: `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver', 'inscripciones.exportar'] })}` })
const dondeDeLaLista = () => m.inscripcion.findMany.mock.calls[0][0].where

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 ? evento : null))
    m.inscripcion.findUnique.mockResolvedValue(inscripcion())
    m.inscripcion.findMany.mockResolvedValue([inscripcion()])
    m.inscripcion.count.mockResolvedValue(1)
    m.cambioTipoInscripcion.findMany.mockResolvedValue([])
})

describe('modalidad en la lista, el detalle y la creación (spec 018)', () => {
    it('la lista la trae dentro de tipoInscripcion, sin confundirla con la modalidad de pago', async () => {
        m.inscripcion.findMany.mockResolvedValue([
            inscripcion(),
            inscripcion({ id: 6, tipoInscripcion: tipo({ id: 8, etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL' }) }),
            inscripcion({ id: 7, tipoInscripcionId: null, tipoInscripcion: null }),
        ])
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(r.status).toBe(200)
        const [virtual, presencial, sinTipo] = r.body.data
        expect(virtual.tipoInscripcion).toEqual({ id: 14, nombre: 'ESTUDIANTES', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', incluyeKit: false, categoria: 'ESTUDIANTES' })
        expect(presencial.tipoInscripcion.modalidad).toBe('PRESENCIAL')
        expect(sinTipo.tipoInscripcion).toBeNull()
        // modalidadPago sigue siendo la de pago (banco, billetera, cortesía) y no hay `modalidad` en la raíz
        expect(virtual.modalidadPago).toBe('billetera')
        expect(virtual).not.toHaveProperty('modalidad')
    })

    it('el detalle la trae también sin «pagos.ver» (no es un dato de pago)', async () => {
        const conPagos = await request(app).get('/api/v1/inscriptions/5').set(tesorero())
        expect(conPagos.body.data.tipoInscripcion).toMatchObject({ modalidad: 'VIRTUAL', precio: 30 })
        expect(conPagos.body.data.pago.modalidad).toBe('billetera')
        const sinPagos = await request(app).get('/api/v1/inscriptions/5').set(comision())
        expect(sinPagos.body.data.tipoInscripcion).toMatchObject({ modalidad: 'VIRTUAL', precio: null, precioInstitucional: null })
        expect(sinPagos.body.data.pago.modalidad).toBeNull()
        expect(sinPagos.body.data).not.toHaveProperty('modalidad')
    })

    it('un tipo sin la columna (esquema anterior) o con un valor desconocido se lee PRESENCIAL', async () => {
        const { modalidad: _omitida, ...sinColumna } = tipo()
        void _omitida
        m.inscripcion.findMany.mockResolvedValue([inscripcion({ tipoInscripcion: sinColumna }), inscripcion({ id: 6, tipoInscripcion: tipo({ modalidad: 'HIBRIDA' }) })])
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(r.body.data.map((f: { tipoInscripcion: { modalidad: string } }) => f.tipoInscripcion.modalidad)).toEqual(['PRESENCIAL', 'PRESENCIAL'])
    })

    it('la respuesta de crear (aCreada) la trae dentro del tipo; la forma LEGACY no', () => {
        const creada = aCreada(inscripcion() as unknown as InscripcionDetalle)
        expect(creada.tipoInscripcion).toEqual({ id: 14, nombre: 'ESTUDIANTES', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', categoria: 'ESTUDIANTES' })
        expect(creada.modalidadPago).toBe('billetera')
        expect(creada).not.toHaveProperty('modalidad')
        expect(aCreada(inscripcion({ tipoInscripcion: tipo({ modalidad: 'PRESENCIAL' }) }) as unknown as InscripcionDetalle).tipoInscripcion?.modalidad).toBe('PRESENCIAL')
        expect(aCreada(inscripcion({ tipoInscripcion: null }) as unknown as InscripcionDetalle).tipoInscripcion).toBeNull()

        const legacy = aLegacy(inscripcion() as unknown as InscripcionDetalle)
        expect(legacy.tipoInscripcion).toEqual({ id: 14, nombre: 'ESTUDIANTES', precio: 30, badge: 'VIRTUAL' })
        expect(JSON.stringify(legacy)).not.toContain('"modalidad"')
    })
})

describe('filtro ?modalidad= (spec 018)', () => {
    it('sin el parámetro el filtro es el de antes (ni tipoInscripcion ni AND)', async () => {
        await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(dondeDeLaLista()).toEqual({ eventoId: 2 })
    })

    it('?modalidad=VIRTUAL filtra por el tipo, en la lista y en el conteo', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions?modalidad=VIRTUAL').set(tesorero())
        expect(r.status).toBe(200)
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, tipoInscripcion: { modalidad: 'VIRTUAL' } })
        expect(m.inscripcion.count.mock.calls[0][0].where).toEqual({ eventoId: 2, tipoInscripcion: { modalidad: 'VIRTUAL' } })
    })

    it('acepta minúsculas y vacío (= sin filtro)', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?modalidad=virtual').set(tesorero())
        expect(dondeDeLaLista().tipoInscripcion).toEqual({ modalidad: 'VIRTUAL' })
        m.inscripcion.findMany.mockClear()
        const vacio = await request(app).get('/api/v1/events/2/inscriptions?modalidad=').set(tesorero())
        expect(vacio.status).toBe(200)
        expect(dondeDeLaLista()).toEqual({ eventoId: 2 })
    })

    it('combinado con ?categoria= se cumplen las dos condiciones en UNA sola clave tipoInscripcion', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?categoria=estudiantes&modalidad=VIRTUAL').set(tesorero())
        const donde = dondeDeLaLista()
        expect(donde.tipoInscripcion).toEqual({ categoria: { codigo: 'ESTUDIANTES' }, modalidad: 'VIRTUAL' })
        // La condición de la categoría no se pierde (dos propiedades con la misma clave se pisarían)
        expect(Object.keys(donde).filter((clave) => clave === 'tipoInscripcion')).toHaveLength(1)
    })

    it('?categoria= sola se comporta como antes', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?categoria=ESTUDIANTES').set(tesorero())
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, tipoInscripcion: { categoria: { codigo: 'ESTUDIANTES' } } })
    })

    it('?modalidad=PRESENCIAL incluye lo que no tiene tipo (cortesías), como el resumen; con categoría o tipo concreto no', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?modalidad=PRESENCIAL').set(tesorero())
        expect(dondeDeLaLista()).toEqual({
            eventoId: 2,
            AND: [{ OR: [{ tipoInscripcionId: null }, { tipoInscripcion: { modalidad: 'PRESENCIAL' } }] }],
        })

        m.inscripcion.findMany.mockClear()
        await request(app).get('/api/v1/events/2/inscriptions?modalidad=PRESENCIAL&categoria=ESTUDIANTES').set(tesorero())
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, tipoInscripcion: { categoria: { codigo: 'ESTUDIANTES' }, modalidad: 'PRESENCIAL' } })

        m.inscripcion.findMany.mockClear()
        await request(app).get('/api/v1/events/2/inscriptions?modalidad=PRESENCIAL&tipoInscripcionId=8').set(tesorero())
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, tipoInscripcionId: 8, tipoInscripcion: { modalidad: 'PRESENCIAL' } })
    })

    it('se combina con la búsqueda libre sin pisar su OR', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?modalidad=PRESENCIAL&q=ana').set(tesorero())
        const donde = dondeDeLaLista()
        expect(donde.AND).toHaveLength(1)
        expect(donde.OR).toContainEqual({ participante: { correo: { contains: 'ana' } } })
    })

    it.each([
        ['/api/v1/events/2/inscriptions?modalidad=HIBRIDA'],
        ['/api/v1/events/2/inscriptions?modalidad=banco'],
        ['/api/v1/events/2/inscriptions?modalidad=VIRTUAL&modalidad=PRESENCIAL'],
        ['/api/v1/events/2/inscriptions/export?modalidad=HIBRIDA'],
    ])('%s responde 422 VALIDATION_ERROR con fields.modalidad y no consulta', async (ruta) => {
        const r = await request(app).get(ruta).set(tesorero())
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', fields: { modalidad: expect.any(String) } })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('el CSV usa el mismo filtro, también combinado con la categoría', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export?modalidad=VIRTUAL&categoria=ESTUDIANTES').set(tesorero())
        expect(r.status).toBe(200)
        expect(dondeDeLaLista().tipoInscripcion).toEqual({ categoria: { codigo: 'ESTUDIANTES' }, modalidad: 'VIRTUAL' })
    })
})

describe('columna «Modalidad de asistencia» del CSV (spec 018)', () => {
    const columnas = (texto: string) => texto.slice(1).split('\r\n')[0].split(';')
    const fila = (texto: string, indice = 1) => texto.slice(1).split('\r\n')[indice].split(';')

    it('con «pagos.ver» convive con la columna «Modalidad» de pago, que no se renombra', async () => {
        m.inscripcion.findMany.mockResolvedValue([inscripcion(), inscripcion({ id: 6, tipoInscripcion: tipo({ modalidad: 'PRESENCIAL' }) }), inscripcion({ id: 7, tipoInscripcionId: null, tipoInscripcion: null })])
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(tesorero())
        const encabezado = columnas(r.text)
        expect(encabezado).toContain('Modalidad de asistencia')
        expect(encabezado).toContain('Modalidad')
        expect(encabezado.indexOf('Modalidad de asistencia')).toBe(encabezado.indexOf('Etiqueta') + 1)
        const asistencia = encabezado.indexOf('Modalidad de asistencia')
        const pago = encabezado.indexOf('Modalidad')
        expect(fila(r.text, 1)[asistencia]).toBe('VIRTUAL')
        expect(fila(r.text, 1)[pago]).toBe('billetera')
        expect(fila(r.text, 2)[asistencia]).toBe('PRESENCIAL')
        // Sin tipo (cortesía) se lee PRESENCIAL
        expect(fila(r.text, 3)[asistencia]).toBe('PRESENCIAL')
    })

    it('sin «pagos.ver» también sale (no es un dato de pago) y la de pago no', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(comision())
        const encabezado = columnas(r.text)
        expect(encabezado).toContain('Modalidad de asistencia')
        expect(encabezado).not.toContain('Modalidad')
        expect(fila(r.text)[encabezado.indexOf('Modalidad de asistencia')]).toBe('VIRTUAL')
        expect(encabezado).toHaveLength(fila(r.text).length)
        expect(r.text).not.toContain('billetera')
    })
})

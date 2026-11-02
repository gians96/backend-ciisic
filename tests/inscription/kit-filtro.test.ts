import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { construirFiltro, ordenDelListado } from '../../src/api/inscription/services/inscription'
import { aEntregar, condicionKit, esFiltroKit, FILTROS_KIT, situacionKit, TEXTO_SITUACION_KIT } from '../../src/core/kit'
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
// 15:32 UTC = 10:32 en Lima
const ENTREGADO_EN = new Date('2026-10-27T15:32:00.000Z')
const ENTREGADOR = { id: 41, nombres: 'Rosa', apellidos: 'Quispe' }

function tipo(cambios: Record<string, unknown> = {}) {
    return {
        id: 3, codigo: 'estudiantes_con_kit', nombre: 'ESTUDIANTES', etiqueta: 'CON KIT', precio: new Prisma.Decimal(120), precioInstitucional: new Prisma.Decimal(100),
        modalidad: 'PRESENCIAL', incluyeKit: true, categoria: { id: 3, codigo: 'ESTUDIANTES', nombre: 'ESTUDIANTES', esEstudiantil: true }, ...cambios,
    }
}

function inscripcion(cambios: Record<string, unknown> = {}) {
    return {
        id: 5, eventoId: 2, participanteId: 50, tipoInscripcionId: 3, clasificacionId: null, estadoId: 2,
        creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        banco: null, billeteraDigital: 'yape', tipoOperacion: null, modalidadPago: 'billetera', numeroOperacion: 'OP-777',
        monto: new Prisma.Decimal(100), descuento: new Prisma.Decimal(20), tieneDescuento: true, fechaPago: new Date('2026-09-19T00:00:00Z'),
        voucherArchivo: 'voucher-5.png', esCorreoInstitucional: false, motivoRechazo: null, revisadoPorId: null, revisadoEn: null,
        credencialEnviadaEn: null, esEstudianteUndc: false, codigoEstudiante: null, verificacionEstudiante: null,
        esCorreoVerificado: false, verificacionCorreo: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        kitEntregadoEn: null, kitEntregadoPorId: null, kitEntregadoPor: null,
        evento,
        participante: { id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321' },
        tipoInscripcion: tipo(),
        clasificacion: null,
        estado: { id: 2, codigo: 'APROBADO', nombre: 'Aprobado' },
        revisadoPor: null,
        ...cambios,
    }
}

const estado = (id: number, codigo: string, nombre: string) => ({ estado: { id, codigo, nombre }, estadoId: id })
const tesorero = () => ({ Authorization: `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}` })
const comision = () => ({ Authorization: `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver', 'inscripciones.exportar'] })}` })
const dondeDeLaLista = () => m.inscripcion.findMany.mock.calls[0][0].where
const ordenDeLaLista = () => m.inscripcion.findMany.mock.calls[0][0].orderBy

const TIPO_CON_KIT = { incluyeKit: true, modalidad: 'PRESENCIAL' }
const TIPO_SIN_KIT = { OR: [{ incluyeKit: false }, { modalidad: 'VIRTUAL' }] }

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 ? evento : null))
    m.inscripcion.findUnique.mockResolvedValue(inscripcion())
    m.inscripcion.findMany.mockResolvedValue([inscripcion()])
    m.inscripcion.count.mockResolvedValue(1)
    m.cambioTipoInscripcion.findMany.mockResolvedValue([])
})

describe('filtro ?kit= del listado (spec 045)', () => {
    it('sin el parámetro el filtro es el de antes', async () => {
        await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(dondeDeLaLista()).toEqual({ eventoId: 2 })
        expect(ordenDeLaLista()).toEqual([{ creadoEn: 'desc' }, { id: 'desc' }])
    })

    it.each([
        ['CON_KIT', { tipoInscripcion: TIPO_CON_KIT }],
        ['SIN_KIT', { OR: [{ tipoInscripcionId: null }, { tipoInscripcion: TIPO_SIN_KIT }] }],
        ['PENDIENTE', { estado: { codigo: 'APROBADO' }, tipoInscripcion: TIPO_CON_KIT, kitEntregadoEn: null }],
        ['ENTREGADO', { kitEntregadoEn: { not: null } }],
        ['POR_APROBAR', { estado: { codigo: { in: ['PENDIENTE', 'EN_REVISION'] } }, tipoInscripcion: TIPO_CON_KIT, kitEntregadoEn: null }],
        ['REVISAR', { kitEntregadoEn: { not: null }, OR: [{ estado: { codigo: { not: 'APROBADO' } } }, { tipoInscripcionId: null }, { tipoInscripcion: TIPO_SIN_KIT }] }],
    ])('?kit=%s va como UN elemento de AND (nunca con NOT: una cortesía sin tipo tiene la clave foránea nula)', async (valor, condicion) => {
        const r = await request(app).get(`/api/v1/events/2/inscriptions?kit=${valor}`).set(tesorero())
        expect(r.status).toBe(200)
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, AND: [condicion] })
        expect(m.inscripcion.count.mock.calls[0][0].where).toEqual({ eventoId: 2, AND: [condicion] })
        expect(JSON.stringify(condicion)).not.toContain('"NOT"')
    })

    it('acepta minúsculas y vacío (= sin filtro)', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?kit=pendiente').set(tesorero())
        expect(dondeDeLaLista().AND).toEqual([condicionKit('PENDIENTE')])
        m.inscripcion.findMany.mockClear()
        const vacio = await request(app).get('/api/v1/events/2/inscriptions?kit=').set(tesorero())
        expect(vacio.status).toBe(200)
        expect(dondeDeLaLista()).toEqual({ eventoId: 2 })
    })

    it('no pisa el estado, el tipo ni la búsqueda libre de los otros filtros', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?kit=PENDIENTE&estado=EN_REVISION&tipoInscripcionId=8&q=ana').set(tesorero())
        const donde = dondeDeLaLista()
        // El estado y el tipo del filtro siguen en su clave; la condición del kit, aparte
        expect(donde.estado).toEqual({ codigo: 'EN_REVISION' })
        expect(donde.tipoInscripcionId).toBe(8)
        expect(donde.AND).toEqual([condicionKit('PENDIENTE')])
        expect(donde.OR).toContainEqual({ participante: { correo: { contains: 'ana' } } })
    })

    it('con ?modalidad=PRESENCIAL (que incluye las cortesías sin tipo) conviven los dos elementos de AND', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?kit=SIN_KIT&modalidad=PRESENCIAL').set(tesorero())
        expect(dondeDeLaLista()).toEqual({
            eventoId: 2,
            AND: [{ OR: [{ tipoInscripcionId: null }, { tipoInscripcion: { modalidad: 'PRESENCIAL' } }] }, condicionKit('SIN_KIT')],
        })
    })

    it('con ?categoria= la categoría sigue en UNA sola clave tipoInscripcion', async () => {
        await request(app).get('/api/v1/events/2/inscriptions?kit=CON_KIT&categoria=estudiantes').set(tesorero())
        const donde = dondeDeLaLista()
        expect(donde.tipoInscripcion).toEqual({ categoria: { codigo: 'ESTUDIANTES' } })
        expect(donde.AND).toEqual([condicionKit('CON_KIT')])
    })

    it('«entregados» y «a revisar» se ordenan de la entrega más reciente a la más antigua', async () => {
        for (const valor of ['ENTREGADO', 'REVISAR']) {
            m.inscripcion.findMany.mockClear()
            await request(app).get(`/api/v1/events/2/inscriptions?kit=${valor}`).set(tesorero())
            expect(ordenDeLaLista()).toEqual([{ kitEntregadoEn: 'desc' }, { id: 'desc' }])
        }
        for (const valor of ['PENDIENTE', 'CON_KIT', 'SIN_KIT', 'POR_APROBAR']) {
            m.inscripcion.findMany.mockClear()
            await request(app).get(`/api/v1/events/2/inscriptions?kit=${valor}`).set(tesorero())
            expect(ordenDeLaLista()).toEqual([{ creadoEn: 'desc' }, { id: 'desc' }])
        }
    })

    it.each([
        ['/api/v1/events/2/inscriptions?kit=TODOS'],
        ['/api/v1/events/2/inscriptions?kit=entregado,pendiente'],
        ['/api/v1/events/2/inscriptions?kit=PENDIENTE&kit=ENTREGADO'],
        ['/api/v1/events/2/inscriptions/export?kit=NADA'],
    ])('%s responde 422 VALIDATION_ERROR con fields.kit y no consulta (nunca se ignora un valor desconocido)', async (ruta) => {
        const r = await request(app).get(ruta).set(tesorero())
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', fields: { kit: expect.any(String) } })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('el CSV usa el mismo filtro y se puede bajar solo la lista de pendientes', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export?kit=PENDIENTE').set(tesorero())
        expect(r.status).toBe(200)
        expect(dondeDeLaLista()).toEqual({ eventoId: 2, AND: [condicionKit('PENDIENTE')] })
    })

    it('construirFiltro es puro: la condición del kit y los demás filtros', () => {
        expect(construirFiltro(2, {})).toEqual({ eventoId: 2 })
        expect(construirFiltro(2, { kit: 'ENTREGADO', estado: 'APROBADO' })).toEqual({ eventoId: 2, estado: { codigo: 'APROBADO' }, AND: [{ kitEntregadoEn: { not: null } }] })
        expect(ordenDelListado({ kit: 'ENTREGADO' })).toEqual([{ kitEntregadoEn: 'desc' }, { id: 'desc' }])
        expect(ordenDelListado({})).toEqual([{ creadoEn: 'desc' }, { id: 'desc' }])
    })
})

describe('el kit en las filas del listado (spec 045)', () => {
    it('cada fila trae `kit` completo (si el tipo lo incluye, cuándo y quién) además de `kitEntregado`', async () => {
        m.inscripcion.findMany.mockResolvedValue([
            inscripcion(),
            inscripcion({ id: 6, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPorId: 41, kitEntregadoPor: ENTREGADOR }),
            inscripcion({ id: 7, tipoInscripcionId: null, tipoInscripcion: null }),
        ])
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(tesorero())
        expect(r.status).toBe(200)
        const [pendiente, entregado, cortesia] = r.body.data
        expect(pendiente.kit).toEqual({ incluye: true, entregado: false, entregadoEn: null, entregadoPor: null })
        expect(pendiente.kitEntregado).toBe(false)
        expect(entregado.kit).toEqual({ incluye: true, entregado: true, entregadoEn: ENTREGADO_EN.toISOString(), entregadoPor: ENTREGADOR })
        expect(entregado.kitEntregado).toBe(true)
        expect(cortesia.kit.incluye).toBe(false)
    })

    it('sin «pagos.ver» (Comisión) también lo ve: no es un dato de pago', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions').set(comision())
        expect(r.body.data[0].kit).toMatchObject({ incluye: true, entregado: false })
        expect(r.body.data[0].monto).toBeNull()
    })
})

describe('columnas del kit en el CSV (spec 045)', () => {
    const lineas = (texto: string) => texto.slice(1).split('\r\n').map((linea) => linea.split(';'))
    const filasCsv = (texto: string) => {
        const [encabezado, ...filas] = lineas(texto)
        return filas.map((fila) => Object.fromEntries(encabezado.map((titulo, i) => [titulo, fila[i]])))
    }

    it('son las tres últimas columnas, después de las de la spec 040', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(tesorero())
        const [encabezado] = lineas(r.text)
        expect(encabezado.slice(-5)).toEqual(['Código QR', 'Credencial 3D', 'Kit', 'Kit entregado el', 'Kit entregado por'])
    })

    it('dice dónde está el kit de cada persona, con la hora de Lima y quién lo entregó', async () => {
        m.inscripcion.findMany.mockResolvedValue([
            inscripcion({ id: 1, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPorId: 41, kitEntregadoPor: ENTREGADOR }),
            inscripcion({ id: 2 }),
            inscripcion({ id: 3, ...estado(1, 'PENDIENTE', 'Pendiente') }),
            inscripcion({ id: 4, ...estado(4, 'EN_REVISION', 'En revisión') }),
            inscripcion({ id: 5, ...estado(3, 'RECHAZADO', 'Rechazado') }),
            inscripcion({ id: 6, tipoInscripcion: tipo({ incluyeKit: false, etiqueta: 'SIN KIT' }) }),
            inscripcion({ id: 7, tipoInscripcion: tipo({ incluyeKit: true, modalidad: 'VIRTUAL' }) }),
            inscripcion({ id: 8, tipoInscripcionId: null, tipoInscripcion: null }),
            // Entregado y luego cancelado: sigue contando como entregado (es un hecho)
            inscripcion({ id: 9, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPor: null, ...estado(5, 'CANCELADO', 'Cancelado') }),
        ])
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(tesorero())
        const filas = filasCsv(r.text)
        expect(filas.map((fila) => fila.Kit)).toEqual([
            'Entregado', 'Pendiente de entrega', 'Pago por aprobar', 'Pago por aprobar', 'No corresponde', 'No incluye', 'No incluye', 'No incluye', 'Entregado',
        ])
        expect(filas.map((fila) => fila['Kit entregado el'])).toEqual(['2026-10-27 10:32', '', '', '', '', '', '', '', '2026-10-27 10:32'])
        expect(filas.map((fila) => fila['Kit entregado por'])).toEqual(['Rosa Quispe', '', '', '', '', '', '', '', ''])
    })

    it('sin «pagos.ver» las columnas del kit también salen (no son de pago)', async () => {
        const r = await request(app).get('/api/v1/events/2/inscriptions/export').set(comision())
        const [encabezado] = lineas(r.text)
        expect(encabezado).toEqual(expect.arrayContaining(['Kit', 'Kit entregado el', 'Kit entregado por']))
        expect(encabezado).not.toContain('Monto')
        expect(filasCsv(r.text)[0].Kit).toBe('Pendiente de entrega')
    })
})

describe('núcleo del kit (spec 045)', () => {
    it('FILTROS_KIT son los seis valores y esFiltroKit solo acepta esos', () => {
        expect(FILTROS_KIT).toEqual(['CON_KIT', 'SIN_KIT', 'PENDIENTE', 'ENTREGADO', 'POR_APROBAR', 'REVISAR'])
        for (const valor of FILTROS_KIT) expect(esFiltroKit(valor)).toBe(true)
        for (const valor of ['con_kit', 'TODOS', '', null, undefined, 3, ['PENDIENTE']]) expect(esFiltroKit(valor)).toBe(false)
    })

    it('aEntregar es la misma base del resumen de la puerta: aprobadas presenciales con kit', () => {
        expect(aEntregar(2)).toEqual({ eventoId: 2, estado: { codigo: 'APROBADO' }, tipoInscripcion: { incluyeKit: true, modalidad: 'PRESENCIAL' } })
    })

    it('situacionKit: entregado manda; después, el tipo; después, el estado de la inscripción', () => {
        const con = { incluye: true, entregado: false }
        expect(situacionKit({ incluye: true, entregado: true }, 'CANCELADO')).toBe('ENTREGADO')
        expect(situacionKit({ incluye: false, entregado: true }, 'APROBADO')).toBe('ENTREGADO')
        expect(situacionKit({ incluye: false, entregado: false }, 'APROBADO')).toBe('NO_INCLUYE')
        expect(situacionKit(con, 'APROBADO')).toBe('PENDIENTE')
        expect(situacionKit(con, 'PENDIENTE')).toBe('POR_APROBAR')
        expect(situacionKit(con, 'EN_REVISION')).toBe('POR_APROBAR')
        expect(situacionKit(con, 'RECHAZADO')).toBe('NO_CORRESPONDE')
        expect(situacionKit(con, 'CANCELADO')).toBe('NO_CORRESPONDE')
        expect(Object.values(TEXTO_SITUACION_KIT)).toEqual(['Entregado', 'Pendiente de entrega', 'Pago por aprobar', 'No incluye', 'No corresponde'])
    })
})

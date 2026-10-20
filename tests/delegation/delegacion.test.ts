import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aDelegacion, precioUnitario } from '../../src/api/delegation/services/delegation'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        delegacion: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        inscripcion: { findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        participante: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        estadoInscripcion: { findUnique: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    tokenAcceso: { findUnique: Mock, update: Mock }
    delegacion: { findUnique: Mock, findMany: Mock, create: Mock, update: Mock, delete: Mock }
    inscripcion: { findMany: Mock, count: Mock, create: Mock, update: Mock, updateMany: Mock }
    participante: { findMany: Mock, create: Mock, update: Mock }
    estadoInscripcion: { findUnique: Mock }
    $queryRaw: Mock
    $transaction: Mock
}

const FECHA = new Date('2026-10-18T12:00:00Z')
const administrador = () => `Bearer ${tokenDeRol('ADMIN')}`

const evento = {
    id: 2, codigo: 'ciisic-2026', nombre: 'VIII CIISIC', nombreCorto: 'VIII CIISIC', descripcion: null, sede: null,
    fechaInicio: FECHA, fechaFin: FECHA, inscripcionesInicio: null, inscripcionesFin: null, inscripcionesAbiertas: true,
    estado: 'PUBLICADO', esPrincipal: true, dominioInstitucional: 'undc.edu.pe', correoContacto: null, telefonoContacto: null,
    remitenteNombre: null, asuntoAprobacion: null, logoArchivo: null, datosPago: null, credencialCorreoId: null,
    delegacionesMinIntegrantes: 10, delegacionesPrecioEstandar: new Prisma.Decimal(60), delegacionesPrecioPromocional: new Prisma.Decimal(50),
    creadoEn: FECHA, actualizadoEn: FECHA,
}

const delegacion = {
    id: 5, eventoId: 2, nombre: 'Delegación Ingeniería', codigoLink: 'abc123def456', institucion: 'UNDC',
    representanteNombre: 'Rosa Quispe', representanteEmail: 'rosa@undc.edu.pe', representanteTelefono: '999888777',
    minIntegrantes: 10, precioEstandar: new Prisma.Decimal(60), precioPromocional: new Prisma.Decimal(50),
    modalidadPago: null, banco: null, billeteraDigital: null, tipoOperacion: null, numeroOperacion: null,
    fechaPago: null, voucherArchivo: null, montoTotalPagado: new Prisma.Decimal(0),
    activo: true, creadoEn: FECHA, actualizadoEn: FECHA,
}

const participante = (id: number, documento: string) => ({
    id, tipoDocumentoId: 'dni', numeroDocumento: documento, nombres: `Nombre ${id}`, apellidos: `Apellido ${id}`,
    correo: `persona${id}@example.com`, celular: '999888777', googleSub: null, googleVinculadoEn: null,
    fotoArchivo: null, fotoActualizadaEn: null, creadoEn: FECHA, actualizadoEn: FECHA,
})

const inscripcionDe = (id: number, participanteId: number) => ({
    id, participanteId, delegacionId: 5, participante: participante(participanteId, String(participanteId).padStart(8, '0')),
    estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' }, monto: new Prisma.Decimal(50), creadoEn: FECHA,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.$queryRaw.mockResolvedValue([])
    m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m))
    m.estadoInscripcion.findUnique.mockResolvedValue({ id: 1 })
    m.inscripcion.updateMany.mockResolvedValue({ count: 0 })
    m.inscripcion.create.mockImplementation(async ({ data }: { data: { participanteId: number } }) => ({ id: 100 + data.participanteId }))
    m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento })
    m.tokenAcceso.update.mockResolvedValue({})
})

describe('tarifa por persona', () => {
    it.each([
        [0, 60], [1, 60], [9, 60], [10, 50], [11, 50], [100, 50],
    ])('con %i integrantes cobra %i', (total, esperado) => {
        expect(precioUnitario(60, 50, 10, total)).toBe(esperado)
    })

    it('respeta un mínimo distinto al de la regla por defecto', () => {
        expect(precioUnitario(80, 65, 5, 4)).toBe(80)
        expect(precioUnitario(80, 65, 5, 5)).toBe(65)
    })

    it('aDelegacion calcula el unitario y el total acumulado', () => {
        const datos = aDelegacion(delegacion as never, 11)
        expect(datos).toMatchObject({
            id: 5, precioEstandar: 60, precioPromocional: 50, precioUnitario: 50, totalIntegrantes: 11, montoTotal: 550,
        })
    })
})

describe('link de la delegación (API del sitio)', () => {
    it('devuelve los datos del formulario sin el contacto del representante', async () => {
        m.delegacion.findUnique.mockResolvedValue({ ...delegacion, evento, _count: { inscripciones: 4 } })
        const r = await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({
            id: 5, nombre: 'Delegación Ingeniería', institucion: 'UNDC', representanteNombre: 'Rosa Quispe',
            totalIntegrantes: 4, precioUnitario: 60, precioEstandar: 60, precioPromocional: 50,
            evento: { id: 2, codigo: 'ciisic-2026' },
        })
        expect(JSON.stringify(r.body.data)).not.toContain('rosa@undc.edu.pe')
    })

    it('exige el token de acceso del evento', async () => {
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456')).status).toBe(401)
    })

    it('una delegación inactiva, inexistente o de otro evento responde 404', async () => {
        m.delegacion.findUnique.mockResolvedValueOnce({ ...delegacion, activo: false, evento, _count: { inscripciones: 0 } })
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        m.delegacion.findUnique.mockResolvedValueOnce(null)
        expect((await request(app).get('/api/v1/site/delegations/link/otro').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        m.delegacion.findUnique.mockResolvedValueOnce({ ...delegacion, eventoId: 7, evento, _count: { inscripciones: 0 } })
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
    })
})

describe('administración de delegaciones', () => {
    it('el Administrador crea una delegación con link único y precios por defecto', async () => {
        m.delegacion.findUnique.mockResolvedValue(null)
        m.delegacion.create.mockResolvedValue(delegacion)
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación Ingeniería', institucion: 'UNDC', representanteNombre: 'Rosa Quispe' })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ nombre: 'Delegación Ingeniería', precioEstandar: 60, precioPromocional: 50, totalIntegrantes: 0 })
        expect(m.delegacion.create.mock.calls[0][0].data.codigoLink).toMatch(/^[0-9a-f]{16}$/)
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({ minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50 })
    })

    it('rechaza un precio promocional mayor que el estándar', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación', precioEstandar: 50, precioPromocional: 60 })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('un Tesorero con alcance por evento no gestiona delegaciones', async () => {
        const token = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', `Bearer ${token}`).send({ nombre: 'Delegación' })
        expect(r.status).toBe(403)
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('la carga de integrantes aplica la tarifa promocional al cruzar el mínimo', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ select, include }: { select?: { eventoId?: boolean, precioEstandar?: boolean }, include?: { evento?: boolean, inscripciones?: boolean } }) => {
            if (select?.eventoId) return { eventoId: 2 }
            if (select?.precioEstandar) return { precioEstandar: delegacion.precioEstandar, precioPromocional: delegacion.precioPromocional, minIntegrantes: 10 }
            if (include?.evento) return { ...delegacion, evento }
            if (include?.inscripciones) return { ...delegacion, inscripciones: [inscripcionDe(100, 1)] }
            return null
        })
        m.participante.findMany.mockResolvedValue([])
        m.participante.create.mockImplementation(async ({ data }: { data: { numeroDocumento: string } }) => participante(Number(data.numeroDocumento), data.numeroDocumento))
        m.inscripcion.count.mockResolvedValue(8)

        const r = await request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', administrador())
            .send({
                participantes: [
                    { tipoDocumento: 'dni', numeroDocumento: '70000001', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@example.com', celular: '999888777' },
                    { tipoDocumento: 'dni', numeroDocumento: '70000002', nombres: 'Luis', apellidos: 'Gómez', correo: 'luis@example.com', celular: '999888778' },
                    { tipoDocumento: 'dni', numeroDocumento: '70000003', nombres: 'Eva', apellidos: 'Rojas', correo: 'eva@example.com', celular: '999888779' },
                ],
            })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ registrados: 3, omitidos: 0 })
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({
            where: { delegacionId: 5, eventoId: 2 },
            data: { monto: 50, descuento: 10, tieneDescuento: true },
        })
        for (const llamada of m.inscripcion.create.mock.calls) {
            expect(llamada[0].data).toMatchObject({ delegacionId: 5, monto: 50, descuento: 10, tieneDescuento: true, modalidadPago: 'delegacion' })
            expect(llamada[0].data.numeroOperacion).toMatch(/^DELEGACION-/)
        }
    })

    it('por debajo del mínimo cobra la tarifa estándar', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ select, include }: { select?: { eventoId?: boolean, precioEstandar?: boolean }, include?: { evento?: boolean, inscripciones?: boolean } }) => {
            if (select?.eventoId) return { eventoId: 2 }
            if (select?.precioEstandar) return { precioEstandar: delegacion.precioEstandar, precioPromocional: delegacion.precioPromocional, minIntegrantes: 10 }
            if (include?.evento) return { ...delegacion, evento }
            if (include?.inscripciones) return { ...delegacion, inscripciones: [] }
            return null
        })
        m.participante.findMany.mockResolvedValue([])
        m.participante.create.mockResolvedValue(participante(1, '70000001'))
        m.inscripcion.count.mockResolvedValue(0)

        const r = await request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', administrador())
            .send({ participantes: [{ tipoDocumento: 'dni', numeroDocumento: '70000001', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@example.com' }] })
        expect(r.status).toBe(201)
        expect(m.participante.create.mock.calls[0][0].data.celular).toBe('')
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({
            where: { delegacionId: 5, eventoId: 2 },
            data: { monto: 60, descuento: 0, tieneDescuento: false },
        })
    })

    it('rechaza documentos repetidos en la misma carga antes de escribir', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ select, include }: { select?: { eventoId?: boolean }, include?: { evento?: boolean } }) => {
            if (select?.eventoId) return { eventoId: 2 }
            if (include?.evento) return { ...delegacion, evento }
            return null
        })
        const fila = { tipoDocumento: 'dni', numeroDocumento: '70000001', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@example.com', celular: '999888777' }
        const r = await request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', administrador())
            .send({ participantes: [fila, { ...fila, correo: 'otra@example.com' }] })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DUPLICATE_PARTICIPANT')
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('rechaza a quien ya está inscrito en el evento fuera de la delegación', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ select, include }: { select?: { eventoId?: boolean }, include?: { evento?: boolean } }) => {
            if (select?.eventoId) return { eventoId: 2 }
            if (include?.evento) return { ...delegacion, evento }
            return null
        })
        m.participante.findMany.mockResolvedValueOnce([participante(20, '70000001')]).mockResolvedValueOnce([])
        m.inscripcion.findMany.mockResolvedValue([{ id: 9, participanteId: 20, delegacionId: 3, estado: { codigo: 'PENDIENTE' } }])
        const r = await request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', administrador())
            .send({ participantes: [{ tipoDocumento: 'dni', numeroDocumento: '70000001', nombres: 'Ana', apellidos: 'Pérez', correo: 'ana@example.com', celular: '999888777' }] })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PARTICIPANT_ALREADY_REGISTERED')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })
})

describe('registro público de una delegación (spec 018)', () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

    const representante = {
        nombres: 'Rosa', apellidos: 'Quispe', tipoDocumento: 'dni', numeroDocumento: '70000001',
        correo: 'rosa@undc.edu.pe', celular: '999888777', esIntegrante: true,
    }
    const integrante = {
        tipoDocumento: 'dni', numeroDocumento: '70000002', nombres: 'Luis', apellidos: 'Torres',
        correo: 'luis@undc.edu.pe', celular: '999888778',
    }

    /** El cuerpo del formulario (multipart: el JSON va como texto en cada campo). */
    function cuerpo(extra: Record<string, unknown> = {}) {
        return {
            delegacion: JSON.stringify({ nombre: 'Ing. de Sistemas UNDC', institucion: 'UNDC' }),
            representante: JSON.stringify(representante),
            participantes: JSON.stringify([integrante]),
            modalidadPago: 'billetera',
            billeteraDigital: 'yape',
            numeroOperacion: 'OP-12345',
            fechaPago: '2026-10-15',
            ...extra,
        }
    }

    function registrar(extra: Record<string, unknown> = {}) {
        const peticion = request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO)
        for (const [campo, valor] of Object.entries(cuerpo(extra))) peticion.field(campo, String(valor))
        return peticion.attach('voucher', PNG, { filename: 'voucher.png', contentType: 'image/png' })
    }

    /** La delegación creada: la usan las llamadas posteriores (detalle, lectura por id). */
    let creada: Record<string, unknown>

    beforeEach(() => {
        // `findUnique` sirve para dos cosas: buscar el código del link (no existe) y leer la
        // delegación por id. Se distinguen por la clave consultada.
        creada = { ...delegacion, id: 77, nombre: 'Ing. de Sistemas UNDC' }
        m.delegacion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            creada = { ...delegacion, ...data, id: 77 }
            return creada
        })
        m.delegacion.update.mockResolvedValue(delegacion)
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string, id?: number } }) => {
            if (where.codigoLink) return null
            return { ...creada, evento, _count: { inscripciones: 0 }, inscripciones: [] }
        })
        m.inscripcion.count.mockResolvedValue(0)
        m.participante.create.mockImplementation(async ({ data }: { data: { numeroDocumento: string } }) => participante(Number(data.numeroDocumento), data.numeroDocumento))
    })

    it('registra al grupo con un solo pago y devuelve el link de seguimiento', async () => {
        const r = await registrar()
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ id: 77, nombre: 'Ing. de Sistemas UNDC', registrados: 2 })

        // La delegación guarda el pago conjunto: un número de operación y un voucher
        const creada = m.delegacion.create.mock.calls[0][0].data
        expect(creada).toMatchObject({
            eventoId: 2, institucion: 'UNDC', representanteEmail: 'rosa@undc.edu.pe',
            precioEstandar: 60, precioPromocional: 50, minIntegrantes: 10,
        })
        expect(creada.codigoLink).toMatch(/^[0-9a-f]{16}$/)
        // El pago se guarda después, cuando ya se sabe el total
        const guardado = m.delegacion.update.mock.calls.map((llamada) => llamada[0].data)
        expect(guardado).toEqual(expect.arrayContaining([
            expect.objectContaining({
                modalidadPago: 'billetera', billeteraDigital: 'yape', numeroOperacion: 'OP-12345',
                voucherArchivo: expect.any(String),
            }),
        ]))
        expect(guardado).toEqual(expect.arrayContaining([expect.objectContaining({ montoTotalPagado: 120 })]))
    })

    it('el representante va primero en la lista de integrantes', async () => {
        await registrar()
        const creados = m.participante.create.mock.calls.map((llamada) => llamada[0].data.numeroDocumento)
        expect(creados).toEqual(['70000001', '70000002'])
    })

    it('si el representante no es integrante, no entra en la lista', async () => {
        await registrar({ representante: JSON.stringify({ ...representante, esIntegrante: false }) })
        const creados = m.participante.create.mock.calls.map((llamada) => llamada[0].data.numeroDocumento)
        expect(creados).toEqual(['70000002'])
    })

    it('el pago es de la delegación: cada inscripción lleva un código interno', async () => {
        await registrar()
        for (const llamada of m.inscripcion.create.mock.calls) {
            expect(llamada[0].data).toMatchObject({ delegacionId: 77, modalidadPago: 'delegacion', voucherArchivo: null })
            expect(llamada[0].data.numeroOperacion).toMatch(/^DELEGACION-/)
        }
    })

    it('exige el token de acceso del evento', async () => {
        const r = await request(app).post('/api/v1/site/delegations')
        expect(r.status).toBe(401)
        expect(r.body.code).toBe('EVENT_TOKEN_REQUIRED')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('exige el voucher de pago', async () => {
        const peticion = request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO)
        for (const [campo, valor] of Object.entries(cuerpo())) peticion.field(campo, String(valor))
        const r = await peticion
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VOUCHER_REQUIRED')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('cierra el registro cuando las inscripciones del evento están cerradas', async () => {
        const cerrado = { ...evento, inscripcionesAbiertas: false }
        m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento: cerrado })
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('REGISTRATION_CLOSED')
    })

    it('rechaza una fecha de pago futura', async () => {
        const r = await registrar({ fechaPago: '2030-01-01' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })

    it('rechaza el mismo número de operación en dos delegaciones del evento', async () => {
        m.delegacion.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicado', {
            code: 'P2002', clientVersion: '6', meta: { target: 'uq_delegaciones_evento_numero_operacion' },
        }))
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
        // La delegación ni siquiera se creó: no queda un grupo a medias
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('borra la delegación si falla al escribir sus inscripciones', async () => {
        m.inscripcion.create.mockRejectedValueOnce(new Error('falló la escritura'))
        const r = await registrar()
        expect(r.status).toBe(500)
        expect(m.delegacion.delete).toHaveBeenCalledWith({ where: { id: 77 } })
    })
})

describe('registro por el link de una delegación (spec 018)', () => {
    const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

    const representante = {
        nombres: 'Rosa', apellidos: 'Quispe', tipoDocumento: 'dni', numeroDocumento: '70000001',
        correo: 'rosa@undc.edu.pe', celular: '999888777', esIntegrante: true,
    }
    const integrante = {
        tipoDocumento: 'dni', numeroDocumento: '70000002', nombres: 'Luis', apellidos: 'Torres',
        correo: 'luis@undc.edu.pe', celular: '999888778',
    }

    /** Delegación ya creada por el staff: la tiene el link que se comparte. */
    const delStaff = {
        ...delegacion,
        id: 5,
        codigoLink: 'abc123def456',
        nombre: 'Ing. de Sistemas UNDC',
        precioEstandar: new Prisma.Decimal(80),
        precioPromocional: new Prisma.Decimal(65),
        minIntegrantes: 5,
    }

    function registrar(extra: Record<string, unknown> = {}) {
        const peticion = request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO)
        for (const [campo, valor] of Object.entries({
            codigoLink: 'abc123def456',
            delegacion: JSON.stringify({ nombre: 'Ing. de Sistemas UNDC', institucion: 'UNDC' }),
            representante: JSON.stringify(representante),
            participantes: JSON.stringify([integrante]),
            modalidadPago: 'billetera',
            billeteraDigital: 'yape',
            numeroOperacion: 'OP-LINK-001',
            fechaPago: '2026-10-15',
            ...extra,
        })) peticion.field(campo, String(valor))
        return peticion.attach('voucher', PNG, { filename: 'voucher.png', contentType: 'image/png' })
    }

    beforeEach(() => {
        m.delegacion.update.mockResolvedValue(delegacion)
        m.participante.create.mockImplementation(async ({ data }: { data: { numeroDocumento: string } }) => participante(Number(data.numeroDocumento), data.numeroDocumento))
        m.inscripcion.count.mockResolvedValue(0)
        // La búsqueda por link y la lectura del detalle devuelven la delegación del staff
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string, id?: number } }) => {
            if (where.codigoLink) return { ...delStaff, evento, _count: { inscripciones: 0 }, inscripciones: [] }
            return { ...delStaff, evento, _count: { inscripciones: 0 }, inscripciones: [] }
        })
    })

    it('se registra en la delegación del link, sin crear otra', async () => {
        const r = await registrar()
        expect(r.status).toBe(201)
        // No crea una delegación nueva: reutiliza la del link
        expect(m.delegacion.create).not.toHaveBeenCalled()
        expect(r.body.data).toMatchObject({ id: 5, nombre: 'Ing. de Sistemas UNDC' })
    })

    it('aplica la tarifa de esa delegación, no la del evento', async () => {
        await registrar()
        // 2 integrantes, mínimo 5: tarifa estándar de la delegación (80), no la del evento (60)
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ monto: 80, descuento: 0 })
        expect(m.delegacion.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 5 },
            data: expect.objectContaining({ montoTotalPagado: 160 }),
        }))
    })

    it('guarda el pago conjunto en la delegación del link', async () => {
        await registrar()
        expect(m.delegacion.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 5 },
            data: expect.objectContaining({
                modalidadPago: 'billetera', billeteraDigital: 'yape',
                numeroOperacion: 'OP-LINK-001', voucherArchivo: expect.any(String),
            }),
        }))
    })

    it('el total cuenta a los integrantes que ya tenía', async () => {
        m.inscripcion.count.mockResolvedValue(4)
        await registrar()
        // 4 previos + 2 de este envío = 6: con mínimo 5 ya aplica la promocional (65) de esa delegación
        expect(m.delegacion.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ montoTotalPagado: 390 }),
        }))
    })

    it('un link de otro evento responde 404', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => {
            if (where.codigoLink) return { ...delStaff, eventoId: 7, evento, _count: { inscripciones: 0 }, inscripciones: [] }
            return null
        })
        const r = await registrar()
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('DELEGATION_NOT_FOUND')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('un link de una delegación inactiva responde 404', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => {
            if (where.codigoLink) return { ...delStaff, activo: false, evento, _count: { inscripciones: 0 }, inscripciones: [] }
            return null
        })
        const r = await registrar()
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('DELEGATION_NOT_FOUND')
    })

    it('un link inexistente responde 404', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => {
            if (where.codigoLink) return null
            return null
        })
        const r = await registrar()
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('DELEGATION_NOT_FOUND')
    })

    it('reenviar la misma lista omite a los que ya estaban, sin duplicar', async () => {
        // Los dos participantes ya están en la delegación: se omiten, no se vuelven a crear
        m.participante.findMany.mockResolvedValue([participante(1, '70000001'), participante(2, '70000002')])
        m.inscripcion.findMany.mockResolvedValue([
            { id: 30, participanteId: 1, delegacionId: 5, estado: { codigo: 'PENDIENTE' } },
            { id: 31, participanteId: 2, delegacionId: 5, estado: { codigo: 'PENDIENTE' } },
        ])
        const r = await registrar()
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ registrados: 0, omitidos: 2 })
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('rechaza a quien ya está inscrito en el evento por fuera de la delegación', async () => {
        m.participante.findMany.mockResolvedValue([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 30, participanteId: 1, delegacionId: 3, estado: { codigo: 'PENDIENTE' } }])
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PARTICIPANT_ALREADY_REGISTERED')
    })

    it('sin link crea la delegación con la tarifa del evento', async () => {
        m.delegacion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...delegacion, ...data, id: 77 }))
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => {
            if (where.codigoLink) return null
            return { ...delegacion, evento, _count: { inscripciones: 0 }, inscripciones: [] }
        })
        // Sin participantes previos: todos se crean
        m.participante.findMany.mockResolvedValue([])
        m.inscripcion.findMany.mockResolvedValue([])
        const peticion = request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO)
        for (const [campo, valor] of Object.entries({
            delegacion: JSON.stringify({ nombre: 'Ing. de Sistemas UNDC', institucion: 'UNDC' }),
            representante: JSON.stringify(representante),
            participantes: JSON.stringify([integrante]),
            modalidadPago: 'billetera',
            billeteraDigital: 'yape',
            numeroOperacion: 'OP-SIN-LINK',
            fechaPago: '2026-10-15',
        })) peticion.field(campo, String(valor))
        const r = await peticion.attach('voucher', PNG, { filename: 'voucher.png', contentType: 'image/png' })
        expect(r.status).toBe(201)
        expect(m.delegacion.create).toHaveBeenCalled()
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({ precioEstandar: 60, precioPromocional: 50, minIntegrantes: 10 })
    })
})

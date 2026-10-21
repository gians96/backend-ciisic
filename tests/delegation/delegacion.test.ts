import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aDelegacion } from '../../src/api/delegation/services/delegation'
import { faltanParaPromocional, precioUnitario, tarifaParaModalidad, tipoParaGrupo } from '../../src/api/delegation/services/tarifa'
import { resumenPagos } from '../../src/api/delegation/services/pagos'
import { aprobarVarias } from '../../src/api/inscription/services/inscription'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        delegacion: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        delegacionPago: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        inscripcion: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
        participante: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        estadoInscripcion: { findUnique: jest.fn() },
        categoriaInscripcion: { findUnique: jest.fn() },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}))

// El aprobado masivo genera PDF y correos: aquí solo importa a quién se le aplica
jest.mock('../../src/api/inscription/services/inscription', () => ({
    ...jest.requireActual('../../src/api/inscription/services/inscription'),
    aprobarVarias: jest.fn(),
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    tokenAcceso: { findUnique: Mock, update: Mock }
    delegacion: { findUnique: Mock, findMany: Mock, create: Mock, update: Mock, delete: Mock }
    delegacionPago: { findFirst: Mock, findMany: Mock, create: Mock, update: Mock, delete: Mock }
    inscripcion: { findFirst: Mock, findMany: Mock, count: Mock, create: Mock, update: Mock, updateMany: Mock, delete: Mock }
    participante: { findMany: Mock, create: Mock, update: Mock }
    estadoInscripcion: { findUnique: Mock }
    categoriaInscripcion: { findUnique: Mock }
    $queryRaw: Mock
    $transaction: Mock
}
const aprobarVariasMock = aprobarVarias as unknown as Mock

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
    id: 5, eventoId: 2, nombre: 'Delegación Ingeniería', codigoLink: 'abc123def456', institucion: 'UNH',
    representanteNombre: 'Rosa Quispe', representanteEmail: 'rosa@unh.edu.pe', representanteTelefono: '999888777',
    representanteTipoDocumento: 'dni', representanteDocumento: '70000001',
    modalidad: 'PRESENCIAL', minIntegrantes: 10, precioEstandar: new Prisma.Decimal(60), precioPromocional: new Prisma.Decimal(50),
    tipoInscripcionId: null, activo: true, creadoEn: FECHA, actualizadoEn: FECHA,
}
/** Delegación con todo lo que lee `obtenerDelegacion` (evento, tipo, pagos e inscripciones). */
const completa = (base: Record<string, unknown> = delegacion, extra: Record<string, unknown> = {}) => ({ ...base, evento, tipoInscripcion: null, pagos: [], inscripciones: [], ...extra })
const delegacionVirtual = { ...delegacion, id: 6, modalidad: 'VIRTUAL', precioEstandar: new Prisma.Decimal(30), precioPromocional: new Prisma.Decimal(30) }

const participante = (id: number, documento: string) => ({
    id, tipoDocumentoId: 'dni', numeroDocumento: documento, nombres: `Nombre ${id}`, apellidos: `Apellido ${id}`,
    correo: `persona${id}@example.com`, celular: '999888777', googleSub: null, googleVinculadoEn: null,
    fotoArchivo: null, fotoActualizadaEn: null, creadoEn: FECHA, actualizadoEn: FECHA,
})

const inscripcionDe = (id: number, participanteId: number, estado = 'PENDIENTE') => ({
    id, participanteId, delegacionId: 5, participante: participante(participanteId, String(participanteId).padStart(8, '0')),
    estado: { id: 1, codigo: estado, nombre: estado }, monto: new Prisma.Decimal(50), creadoEn: FECHA,
})

/** Los tres tipos de la categoría `DELEGACIONES` (specs 022 y 023). */
const tipoGeneral = { id: 31, codigo: 'delegacion_general', nombre: 'Delegación General', etiqueta: 'sin kit', modalidad: 'PRESENCIAL', activo: true, orden: 1, precio: new Prisma.Decimal(60) }
const tipoPromocional = { id: 32, codigo: 'delegacion_grupal', nombre: 'Delegación Promocional', etiqueta: 'sin kit', modalidad: 'PRESENCIAL', activo: true, orden: 2, precio: new Prisma.Decimal(50) }
const tipoVirtual = { id: 33, codigo: 'delegacion_virtual', nombre: 'Delegación Virtual', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', activo: true, orden: 3, precio: new Prisma.Decimal(30) }
const categoriaDelegaciones = (tipos: unknown[] = [tipoGeneral, tipoPromocional, tipoVirtual]) => ({ id: 9, eventoId: 2, codigo: 'DELEGACIONES', nombre: 'Delegaciones', tipos })

const PDF = Buffer.from('%PDF-1.4\n%test\n')

const persona = (n: number) => ({
    tipoDocumento: 'dni', numeroDocumento: String(70000000 + n), nombres: `Persona${n}`, apellidos: `Apellido${n}`,
    correo: `persona${n}@example.com`, celular: '999888777',
})
const personas = (cantidad: number, desde = 1) => Array.from({ length: cantidad }, (_, i) => persona(desde + i))

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.$queryRaw.mockResolvedValue([])
    m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m))
    m.estadoInscripcion.findUnique.mockResolvedValue({ id: 1 })
    m.inscripcion.updateMany.mockResolvedValue({ count: 0 })
    m.inscripcion.findMany.mockResolvedValue([])
    m.inscripcion.findFirst.mockResolvedValue(null)
    m.inscripcion.count.mockResolvedValue(0)
    m.inscripcion.create.mockImplementation(async ({ data }: { data: { participanteId: number } }) => ({ id: 100 + data.participanteId }))
    m.participante.findMany.mockResolvedValue([])
    m.participante.create.mockImplementation(async ({ data }: { data: { numeroDocumento: string } }) => participante(Number(data.numeroDocumento) - 70000000, data.numeroDocumento))
    m.delegacionPago.findFirst.mockResolvedValue(null)
    m.delegacionPago.create.mockResolvedValue({})
    m.delegacion.update.mockResolvedValue({})
    m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento })
    m.tokenAcceso.update.mockResolvedValue({})
    m.categoriaInscripcion.findUnique.mockResolvedValue(categoriaDelegaciones())
    aprobarVariasMock.mockResolvedValue([])
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

    it('avisa cuántos faltan para la tarifa promocional', () => {
        expect(faltanParaPromocional(60, 50, 10, 7)).toBe(3)
        expect(faltanParaPromocional(60, 50, 10, 10)).toBeNull()
        // La virtual no tiene escala (estándar = promocional)
        expect(faltanParaPromocional(30, 30, 10, 3)).toBeNull()
    })

    it('aDelegacion calcula el unitario, el total y el saldo', () => {
        const datos = aDelegacion(delegacion as never, 11, [{ monto: 200, estado: 'PENDIENTE' }, { monto: 999, estado: 'RECHAZADO' }])
        expect(datos).toMatchObject({
            id: 5, precioEstandar: 60, precioPromocional: 50, precioUnitario: 50, totalIntegrantes: 11, montoTotal: 550,
            representante: { documento: '70000001', tipoDocumento: 'dni' },
            pago: { totalAPagar: 550, declarado: 200, saldo: 350, cantidad: 2 },
        })
    })
})

describe('tipo y tarifa por modalidad (spec 023)', () => {
    const tipos = { general: tipoGeneral, promocional: tipoPromocional, virtual: tipoVirtual } as never

    it('presencial: General por debajo del mínimo y Promocional desde el mínimo', () => {
        expect(tipoParaGrupo(tipos, { modalidad: 'PRESENCIAL', minIntegrantes: 10 }, 9)).toBe(tipoGeneral)
        expect(tipoParaGrupo(tipos, { modalidad: 'PRESENCIAL', minIntegrantes: 10 }, 10)).toBe(tipoPromocional)
    })

    it('virtual: siempre el tipo virtual, sin escalas', () => {
        expect(tipoParaGrupo(tipos, { modalidad: 'VIRTUAL', minIntegrantes: 10 }, 1)).toBe(tipoVirtual)
        expect(tipoParaGrupo(tipos, { modalidad: 'VIRTUAL', minIntegrantes: 10 }, 40)).toBe(tipoVirtual)
    })

    it('sin el tipo de la modalidad no hay tipo (las inscripciones quedan sin tipo)', () => {
        expect(tipoParaGrupo({ general: null, promocional: null, virtual: null }, { modalidad: 'VIRTUAL', minIntegrantes: 10 }, 5)).toBeNull()
    })

    it('la tarifa virtual es la del tipo para todos; sin el tipo, la modalidad no se ofrece', () => {
        expect(tarifaParaModalidad(evento, tipos, 'VIRTUAL')).toEqual({ minIntegrantes: 10, precioEstandar: 30, precioPromocional: 30 })
        expect(tarifaParaModalidad(evento, { general: null, promocional: null, virtual: null }, 'VIRTUAL')).toBeNull()
    })

    it('la presencial usa los precios de los tipos y, si faltan, los del evento', () => {
        expect(tarifaParaModalidad(evento, tipos, 'PRESENCIAL')).toEqual({ minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50 })
        expect(tarifaParaModalidad(evento, { general: null, promocional: null, virtual: null }, 'PRESENCIAL')).toEqual({ minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50 })
    })
})

describe('resumen de pagos', () => {
    it('un voucher rechazado no cuenta como declarado', () => {
        expect(resumenPagos(500, [
            { monto: new Prisma.Decimal(200), estado: 'VERIFICADO' },
            { monto: 100, estado: 'PENDIENTE' },
            { monto: 999, estado: 'RECHAZADO' },
        ])).toEqual({ totalAPagar: 500, declarado: 300, verificado: 200, saldo: 200, cantidad: 3 })
    })

    it('sin vouchers el saldo es todo el total', () => {
        expect(resumenPagos(450, [])).toMatchObject({ declarado: 0, saldo: 450, cantidad: 0 })
    })
})

describe('API del sitio: tarifa y link', () => {
    it('GET /v1/site/delegations/tarifa entrega la presencial y la virtual desde los tipos', async () => {
        const r = await request(app).get('/api/v1/site/delegations/tarifa').set('X-Api-Key', TOKEN_SITIO)
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50, virtual: { precio: 30 } })
    })

    it('sin el tipo virtual, la virtual es null y la landing no la ofrece', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoriaDelegaciones([tipoGeneral, tipoPromocional]))
        const r = await request(app).get('/api/v1/site/delegations/tarifa').set('X-Api-Key', TOKEN_SITIO)
        expect(r.body.data.virtual).toBeNull()
    })

    it('exige el token de acceso del evento', async () => {
        expect((await request(app).get('/api/v1/site/delegations/tarifa')).status).toBe(401)
    })

    const conGrupo = (extra: Record<string, unknown> = {}) => ({
        ...delegacion, evento, tipoInscripcion: null,
        pagos: [{ id: 1, modalidadPago: 'billetera', banco: null, billeteraDigital: 'yape', tipoOperacion: null, numeroOperacion: 'OP-998877', fechaPago: FECHA, monto: new Prisma.Decimal(200), estado: 'PENDIENTE', motivoRechazo: 'interno', creadoEn: FECHA }],
        inscripciones: [inscripcionDe(1, 1), inscripcionDe(2, 2), inscripcionDe(3, 3, 'RECHAZADO')],
        ...extra,
    })

    it('el delegado ve su grupo con el documento y el voucher enmascarados, sin el contacto', async () => {
        m.delegacion.findUnique.mockResolvedValue(conGrupo())
        const r = await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({
            id: 5, nombre: 'Delegación Ingeniería', institucion: 'UNH', modalidad: 'PRESENCIAL', representanteNombre: 'Rosa Quispe',
            // El rechazado no cuenta como integrante
            totalIntegrantes: 2, precioUnitario: 60, montoTotal: 120, faltanParaPromocional: 8,
            pago: { totalAPagar: 120, declarado: 200, saldo: -80 },
            evento: { id: 2, codigo: 'ciisic-2026' },
        })
        expect(r.body.data.integrantes).toHaveLength(2)
        expect(r.body.data.integrantes[0].documento).toBe('****0001')
        expect(r.body.data.pagos).toEqual([expect.objectContaining({ numeroOperacion: '****8877', medio: 'yape', monto: 200, estado: 'PENDIENTE' })])
        const texto = JSON.stringify(r.body.data)
        expect(texto).not.toContain('rosa@unh.edu.pe')
        expect(texto).not.toContain('999888777')
        expect(texto).not.toContain('interno')
        expect(texto).not.toContain('OP-998877')
    })

    it('un link de otro evento, inactivo o inexistente responde 404', async () => {
        m.delegacion.findUnique.mockResolvedValueOnce(conGrupo({ eventoId: 7 }))
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        m.delegacion.findUnique.mockResolvedValueOnce(conGrupo({ activo: false }))
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        m.delegacion.findUnique.mockResolvedValueOnce(null)
        expect((await request(app).get('/api/v1/site/delegations/link/nada').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
    })
})

describe('administración: alta de una delegación', () => {
    const representante = { nombres: 'Rosa', apellidos: 'Quispe', tipoDocumento: 'dni', numeroDocumento: '70000001', correo: 'rosa@unh.edu.pe', celular: '999888777' }

    beforeEach(() => {
        // El código del link no existe todavía; la delegación creada sí se puede leer por id
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => (where.codigoLink ? null : completa()))
        m.delegacion.create.mockResolvedValue(delegacion)
    })

    it('el Administrador crea la delegación con link único, el delegado y la tarifa de los tipos', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación Ingeniería', institucion: 'UNH', representante })
        expect(r.status).toBe(201)
        const datos = m.delegacion.create.mock.calls[0][0].data
        expect(datos.codigoLink).toMatch(/^[0-9a-f]{16}$/)
        expect(datos).toMatchObject({
            modalidad: 'PRESENCIAL', minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50,
            representanteNombre: 'Rosa Quispe', representanteEmail: 'rosa@unh.edu.pe', representanteTelefono: '999888777',
            representanteTipoDocumento: 'dni', representanteDocumento: '70000001',
        })
    })

    it('una delegación virtual copia la tarifa única del tipo virtual', async () => {
        m.delegacion.create.mockResolvedValue(delegacionVirtual)
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación UNAT', modalidad: 'VIRTUAL', representante })
        expect(r.status).toBe(201)
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', precioEstandar: 30, precioPromocional: 30 })
    })

    it('la virtual no se ofrece mientras el evento no tenga su tipo', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoriaDelegaciones([tipoGeneral, tipoPromocional]))
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación UNAT', modalidad: 'VIRTUAL', representante })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_MODALITY_NOT_AVAILABLE')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('con integrantes en el alta los inscribe y marca el tipo del grupo', async () => {
        m.inscripcion.count.mockResolvedValue(3)
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación Ingeniería', representante: { ...representante, esIntegrante: true }, participantes: personas(2, 2) })
        expect(r.status).toBe(201)
        // El delegado más sus dos integrantes: 3 inscripciones nuevas
        expect(m.inscripcion.create).toHaveBeenCalledTimes(3)
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 60, tipoInscripcionId: 31 })
    })

    it('el delegado es obligatorio (documento, correo y celular)', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador()).send({ nombre: 'Delegación' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('rechaza un precio promocional mayor que el estándar', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ nombre: 'Delegación', representante, precioEstandar: 50, precioPromocional: 60 })
        expect(r.status).toBe(422)
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('un Tesorero con alcance por evento no gestiona delegaciones', async () => {
        const token = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', `Bearer ${token}`).send({ nombre: 'Delegación', representante })
        expect(r.status).toBe(403)
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })
})

describe('administración: integrantes del grupo', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa())
    })

    const cargar = (participantes: unknown[]) => request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', administrador()).send({ participantes })

    it('con 9 integrantes cobra el precio estándar y el tipo General', async () => {
        m.inscripcion.count.mockResolvedValue(9)
        const r = await cargar(personas(9))
        expect(r.status).toBe(201)
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 60, descuento: 0, tieneDescuento: false, tipoInscripcionId: 31 })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ tipoInscripcionId: 31 })
    })

    it('al llegar a 10 todos pasan al precio promocional y al tipo Promocional', async () => {
        m.inscripcion.count.mockResolvedValue(10)
        const r = await cargar(personas(1))
        expect(r.status).toBe(201)
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 50, descuento: 10, tieneDescuento: true, tipoInscripcionId: 32 })
        // Reprecia a todo el grupo, no solo a los nuevos
        expect(m.inscripcion.updateMany.mock.calls[0][0].where).toMatchObject({ delegacionId: 5, eventoId: 2 })
    })

    it('el recuento ignora a los rechazados y cancelados', async () => {
        m.inscripcion.count.mockResolvedValue(4)
        await cargar(personas(1))
        expect(m.inscripcion.count.mock.calls[0][0].where).toMatchObject({ delegacionId: 5, estado: { codigo: { notIn: ['RECHAZADO', 'CANCELADO'] } } })
    })

    it('una delegación virtual cobra S/ 30 a todos, sean 3 o 30', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa(delegacionVirtual))
        m.inscripcion.count.mockResolvedValue(30)
        const r = await request(app).post('/api/v1/delegations/6/inscriptions').set('Authorization', administrador()).send({ participantes: personas(1) })
        expect(r.status).toBe(201)
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 30, descuento: 0, tipoInscripcionId: 33 })
    })

    it('los integrantes nacen pendientes, con credencial propia y un código interno de pago', async () => {
        m.inscripcion.count.mockResolvedValue(1)
        await cargar(personas(1))
        const datos = m.inscripcion.create.mock.calls[0][0].data
        expect(datos).toMatchObject({ delegacionId: 5, estadoId: 1, modalidadPago: 'delegacion' })
        expect(datos.numeroOperacion).toMatch(/^DELEGACION-/)
        expect(datos.codigoCredencial).toHaveLength(10)
    })

    it('reenviar la misma lista omite a quien ya estaba, sin duplicar', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 11, participanteId: 1, delegacionId: 5, estado: { codigo: 'PENDIENTE' } }])
        m.inscripcion.count.mockResolvedValue(1)
        const r = await cargar(personas(1))
        expect(r.status).toBe(201)
        expect(r.body.data.omitidos).toBe(1)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('quien tenía la inscripción rechazada se reutiliza y vuelve a contar', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.participante.update.mockResolvedValue(participante(1, '70000001'))
        m.inscripcion.findMany.mockResolvedValue([{ id: 11, participanteId: 1, delegacionId: 5, estado: { codigo: 'RECHAZADO' } }])
        m.inscripcion.update.mockResolvedValue({ id: 11 })
        m.inscripcion.count.mockResolvedValue(1)
        const r = await cargar(personas(1))
        expect(r.status).toBe(201)
        expect(m.inscripcion.update.mock.calls[0][0]).toMatchObject({ where: { id: 11 }, data: { estadoId: 1, motivoRechazo: null } })
    })

    it('rechaza documentos repetidos en la misma carga antes de escribir', async () => {
        const r = await cargar([persona(1), { ...persona(2), numeroDocumento: persona(1).numeroDocumento }])
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DUPLICATE_PARTICIPANT')
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('rechaza el correo de otra persona', async () => {
        m.participante.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...participante(9, '99999999'), correo: persona(1).correo }])
        const r = await cargar(personas(1))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('EMAIL_IN_USE')
    })

    it('rechaza a quien ya está inscrito en el evento fuera de la delegación', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 11, participanteId: 1, delegacionId: null, estado: { codigo: 'APROBADO' } }])
        const r = await cargar(personas(1))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PARTICIPANT_ALREADY_REGISTERED')
    })

    it('una delegación inactiva no recibe integrantes', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa(delegacion, { activo: false }))
        const r = await cargar(personas(1))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DELEGATION_INACTIVE')
    })
})

describe('administración: quitar un integrante y aprobar al grupo', () => {
    it('quita a un integrante pendiente y recalcula el grupo', async () => {
        m.delegacion.findUnique.mockResolvedValue({ ...delegacion, evento, tipoInscripcion: null, pagos: [], inscripciones: [] })
        m.inscripcion.findFirst.mockResolvedValue({ id: 11, estado: { codigo: 'PENDIENTE' } })
        m.inscripcion.count.mockResolvedValue(9)
        const r = await request(app).delete('/api/v1/delegations/5/inscriptions/11').set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(m.inscripcion.delete).toHaveBeenCalledWith({ where: { id: 11 } })
        // Con 9 vuelve al precio estándar para todos
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 60, tipoInscripcionId: 31 })
    })

    it('un integrante aprobado no se quita: se cancela desde Inscripciones', async () => {
        m.inscripcion.findFirst.mockResolvedValue({ id: 11, estado: { codigo: 'APROBADO' } })
        const r = await request(app).delete('/api/v1/delegations/5/inscriptions/11').set('Authorization', administrador())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INSCRIPTION_NOT_REMOVABLE')
        expect(m.inscripcion.delete).not.toHaveBeenCalled()
    })

    it('un integrante de otra delegación responde 404', async () => {
        m.inscripcion.findFirst.mockResolvedValue(null)
        const r = await request(app).delete('/api/v1/delegations/5/inscriptions/99').set('Authorization', administrador())
        expect(r.status).toBe(404)
    })

    const grupo = (estados: string[]) => ({
        ...delegacion, evento, tipoInscripcion: null, pagos: [],
        inscripciones: estados.map((estado, i) => ({ ...inscripcionDe(i + 1, i + 1, estado), participante: participante(i + 1, `7000000${i}`) })),
    })

    it('aprueba solo a los integrantes por revisar', async () => {
        m.delegacion.findUnique.mockResolvedValue(grupo(['PENDIENTE', 'APROBADO', 'EN_REVISION', 'RECHAZADO']))
        aprobarVariasMock.mockResolvedValue([1, 3])
        const r = await request(app).post('/api/v1/delegations/5/approve').set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(aprobarVariasMock).toHaveBeenCalledWith([1, 3], 2)
        expect(r.body.data).toMatchObject({ aprobadas: 2, credencialesEnSegundoPlano: 2 })
    })

    it('sin integrantes por aprobar responde 409', async () => {
        m.delegacion.findUnique.mockResolvedValue(grupo(['APROBADO', 'RECHAZADO']))
        const r = await request(app).post('/api/v1/delegations/5/approve').set('Authorization', administrador())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('NOTHING_TO_APPROVE')
        expect(aprobarVariasMock).not.toHaveBeenCalled()
    })

    it('el Tesorero de sus eventos también aprueba al grupo', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => (select?.eventoId ? { eventoId: 2 } : grupo(['PENDIENTE'])))
        aprobarVariasMock.mockResolvedValue([1])
        const tesorero = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).post('/api/v1/delegations/5/approve').set('Authorization', `Bearer ${tesorero}`)
        expect(r.status).toBe(200)
    })
})

describe('administración: edición de la delegación', () => {
    it('cambiar la modalidad con integrantes responde 409', async () => {
        m.delegacion.findUnique.mockResolvedValue({ ...delegacion, evento })
        m.inscripcion.count.mockResolvedValue(3)
        const r = await request(app).put('/api/v1/delegations/5').set('Authorization', administrador()).send({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DELEGATION_MODALITY_LOCKED')
        expect(m.delegacion.update).not.toHaveBeenCalled()
    })

    it('sin integrantes la modalidad cambia y la delegación copia la tarifa virtual', async () => {
        m.delegacion.findUnique.mockResolvedValue({ ...delegacion, evento, tipoInscripcion: null, pagos: [], inscripciones: [] })
        const r = await request(app).put('/api/v1/delegations/5').set('Authorization', administrador()).send({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', precioEstandar: 30, precioPromocional: 30 })
    })

    it('editar el nombre y el delegado no reprecia al grupo', async () => {
        m.delegacion.findUnique.mockResolvedValue({ ...delegacion, evento, tipoInscripcion: null, pagos: [], inscripciones: [] })
        const r = await request(app).put('/api/v1/delegations/5').set('Authorization', administrador())
            .send({ nombre: 'Nuevo nombre', representante: { nombres: 'Ana', apellidos: 'Ríos', tipoDocumento: 'dni', numeroDocumento: '70000009', correo: 'ana@unh.edu.pe', celular: '999000111' } })
        expect(r.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data).toMatchObject({ nombre: 'Nuevo nombre', representanteDocumento: '70000009', representanteEmail: 'ana@unh.edu.pe' })
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })
})

describe('vouchers de la delegación (panel)', () => {
    const pagos = (cantidad: number) => Array.from({ length: cantidad }, (_, i) => ({
        modalidadPago: 'billetera', billeteraDigital: 'yape', numeroOperacion: `OP-${1000 + i}`, fechaPago: '2026-10-15', monto: 250,
    }))

    beforeEach(() => {
        m.delegacion.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => (
            select?.eventoId && !select?.codigoLink ? { id: 5, eventoId: 2 } : { ...delegacion, evento, tipoInscripcion: null, pagos: [], inscripciones: [] }
        ))
    })

    function subir(lista: unknown[], archivos: number, url = '/api/v1/delegations/5/payments') {
        const peticion = request(app).post(url).set('Authorization', administrador()).field('pagos', JSON.stringify(lista))
        for (let i = 0; i < archivos; i++) peticion.attach('vouchers', PDF, { filename: `v${i}.pdf`, contentType: 'application/pdf' })
        return peticion
    }

    it('guarda varios vouchers, cada uno con su archivo, número y monto', async () => {
        const r = await subir(pagos(2), 2)
        expect(r.status).toBe(201)
        expect(m.delegacionPago.create).toHaveBeenCalledTimes(2)
        const [primero, segundo] = m.delegacionPago.create.mock.calls.map((llamada) => llamada[0].data)
        expect(primero).toMatchObject({ delegacionId: 5, eventoId: 2, numeroOperacion: 'OP-1000', monto: 250, billeteraDigital: 'yape' })
        expect(segundo.numeroOperacion).toBe('OP-1001')
        expect(primero.voucherArchivo).toMatch(/^voucher-.*\.pdf$/)
        expect(segundo.voucherArchivo).not.toBe(primero.voucherArchivo)
    })

    it('exige un archivo por cada pago', async () => {
        const r = await subir(pagos(2), 1)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VOUCHER_REQUIRED')
        expect(m.delegacionPago.create).not.toHaveBeenCalled()
    })

    it('rechaza un archivo cuyo contenido no es el declarado', async () => {
        const peticion = request(app).post('/api/v1/delegations/5/payments').set('Authorization', administrador()).field('pagos', JSON.stringify(pagos(1)))
        const r = await peticion.attach('vouchers', Buffer.from('no soy un pdf'), { filename: 'falso.pdf', contentType: 'application/pdf' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('INVALID_FILE_CONTENT')
    })

    it('rechaza un número de operación que ya existe en el evento', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 3 })
        const r = await subir(pagos(1), 1)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
        expect(m.delegacionPago.create).not.toHaveBeenCalled()
    })

    it('rechaza el mismo número repetido dentro del envío', async () => {
        const repetidos = [pagos(1)[0], { ...pagos(1)[0] }]
        const r = await subir(repetidos, 2)
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
    })

    it('rechaza una fecha de pago futura y un monto en cero', async () => {
        const futura = await subir([{ ...pagos(1)[0], fechaPago: '2999-01-01' }], 1)
        expect(futura.status).toBe(422)
        const cero = await subir([{ ...pagos(1)[0], monto: 0 }], 1)
        expect(cero.status).toBe(422)
    })

    it('el Tesorero (con «inscripciones.validar») verifica o rechaza un voucher', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5 })
        m.delegacionPago.update.mockResolvedValue({ id: 8, estado: 'RECHAZADO', monto: new Prisma.Decimal(250), fechaPago: FECHA, motivoRechazo: 'Monto distinto', creadoEn: FECHA })
        const tesorero = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).patch('/api/v1/delegations/5/payments/8').set('Authorization', `Bearer ${tesorero}`).send({ estado: 'RECHAZADO', motivo: 'Monto distinto' })
        expect(r.status).toBe(200)
        expect(m.delegacionPago.update.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Monto distinto', revisadoPorId: 30 })
    })

    it('devolver un voucher a pendiente limpia la revisión', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5 })
        m.delegacionPago.update.mockResolvedValue({ id: 8, estado: 'PENDIENTE', monto: new Prisma.Decimal(250), fechaPago: FECHA, creadoEn: FECHA })
        await request(app).patch('/api/v1/delegations/5/payments/8').set('Authorization', administrador()).send({ estado: 'PENDIENTE' })
        expect(m.delegacionPago.update.mock.calls[0][0].data).toEqual({ estado: 'PENDIENTE', motivoRechazo: null, revisadoEn: null, revisadoPorId: null })
    })

    it('un voucher verificado no se elimina', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, estado: 'VERIFICADO', voucherArchivo: 'voucher-8.pdf' })
        const r = await request(app).delete('/api/v1/delegations/5/payments/8').set('Authorization', administrador())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PAYMENT_VERIFIED')
        expect(m.delegacionPago.delete).not.toHaveBeenCalled()
    })

    it('un voucher pendiente se elimina', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, estado: 'PENDIENTE', voucherArchivo: 'voucher-8.pdf' })
        const r = await request(app).delete('/api/v1/delegations/5/payments/8').set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(m.delegacionPago.delete).toHaveBeenCalledWith({ where: { id: 8 } })
    })

    it('el voucher también lo ve quien solo tiene «pagos.ver»; sin ese permiso, 403', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, voucherArchivo: 'voucher-8.png' })
        const tesorero = tokenDeRol('TESORERO', 30, { eventoIds: [2] })
        const r = await request(app).get('/api/v1/delegations/5/payments/8/voucher').set('Authorization', `Bearer ${tesorero}`)
        // La guarda pasó: el 404 es porque el archivo no está en el servidor
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('VOUCHER_NOT_FOUND')

        const sinPagos = tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['inscripciones.ver'] })
        const prohibido = await request(app).get('/api/v1/delegations/5/payments/8/voucher').set('Authorization', `Bearer ${sinPagos}`)
        expect(prohibido.status).toBe(403)
    })
})

describe('registro público de una delegación (specs 021 y 023)', () => {
    const representante = {
        nombres: 'Rosa', apellidos: 'Quispe', tipoDocumento: 'dni', numeroDocumento: '70000001',
        correo: 'rosa@unh.edu.pe', celular: '999888777', esIntegrante: true,
    }
    const pagoDe = (numero: string, monto = 300) => ({
        modalidadPago: 'billetera', billeteraDigital: 'yape', numeroOperacion: numero, fechaPago: '2026-10-15', monto,
    })

    /** El cuerpo del formulario (multipart: el JSON va como texto en cada campo). */
    function cuerpo(extra: Record<string, unknown> = {}) {
        return {
            delegacion: JSON.stringify({ nombre: 'Ing. de Sistemas UNH', institucion: 'UNH' }),
            representante: JSON.stringify(representante),
            participantes: JSON.stringify(personas(2, 2)),
            pagos: JSON.stringify([pagoDe('OP-12345')]),
            modalidad: 'PRESENCIAL',
            ...extra,
        }
    }

    function registrar(extra: Record<string, unknown> = {}, archivos = 1) {
        const peticion = request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO)
        for (const [campo, valor] of Object.entries(cuerpo(extra))) peticion.field(campo, String(valor))
        for (let i = 0; i < archivos; i++) peticion.attach('vouchers', PDF, { filename: `voucher${i}.pdf`, contentType: 'application/pdf' })
        return peticion
    }

    let creada: Record<string, unknown>

    beforeEach(() => {
        creada = { ...delegacion, id: 77, nombre: 'Ing. de Sistemas UNH' }
        // `findUnique` busca el código del link (no existe), lee la delegación y arma la vista pública
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string, id?: number } }) => {
            if (where.codigoLink && where.codigoLink !== creada.codigoLink) return null
            return { ...creada, evento, tipoInscripcion: null, pagos: [], inscripciones: [] }
        })
        m.delegacion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            creada = { ...creada, ...data, id: 77 }
            return creada
        })
        m.inscripcion.count.mockResolvedValue(3)
    })

    it('registra al delegado y su grupo, con la modalidad y todos los vouchers, en una transacción', async () => {
        const r = await registrar({ pagos: JSON.stringify([pagoDe('OP-1', 100), pagoDe('OP-2', 80)]) }, 2)
        expect(r.status).toBe(201)
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({
            eventoId: 2, nombre: 'Ing. de Sistemas UNH', modalidad: 'PRESENCIAL', representanteDocumento: '70000001', representanteEmail: 'rosa@unh.edu.pe',
            minIntegrantes: 10, precioEstandar: 60, precioPromocional: 50,
        })
        // Delegado integrante + 2 más
        expect(m.inscripcion.create).toHaveBeenCalledTimes(3)
        expect(m.delegacionPago.create).toHaveBeenCalledTimes(2)
        expect(m.$transaction).toHaveBeenCalled()
        expect(r.body.data).toMatchObject({ registrados: 3, omitidos: 0 })
    })

    it('el delegado va primero en la lista de integrantes', async () => {
        await registrar()
        expect(m.participante.create.mock.calls[0][0].data.numeroDocumento).toBe('70000001')
    })

    it('si el delegado no es integrante, no entra en la lista', async () => {
        await registrar({ representante: JSON.stringify({ ...representante, esIntegrante: false }) })
        expect(m.participante.create).toHaveBeenCalledTimes(2)
        expect(m.participante.create.mock.calls.map((llamada) => llamada[0].data.numeroDocumento)).not.toContain('70000001')
    })

    it('el cliente no manda precios: se ignoran los montos que envíe', async () => {
        await registrar({ precioUnitario: '1', montoTotal: '1', tipoInscripcionId: '33' })
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({ precioEstandar: 60, precioPromocional: 50 })
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 60, tipoInscripcionId: 31 })
    })

    it('una delegación de 10 o más paga el precio promocional y lleva el tipo Promocional', async () => {
        m.inscripcion.count.mockResolvedValue(10)
        await registrar({ participantes: JSON.stringify(personas(9, 2)) })
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 50, descuento: 10, tipoInscripcionId: 32 })
    })

    it('la modalidad virtual cobra S/ 30 y lleva el tipo Virtual', async () => {
        m.inscripcion.count.mockResolvedValue(3)
        const r = await registrar({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(201)
        expect(m.delegacion.create.mock.calls[0][0].data).toMatchObject({ modalidad: 'VIRTUAL', precioEstandar: 30, precioPromocional: 30 })
        expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 30, tipoInscripcionId: 33 })
    })

    it('la modalidad virtual responde 422 si el evento aún no tiene su tipo', async () => {
        m.categoriaInscripcion.findUnique.mockResolvedValue(categoriaDelegaciones([tipoGeneral, tipoPromocional]))
        const r = await registrar({ modalidad: 'VIRTUAL' })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_MODALITY_NOT_AVAILABLE')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('exige el token de acceso del evento', async () => {
        const r = await request(app).post('/api/v1/site/delegations').field('delegacion', '{}')
        expect(r.status).toBe(401)
    })

    it('exige un archivo por cada voucher', async () => {
        const r = await registrar({ pagos: JSON.stringify([pagoDe('OP-1'), pagoDe('OP-2')]) }, 1)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VOUCHER_REQUIRED')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('exige al menos un voucher', async () => {
        const r = await registrar({ pagos: JSON.stringify([]) }, 0)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })

    it('exige al menos un integrante', async () => {
        const r = await registrar({ representante: JSON.stringify({ ...representante, esIntegrante: false }), participantes: JSON.stringify([]) })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('NO_PARTICIPANTS')
    })

    it('cierra el registro cuando las inscripciones del evento están cerradas', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento: { ...evento, inscripcionesAbiertas: false } })
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('REGISTRATION_CLOSED')
    })

    it('rechaza un número de operación ya registrado en el evento', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 1 })
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('rechaza un número que ya usó una inscripción individual', async () => {
        m.inscripcion.findFirst.mockResolvedValue({ id: 4 })
        const r = await registrar()
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('OPERATION_ALREADY_REGISTERED')
    })

    it('si falla al escribir, borra la delegación creada para no dejar un grupo a medias', async () => {
        m.$transaction.mockRejectedValueOnce(new Error('falla'))
        const r = await registrar()
        expect(r.status).toBe(500)
        expect(m.delegacion.delete).toHaveBeenCalledWith({ where: { id: 77 } })
    })

    describe('con el link de una delegación que el staff ya creó', () => {
        beforeEach(() => {
            creada = { ...delegacion, id: 5 }
            m.delegacion.findUnique.mockImplementation(async () => ({ ...creada, evento, tipoInscripcion: null, pagos: [], inscripciones: [] }))
        })

        it('se suma a esa delegación (su tarifa y su modalidad), sin crear otra', async () => {
            const r = await registrar({ codigoLink: 'abc123def456', modalidad: 'VIRTUAL' })
            expect(r.status).toBe(201)
            expect(m.delegacion.create).not.toHaveBeenCalled()
            // La modalidad de la delegación manda, no la del cuerpo
            expect(m.inscripcion.updateMany.mock.calls[0][0].where).toMatchObject({ delegacionId: 5 })
            expect(m.inscripcion.updateMany.mock.calls[0][0].data).toMatchObject({ monto: 60, tipoInscripcionId: 31 })
            expect(m.delegacionPago.create.mock.calls[0][0].data).toMatchObject({ delegacionId: 5 })
        })

        it('un link de otro evento, de una delegación inactiva o inexistente responde 404', async () => {
            creada = { ...delegacion, eventoId: 7 }
            expect((await registrar({ codigoLink: 'abc123def456' })).status).toBe(404)
            creada = { ...delegacion, activo: false }
            expect((await registrar({ codigoLink: 'abc123def456' })).status).toBe(404)
        })

        it('no borra la delegación del staff si el registro falla', async () => {
            m.$transaction.mockRejectedValueOnce(new Error('falla'))
            await registrar({ codigoLink: 'abc123def456' })
            expect(m.delegacion.delete).not.toHaveBeenCalled()
        })
    })
})

describe('el delegado agrega con su link (solo agrega)', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockImplementation(async () => ({ ...delegacion, evento, tipoInscripcion: null, pagos: [], inscripciones: [] }))
        m.inscripcion.count.mockResolvedValue(5)
    })

    it('suma integrantes y recalcula la tarifa del grupo', async () => {
        const r = await request(app).post('/api/v1/site/delegations/link/abc123def456/participants').set('X-Api-Key', TOKEN_SITIO).send({ participantes: personas(2) })
        expect(r.status).toBe(201)
        expect(m.inscripcion.create).toHaveBeenCalledTimes(2)
        expect(r.body.data).toMatchObject({ registrados: 2, omitidos: 0 })
    })

    it('no suma integrantes a un link de otro evento', async () => {
        m.delegacion.findUnique.mockImplementation(async () => ({ ...delegacion, eventoId: 7 }))
        const r = await request(app).post('/api/v1/site/delegations/link/abc123def456/participants').set('X-Api-Key', TOKEN_SITIO).send({ participantes: personas(1) })
        expect(r.status).toBe(404)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('con las inscripciones cerradas no suma integrantes', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento: { ...evento, inscripcionesAbiertas: false } })
        const r = await request(app).post('/api/v1/site/delegations/link/abc123def456/participants').set('X-Api-Key', TOKEN_SITIO).send({ participantes: personas(1) })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('REGISTRATION_CLOSED')
    })

    it('suma vouchers a su delegación', async () => {
        const r = await request(app).post('/api/v1/site/delegations/link/abc123def456/payments').set('X-Api-Key', TOKEN_SITIO)
            .field('pagos', JSON.stringify([{ modalidadPago: 'banco', banco: 'bcp', tipoOperacion: 'directo', numeroOperacion: 'BCP-9999', fechaPago: '2026-10-16', monto: 120 }]))
            .attach('vouchers', PDF, { filename: 'v.pdf', contentType: 'application/pdf' })
        expect(r.status).toBe(201)
        expect(m.delegacionPago.create.mock.calls[0][0].data).toMatchObject({ delegacionId: 5, eventoId: 2, banco: 'bcp', tipoOperacion: 'directo', numeroOperacion: 'BCP-9999', monto: 120 })
    })

    it('no hay rutas para que el delegado borre integrantes ni vouchers', async () => {
        const borrarIntegrante = await request(app).delete('/api/v1/site/delegations/link/abc123def456/participants/1').set('X-Api-Key', TOKEN_SITIO)
        const borrarPago = await request(app).delete('/api/v1/site/delegations/link/abc123def456/payments/1').set('X-Api-Key', TOKEN_SITIO)
        expect(borrarIntegrante.status).toBe(404)
        expect(borrarPago.status).toBe(404)
    })
})

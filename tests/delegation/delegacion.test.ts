import { Prisma } from '@prisma/client'
import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { aDelegacion } from '../../src/api/delegation/services/delegation'
import { faltanParaPromocional, nombreDeTipo, planesOrdenados, precioUnitario, resultadoDePlan } from '../../src/api/delegation/services/planes'
import { resumenPagos } from '../../src/api/delegation/services/pagos'
import { aprobarVarias } from '../../src/api/inscription/services/inscription'
import { tokenDeRol } from '../helpers/tokens'
import { TOKEN_SITIO } from '../helpers/sitio'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        tokenAcceso: { findUnique: jest.fn(), update: jest.fn() },
        delegacion: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        delegacionPago: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        inscripcion: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), groupBy: jest.fn() },
        participante: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        estadoInscripcion: { findUnique: jest.fn() },
        categoriaInscripcion: { create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
        tipoInscripcion: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
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
    delegacion: { findUnique: Mock, findFirst: Mock, findMany: Mock, create: Mock, update: Mock, delete: Mock }
    delegacionPago: { findFirst: Mock, findMany: Mock, create: Mock, update: Mock, delete: Mock }
    inscripcion: { findFirst: Mock, findMany: Mock, count: Mock, create: Mock, update: Mock, updateMany: Mock, delete: Mock, groupBy: Mock }
    participante: { findMany: Mock, create: Mock, update: Mock }
    estadoInscripcion: { findUnique: Mock }
    categoriaInscripcion: { create: Mock, updateMany: Mock, deleteMany: Mock }
    tipoInscripcion: { create: Mock, update: Mock, updateMany: Mock, deleteMany: Mock }
    $queryRaw: Mock
    $transaction: Mock
}
const aprobarVariasMock = aprobarVarias as unknown as Mock

const FECHA = new Date('2026-10-18T12:00:00Z')
const administrador = () => `Bearer ${tokenDeRol('ADMIN')}`
const tesorero = () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}`
/** La Comisión elegida para inscribir (sin `pagos.ver`). */
const comision = (permisos: string[] = ['delegaciones.inscribir']) => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos })}`

const evento = {
    id: 2, codigo: 'ciisic-2026', nombre: 'VIII CIISIC', nombreCorto: 'VIII CIISIC', descripcion: null, sede: null,
    fechaInicio: FECHA, fechaFin: FECHA, inscripcionesInicio: null, inscripcionesFin: null, inscripcionesAbiertas: true,
    estado: 'PUBLICADO', esPrincipal: true, dominioInstitucional: 'undc.edu.pe', correoContacto: null, telefonoContacto: null,
    remitenteNombre: null, asuntoAprobacion: null, logoArchivo: null, datosPago: null, credencialCorreoId: null,
    creadoEn: FECHA, actualizadoEn: FECHA,
}

/** Un plan de la delegación 5: tipo de su categoría oculta. */
const plan = (id: number, codigo: string, etiqueta: string, modalidad: string, precio: number, activo = true, promocional: number | null = null) => ({
    id, categoriaId: 9, codigo, nombre: 'DELEGACION DELEGACIÓN INGENIERÍA', etiqueta, descripcion: null, caracteristicas: null,
    precio: new Prisma.Decimal(precio), precioInstitucional: new Prisma.Decimal(precio),
    precioPromocional: promocional === null ? null : new Prisma.Decimal(promocional),
    disponiblePara: 'TODOS', modalidad, excluyeEstudiantesUndc: false, activo, orden: id - 30,
})
const conKit = plan(31, 'delegacion_con_kit', 'CON KIT', 'PRESENCIAL', 80)
const sinKit = plan(32, 'delegacion_sin_kit', 'SIN KIT', 'PRESENCIAL', 60, true, 50)
const virtual = plan(33, 'delegacion_virtual', 'VIRTUAL', 'VIRTUAL', 30)
const categoria = (tipos: unknown[] = [conKit, sinKit, virtual]) => ({ id: 9, eventoId: 2, codigo: 'DELEGACION_5', nombre: 'Delegación Ingeniería', delegacionId: 5, tipos })

const delegacion = {
    id: 5, eventoId: 2, nombre: 'Delegación Ingeniería', codigoLink: 'abc123def456', codigoInscripcion: 'ind0123456789abcd', dominioCorreo: null,
    institucion: 'UNH', representanteNombre: 'Rosa Quispe', representanteEmail: 'rosa@unh.edu.pe', representanteTelefono: '999888777',
    representanteTipoDocumento: 'dni', representanteDocumento: '70000001', minIntegrantes: 10, activo: true, creadoEn: FECHA, actualizadoEn: FECHA,
}
/** Delegación con todo lo que leen los servicios (planes, evento, pagos e inscripciones). */
const completa = (extra: Record<string, unknown> = {}) => ({ ...delegacion, planes: categoria(), evento, pagos: [], inscripciones: [], ...extra })

const participante = (id: number, documento: string, correo = `persona${id}@example.com`) => ({
    id, tipoDocumentoId: 'dni', numeroDocumento: documento, nombres: `Nombre ${id}`, apellidos: `Apellido ${id}`,
    correo, celular: '999888777', googleSub: null, googleVinculadoEn: null,
    fotoArchivo: null, fotoActualizadaEn: null, creadoEn: FECHA, actualizadoEn: FECHA,
})

const inscripcionDe = (id: number, participanteId: number, estado = 'PENDIENTE', tipoInscripcionId = 32, monto = 60) => ({
    id, participanteId, delegacionId: 5, tipoInscripcionId, participante: participante(participanteId, String(participanteId).padStart(8, '0')),
    estado: { id: 1, codigo: estado, nombre: estado }, monto: new Prisma.Decimal(monto), creadoEn: FECHA,
})

const PDF = Buffer.from('%PDF-1.4\n%test\n')

const persona = (n: number, extra: Record<string, unknown> = {}) => ({
    tipoDocumento: 'dni', numeroDocumento: String(70000000 + n), nombres: `Persona${n}`, apellidos: `Apellido${n}`,
    correo: `persona${n}@example.com`, celular: '999888777', ...extra,
})

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
    m.inscripcion.groupBy.mockResolvedValue([])
    m.inscripcion.update.mockResolvedValue({ id: 10 })
    m.inscripcion.create.mockImplementation(async ({ data }: { data: { participanteId: number } }) => ({ id: 100 + data.participanteId }))
    m.participante.findMany.mockResolvedValue([])
    m.participante.create.mockImplementation(async ({ data }: { data: { numeroDocumento: string, correo: string } }) => participante(Number(data.numeroDocumento) - 70000000, data.numeroDocumento, data.correo))
    m.delegacionPago.findFirst.mockResolvedValue(null)
    m.delegacionPago.create.mockResolvedValue({})
    m.delegacion.update.mockResolvedValue({})
    m.delegacion.findFirst.mockResolvedValue(null)
    m.categoriaInscripcion.create.mockResolvedValue(categoria([]))
    m.categoriaInscripcion.updateMany.mockResolvedValue({ count: 1 })
    m.categoriaInscripcion.deleteMany.mockResolvedValue({ count: 1 })
    m.tipoInscripcion.deleteMany.mockResolvedValue({ count: 3 })
    m.delegacion.delete.mockResolvedValue({})
    m.participante.update.mockResolvedValue(participante(1, '70000001'))
    m.tipoInscripcion.create.mockResolvedValue({})
    m.tipoInscripcion.update.mockResolvedValue({})
    m.tipoInscripcion.updateMany.mockResolvedValue({ count: 3 })
    m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento })
    m.tokenAcceso.update.mockResolvedValue({})
    aprobarVariasMock.mockResolvedValue([])
})

describe('precio por persona de un plan', () => {
    it.each([
        [0, 60], [1, 60], [9, 60], [10, 50], [11, 50], [100, 50],
    ])('con %i integrantes un plan con promocional cobra %i', (total, esperado) => {
        expect(precioUnitario(60, 50, 10, total)).toBe(esperado)
    })

    it('sin precio promocional el plan cobra siempre su precio', () => {
        expect(precioUnitario(80, null, 10, 40)).toBe(80)
    })

    it('un promocional que no rebaja no cuenta como escala', () => {
        expect(precioUnitario(60, 60, 10, 40)).toBe(60)
        expect(precioUnitario(60, 70, 10, 40)).toBe(60)
    })

    it('respeta el mínimo de cada delegación', () => {
        expect(precioUnitario(80, 65, 5, 4)).toBe(80)
        expect(precioUnitario(80, 65, 5, 5)).toBe(65)
    })

    it('avisa cuántos faltan solo si algún plan activo tiene escala', () => {
        expect(faltanParaPromocional([conKit, sinKit, virtual] as never, 10, 7)).toBe(3)
        expect(faltanParaPromocional([conKit, sinKit, virtual] as never, 10, 10)).toBeNull()
        expect(faltanParaPromocional([conKit, virtual] as never, 10, 3)).toBeNull()
        // Un plan apagado no cuenta
        expect(faltanParaPromocional([conKit, { ...sinKit, activo: false }] as never, 10, 3)).toBeNull()
    })
})

describe('reglas de un plan', () => {
    it('un plan activo necesita un precio mayor que cero', () => {
        expect(() => resultadoDePlan(null, { activo: true })).toThrow(expect.objectContaining({ status: 409, code: 'INVALID_PRICES' }))
        expect(resultadoDePlan(null, { activo: true, precio: 80 })).toEqual({ precio: 80, promocional: null, activo: true })
    })

    it('el promocional no supera al precio y se puede quitar con null', () => {
        expect(() => resultadoDePlan(sinKit as never, { precioPromocional: 70 })).toThrow(expect.objectContaining({ code: 'INVALID_PRICES' }))
        expect(resultadoDePlan(sinKit as never, { precioPromocional: null })).toEqual({ precio: 60, promocional: null, activo: true })
        // Lo que no llega se conserva
        expect(resultadoDePlan(sinKit as never, { precio: 70 })).toEqual({ precio: 70, promocional: 50, activo: true })
    })

    it('los tipos llevan el nombre de la delegación y salen ordenados como los planes', () => {
        expect(nombreDeTipo('UNAC · Ingeniería')).toBe('DELEGACION UNAC · INGENIERÍA')
        expect(planesOrdenados([virtual, sinKit, conKit] as never).map((fila) => fila.plan)).toEqual(['CON_KIT', 'SIN_KIT', 'VIRTUAL'])
    })
})

describe('forma de la delegación', () => {
    const totales = (total: number, monto: number, porTipo: Array<[number, number]> = []) => ({ total, monto, porTipo: new Map(porTipo) })

    it('aDelegacion trae los planes con su precio por persona, el total y el saldo', () => {
        const datos = aDelegacion(completa() as never, totales(11, 600, [[31, 1], [32, 10]]), [{ monto: 200, estado: 'PENDIENTE' }, { monto: 999, estado: 'RECHAZADO' }])
        expect(datos).toMatchObject({
            id: 5, totalIntegrantes: 11, montoTotal: 600, minIntegrantes: 10, faltanParaPromocional: null,
            codigoLink: 'abc123def456', codigoInscripcion: 'ind0123456789abcd', inscripcionIndividual: true, dominioCorreo: null,
            representante: { documento: '70000001', tipoDocumento: 'dni' },
            pago: { totalAPagar: 600, declarado: 200, saldo: 400, cantidad: 2 },
        })
        expect(datos.planes).toEqual([
            expect.objectContaining({ codigo: 'CON_KIT', precio: 80, precioPromocional: null, precioUnitario: 80, integrantes: 1, activo: true }),
            expect.objectContaining({ codigo: 'SIN_KIT', precio: 60, precioPromocional: 50, precioUnitario: 50, integrantes: 10 }),
            expect.objectContaining({ codigo: 'VIRTUAL', modalidad: 'VIRTUAL', precio: 30, integrantes: 0 }),
        ])
    })

    it('sin «pagos.ver» el dinero va en null y sin permiso de inscribir tampoco salen los links', () => {
        const datos = aDelegacion(completa() as never, totales(3, 200), [{ monto: 100, estado: 'PENDIENTE' }], { conPago: false, conLinks: false })
        expect(datos).toMatchObject({ montoTotal: null, pago: null, codigoLink: null, codigoInscripcion: null, inscripcionIndividual: true })
        for (const fila of datos.planes) expect(fila).toMatchObject({ precio: null, precioPromocional: null, precioUnitario: null })
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

describe('API del sitio: link del delegado', () => {
    const conGrupo = (extra: Record<string, unknown> = {}) => completa({
        pagos: [{ id: 1, modalidadPago: 'billetera', banco: null, billeteraDigital: 'yape', tipoOperacion: null, numeroOperacion: 'OP-998877', fechaPago: FECHA, monto: new Prisma.Decimal(200), estado: 'PENDIENTE', motivoRechazo: 'interno', creadoEn: FECHA }],
        inscripciones: [inscripcionDe(1, 1, 'PENDIENTE', 31, 80), inscripcionDe(2, 2), inscripcionDe(3, 3, 'RECHAZADO')],
        ...extra,
    })

    it('ya no existen la tarifa global ni el registro público de delegaciones', async () => {
        expect((await request(app).get('/api/v1/site/delegations/tarifa').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        expect((await request(app).post('/api/v1/site/delegations').set('X-Api-Key', TOKEN_SITIO).send({})).status).toBe(404)
    })

    it('exige el token de acceso del evento', async () => {
        expect((await request(app).get('/api/v1/site/delegations/link/abc123def456')).status).toBe(401)
    })

    it('el delegado ve su grupo, sus planes, el link individual y los datos enmascarados, sin el contacto', async () => {
        m.delegacion.findUnique.mockResolvedValue(conGrupo({ dominioCorreo: 'unac.edu.pe' }))
        const r = await request(app).get('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO)
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({
            id: 5, nombre: 'Delegación Ingeniería', institucion: 'UNH', representanteNombre: 'Rosa Quispe',
            codigoInscripcion: 'ind0123456789abcd', dominioCorreo: 'unac.edu.pe', minIntegrantes: 10,
            // El rechazado no cuenta como integrante: 80 + 60
            totalIntegrantes: 2, montoTotal: 140, faltanParaPromocional: 8,
            pago: { totalAPagar: 140, declarado: 200, saldo: -60 },
            evento: { id: 2, codigo: 'ciisic-2026' },
        })
        expect(r.body.data.planes.map((fila: { codigo: string }) => fila.codigo)).toEqual(['CON_KIT', 'SIN_KIT', 'VIRTUAL'])
        expect(r.body.data.integrantes).toHaveLength(2)
        expect(r.body.data.integrantes[0]).toMatchObject({ documento: '****0001', plan: 'CON_KIT' })
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

describe('API del sitio: link individual', () => {
    const unirse = (codigo = 'ind0123456789abcd') => request(app).post(`/api/v1/site/delegations/join/${codigo}/participants`).set('X-Api-Key', TOKEN_SITIO)
    const alta = (extra: Record<string, unknown> = {}) => ({
        tipoDocumento: 'dni', numeroDocumento: '70000001', nombres: 'Ana', apellidos: 'Quispe', celular: '999888777', plan: 'SIN_KIT', ...extra,
    })

    beforeEach(() => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { id?: number, codigoInscripcion?: string, codigoLink?: string } }) => {
            if (where.codigoInscripcion && where.codigoInscripcion !== 'ind0123456789abcd') return null
            if (where.codigoLink) return null
            return completa({ dominioCorreo: 'unac.edu.pe' })
        })
        m.inscripcion.count.mockResolvedValue(1)
    })

    it('exige el token de acceso del evento', async () => {
        expect((await request(app).get('/api/v1/site/delegations/join/ind0123456789abcd')).status).toBe(401)
        expect((await request(app).post('/api/v1/site/delegations/join/ind0123456789abcd/participants').send(alta())).status).toBe(401)
    })

    it('quien abre el link ve el grupo, el dominio y solo los planes activos con su precio', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ dominioCorreo: 'unac.edu.pe', planes: categoria([conKit, { ...sinKit, activo: false }, virtual]) }))
        const r = await request(app).get('/api/v1/site/delegations/join/ind0123456789abcd').set('X-Api-Key', TOKEN_SITIO)
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ nombre: 'Delegación Ingeniería', institucion: 'UNH', dominioCorreo: 'unac.edu.pe', minIntegrantes: 10, evento: { codigo: 'ciisic-2026' } })
        expect(r.body.data.planes).toEqual([
            { codigo: 'CON_KIT', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL', precio: 80, precioPromocional: null },
            { codigo: 'VIRTUAL', etiqueta: 'VIRTUAL', modalidad: 'VIRTUAL', precio: 30, precioPromocional: null },
        ])
        // Nada de los demás integrantes ni del contacto
        const texto = JSON.stringify(r.body.data)
        expect(texto).not.toContain('rosa@unh.edu.pe')
        expect(texto).not.toContain('abc123def456')
        expect(r.body.data.integrantes).toBeUndefined()
    })

    it('un link apagado, de otro evento, inactivo o inexistente responde 404', async () => {
        const abrir = () => request(app).get('/api/v1/site/delegations/join/ind0123456789abcd').set('X-Api-Key', TOKEN_SITIO)
        m.delegacion.findUnique.mockResolvedValueOnce(completa({ eventoId: 7 }))
        expect((await abrir()).status).toBe(404)
        m.delegacion.findUnique.mockResolvedValueOnce(completa({ activo: false }))
        expect((await abrir()).status).toBe(404)
        expect((await request(app).get('/api/v1/site/delegations/join/otro').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
    })

    it('con dominio, el integrante escribe solo el prefijo y el servidor arma el correo, sin Google', async () => {
        const r = await unirse().send(alta({ correoPrefijo: 'AQuispe' }))
        expect(r.status).toBe(201)
        expect(m.participante.create.mock.calls[0][0].data).toMatchObject({ numeroDocumento: '70000001', correo: 'aquispe@unac.edu.pe' })
        // Queda pendiente y con el tipo del plan que eligió
        expect(m.inscripcion.create.mock.calls[0][0].data).toMatchObject({ delegacionId: 5, estadoId: 1, tipoInscripcionId: 32, modalidadPago: 'delegacion' })
        expect(r.body.data).toMatchObject({ delegacion: { nombre: 'Delegación Ingeniería' }, plan: { codigo: 'SIN_KIT', etiqueta: 'SIN KIT', modalidad: 'PRESENCIAL' }, registrados: 1, omitidos: 0 })
        expect(JSON.stringify(r.body.data)).not.toContain('aquispe@unac.edu.pe')
    })

    it('el precio de su plan se aplica al grupo con el total final (el cliente no manda precios)', async () => {
        m.inscripcion.count.mockResolvedValue(10)
        await unirse().send(alta({ correoPrefijo: 'aquispe', monto: 1, precio: 1 }))
        const datos = m.inscripcion.updateMany.mock.calls.map((llamada) => llamada[0])
        // 10 integrantes: el plan Sin kit pasa a su promocional (50); Con kit y Virtual no tienen escala
        expect(datos.find((u) => u.where.tipoInscripcionId === 32).data).toMatchObject({ monto: 50, descuento: 10, tieneDescuento: true })
        expect(datos.find((u) => u.where.tipoInscripcionId === 31).data).toMatchObject({ monto: 80, descuento: 0 })
        expect(datos.find((u) => u.where.tipoInscripcionId === 33).data).toMatchObject({ monto: 30, descuento: 0 })
    })

    it('también vale el correo completo si termina en el dominio de la delegación', async () => {
        const r = await unirse().send(alta({ correo: 'ana@unac.edu.pe' }))
        expect(r.status).toBe(201)
        expect(m.participante.create.mock.calls[0][0].data.correo).toBe('ana@unac.edu.pe')
    })

    it('rechaza un correo de otro dominio y no escribe nada', async () => {
        const r = await unirse().send(alta({ correo: 'ana@gmail.com' }))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
        expect(r.body.fields).toEqual({ 'participantes[0].correo': 'Debe terminar en @unac.edu.pe' })
        expect(m.participante.create).not.toHaveBeenCalled()
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('una persona ya registrada con otro correo tampoco entra: cuenta el correo que ya tiene', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001', 'ana@gmail.com')]).mockResolvedValueOnce([])
        const r = await unirse().send(alta({ correoPrefijo: 'ana' }))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
    })

    it('sin dominio en la delegación exige el correo completo', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa())
        const solo = await unirse().send(alta({ correoPrefijo: 'ana' }))
        expect(solo.status).toBe(422)
        expect(solo.body.fields).toEqual({ correo: 'Escribe tu correo completo' })
        const completo = await unirse().send(alta({ correo: 'ana@gmail.com' }))
        expect(completo.status).toBe(201)
    })

    it('exige escribir el correo o su prefijo', async () => {
        const r = await unirse().send(alta())
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
    })

    it('con varios planes activos hay que elegir uno; con uno solo se asume', async () => {
        const sinPlan = await unirse().send(alta({ plan: undefined, correoPrefijo: 'ana' }))
        expect(sinPlan.status).toBe(422)
        expect(sinPlan.body.code).toBe('PLAN_REQUIRED')

        m.delegacion.findUnique.mockResolvedValue(completa({ dominioCorreo: 'unac.edu.pe', planes: categoria([{ ...conKit, activo: false }, sinKit, { ...virtual, activo: false }]) }))
        const unico = await unirse().send(alta({ plan: undefined, correoPrefijo: 'ana' }))
        expect(unico.status).toBe(201)
        expect(m.inscripcion.create.mock.calls[0][0].data.tipoInscripcionId).toBe(32)
    })

    it('un plan vacío cuenta como no elegido (PLAN_REQUIRED, no un error de formato)', async () => {
        const r = await unirse().send(alta({ plan: '', correoPrefijo: 'ana' }))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('PLAN_REQUIRED')
    })

    it('un plan apagado o inexistente no se puede elegir', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ dominioCorreo: 'unac.edu.pe', planes: categoria([conKit, { ...sinKit, activo: false }, virtual]) }))
        const apagado = await unirse().send(alta({ correoPrefijo: 'ana', plan: 'SIN_KIT' }))
        expect(apagado.status).toBe(422)
        expect(apagado.body.code).toBe('DELEGATION_PLAN_NOT_AVAILABLE')
        const raro = await unirse().send(alta({ correoPrefijo: 'ana', plan: 'VIP' }))
        expect(raro.status).toBe(422)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('una delegación sin planes activos no admite integrantes', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ dominioCorreo: 'unac.edu.pe', planes: categoria([{ ...conKit, activo: false }, { ...sinKit, activo: false }, { ...virtual, activo: false }]) }))
        const r = await unirse().send(alta({ plan: undefined, correoPrefijo: 'ana' }))
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_WITHOUT_PLANS')
    })

    it('un link inexistente responde 404 y con las inscripciones cerradas, 409', async () => {
        expect((await unirse('otro').send(alta({ correoPrefijo: 'ana' }))).status).toBe(404)
        m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento: { ...evento, inscripcionesAbiertas: false } })
        const cerrado = await unirse().send(alta({ correoPrefijo: 'ana' }))
        expect(cerrado.status).toBe(409)
        expect(cerrado.body.code).toBe('REGISTRATION_CLOSED')
    })

    it('reenviar no duplica: quien ya está en la delegación se omite', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001', 'aquispe@unac.edu.pe')]).mockResolvedValueOnce([participante(1, '70000001', 'aquispe@unac.edu.pe')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 101, participanteId: 1, delegacionId: 5, estado: { codigo: 'PENDIENTE' } }])
        const r = await unirse().send(alta({ correoPrefijo: 'aquispe' }))
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ registrados: 0, omitidos: 1 })
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('quien ya está inscrito en el evento por su cuenta no puede unirse', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001', 'aquispe@unac.edu.pe')]).mockResolvedValueOnce([participante(1, '70000001', 'aquispe@unac.edu.pe')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 101, participanteId: 1, delegacionId: null, estado: { codigo: 'APROBADO' } }])
        const r = await unirse().send(alta({ correoPrefijo: 'aquispe' }))
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('PARTICIPANT_ALREADY_REGISTERED')
    })
})

describe('administración: alta de una delegación', () => {
    const representante = { nombres: 'Rosa', apellidos: 'Quispe', tipoDocumento: 'dni', numeroDocumento: '70000001', correo: 'rosa@unh.edu.pe', celular: '999888777' }
    const cuerpo = { nombre: 'Delegación Ingeniería', institucion: 'UNH', representante }

    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa())
        m.delegacion.create.mockResolvedValue(delegacion)
    })

    it('el Administrador crea la delegación con sus planes, su dominio y su link individual', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador()).send({
            ...cuerpo,
            minIntegrantes: 8,
            dominioCorreo: '@UNAC.edu.pe',
            inscripcionIndividual: true,
            planes: { CON_KIT: { activo: true, precio: 80 }, SIN_KIT: { activo: true, precio: 60, precioPromocional: 50 } },
        })
        expect(r.status).toBe(201)
        const datos = m.delegacion.create.mock.calls[0][0].data
        expect(datos.codigoLink).toMatch(/^[0-9a-f]{16}$/)
        expect(datos.codigoInscripcion).toMatch(/^[0-9a-f]{16}$/)
        expect(datos.codigoInscripcion).not.toBe(datos.codigoLink)
        expect(datos).toMatchObject({ eventoId: 2, nombre: 'Delegación Ingeniería', minIntegrantes: 8, dominioCorreo: 'unac.edu.pe', representanteDocumento: '70000001' })
        // Su categoría oculta y sus tres planes
        expect(m.categoriaInscripcion.create.mock.calls[0][0].data).toMatchObject({ eventoId: 2, codigo: 'DELEGACION_5', delegacionId: 5, esEstudiantil: false, orden: 1005 })
        const tipos = m.tipoInscripcion.create.mock.calls.map((llamada) => llamada[0].data)
        expect(tipos).toHaveLength(3)
        expect(tipos[0]).toMatchObject({ codigo: 'delegacion_con_kit', etiqueta: 'CON KIT', modalidad: 'PRESENCIAL', precio: 80, precioInstitucional: 80, activo: true, nombre: 'DELEGACION DELEGACIÓN INGENIERÍA' })
        expect(tipos[1]).toMatchObject({ codigo: 'delegacion_sin_kit', precio: 60, precioPromocional: 50, activo: true })
        // Sin indicarlo, el virtual nace apagado y sin precio
        expect(tipos[2]).toMatchObject({ codigo: 'delegacion_virtual', modalidad: 'VIRTUAL', precio: 0, activo: false })
    })

    it('sin planes en el cuerpo, los tres nacen apagados y sin precio', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador()).send(cuerpo)
        expect(r.status).toBe(201)
        expect(m.delegacion.create.mock.calls[0][0].data.codigoInscripcion).toBeNull()
        for (const llamada of m.tipoInscripcion.create.mock.calls) expect(llamada[0].data).toMatchObject({ precio: 0, activo: false })
    })

    it('la Comisión crea la delegación pero no fija planes, precios, dominio ni links', async () => {
        const ok = await request(app).post('/api/v1/events/2/delegations').set('Authorization', comision()).send(cuerpo)
        expect(ok.status).toBe(201)
        for (const llamada of m.tipoInscripcion.create.mock.calls) expect(llamada[0].data).toMatchObject({ precio: 0, activo: false })

        m.delegacion.create.mockClear()
        for (const extra of [{ planes: { SIN_KIT: { activo: true, precio: 60 } } }, { dominioCorreo: 'unac.edu.pe' }, { minIntegrantes: 5 }, { inscripcionIndividual: true }]) {
            const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', comision()).send({ ...cuerpo, ...extra })
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect(m.delegacion.create).not.toHaveBeenCalled()
    })

    it('la respuesta de la Comisión trae los links del grupo pero no precios ni pagos', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', comision()).send(cuerpo)
        expect(r.body.data).toMatchObject({ montoTotal: null, pago: null, codigoLink: 'abc123def456' })
        for (const fila of r.body.data.planes) expect(fila).toMatchObject({ precio: null, precioUnitario: null })
    })

    it('un precio promocional mayor que el precio responde 409 y no deja nada a medias', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ ...cuerpo, planes: { SIN_KIT: { activo: true, precio: 60, precioPromocional: 70 } } })
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INVALID_PRICES')
    })

    it('el delegado es obligatorio (documento, correo y celular) y el dominio debe ser válido', async () => {
        const sinCelular = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ ...cuerpo, representante: { ...representante, celular: undefined } })
        expect(sinCelular.status).toBe(422)
        const dominio = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador()).send({ ...cuerpo, dominioCorreo: 'no es un dominio' })
        expect(dominio.status).toBe(422)
    })

    it('con integrantes en el alta los inscribe con el plan de cada uno', async () => {
        m.inscripcion.count.mockResolvedValue(2)
        m.delegacion.findUnique.mockResolvedValue(completa())
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ ...cuerpo, representante: { ...representante, esIntegrante: true, plan: 'CON_KIT' }, participantes: [persona(2, { plan: 'VIRTUAL' })] })
        expect(r.status).toBe(201)
        expect(m.inscripcion.create.mock.calls.map((llamada) => llamada[0].data.tipoInscripcionId)).toEqual([31, 33])
    })

    it('si el alta con integrantes falla, borra la delegación, su categoría y sus planes', async () => {
        const r = await request(app).post('/api/v1/events/2/delegations').set('Authorization', administrador())
            .send({ ...cuerpo, participantes: [persona(2)] })
        // Con varios planes activos y sin elegir, el plan es obligatorio
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('PLAN_REQUIRED')
        expect(m.tipoInscripcion.deleteMany).toHaveBeenCalledWith({ where: { categoria: { delegacionId: 5 } } })
        expect(m.categoriaInscripcion.deleteMany).toHaveBeenCalledWith({ where: { delegacionId: 5 } })
        expect(m.delegacion.delete).toHaveBeenCalledWith({ where: { id: 5 } })
    })
})

describe('administración: ver las delegaciones', () => {
    const fila = () => ({ ...completa(), pagos: [{ monto: new Prisma.Decimal(100), estado: 'PENDIENTE' }] })

    beforeEach(() => {
        m.delegacion.findMany.mockResolvedValue([fila()])
        m.inscripcion.groupBy.mockResolvedValue([
            { delegacionId: 5, tipoInscripcionId: 31, _count: { _all: 2 }, _sum: { monto: new Prisma.Decimal(160) } },
            { delegacionId: 5, tipoInscripcionId: 32, _count: { _all: 3 }, _sum: { monto: new Prisma.Decimal(180) } },
        ])
    })

    it('el listado cuenta cada plan con una sola consulta agrupada', async () => {
        const r = await request(app).get('/api/v1/events/2/delegations').set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(m.inscripcion.groupBy).toHaveBeenCalledTimes(1)
        expect(m.inscripcion.groupBy.mock.calls[0][0].where).toMatchObject({ delegacionId: { in: [5] }, estado: { codigo: { notIn: ['RECHAZADO', 'CANCELADO'] } } })
        expect(r.body.data[0]).toMatchObject({ id: 5, totalIntegrantes: 5, montoTotal: 340, pago: { totalAPagar: 340, declarado: 100, saldo: 240 } })
        expect(r.body.data[0].planes.map((p: { integrantes: number }) => p.integrantes)).toEqual([2, 3, 0])
    })

    it('el Tesorero de sus eventos ve todo el dinero pero no los links', async () => {
        const r = await request(app).get('/api/v1/events/2/delegations').set('Authorization', tesorero())
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ montoTotal: 340, codigoLink: null, codigoInscripcion: null, inscripcionIndividual: true })
        expect(r.body.data[0].planes[0].precio).toBe(80)
    })

    it('la Comisión ve los links pero no los precios ni los pagos', async () => {
        const r = await request(app).get('/api/v1/events/2/delegations').set('Authorization', comision())
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ montoTotal: null, pago: null, codigoLink: 'abc123def456', codigoInscripcion: 'ind0123456789abcd' })
        for (const plan of r.body.data[0].planes) expect(plan).toMatchObject({ precio: null, precioUnitario: null })
    })

    it('el detalle trae a cada integrante con su plan y, sin «pagos.ver», sin montos ni vouchers', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({
            pagos: [{ id: 1, modalidadPago: 'billetera', banco: null, billeteraDigital: 'yape', tipoOperacion: null, numeroOperacion: 'OP-1', fechaPago: FECHA, monto: new Prisma.Decimal(100), estado: 'PENDIENTE', motivoRechazo: null, revisadoEn: null, creadoEn: FECHA }],
            inscripciones: [inscripcionDe(1, 1, 'PENDIENTE', 31, 80), inscripcionDe(2, 2, 'PENDIENTE', 33, 30)],
        }))
        const tesoreria = await request(app).get('/api/v1/delegations/5').set('Authorization', tesorero())
        expect(tesoreria.body.data.inscripciones.map((i: { plan: string, monto: number }) => [i.plan, i.monto])).toEqual([['CON_KIT', 80], ['VIRTUAL', 30]])
        expect(tesoreria.body.data.pagos).toHaveLength(1)

        const comite = await request(app).get('/api/v1/delegations/5').set('Authorization', comision())
        expect(comite.status).toBe(200)
        expect(comite.body.data.pagos).toEqual([])
        expect(comite.body.data.inscripciones.map((i: { plan: string, monto: number | null }) => [i.plan, i.monto])).toEqual([['CON_KIT', null], ['VIRTUAL', null]])
    })

    it('una Comisión sin permisos de delegaciones o con otro evento no entra', async () => {
        const sinPermiso = `Bearer ${tokenDeRol('COMISION', 41, { eventoIds: [2], permisos: ['asistencia.marcar'] })}`
        expect((await request(app).get('/api/v1/events/2/delegations').set('Authorization', sinPermiso)).status).toBe(403)
        const otroEvento = `Bearer ${tokenDeRol('COMISION', 42, { eventoIds: [9], permisos: ['delegaciones.inscribir'] })}`
        const r = await request(app).get('/api/v1/events/2/delegations').set('Authorization', otroEvento)
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
    })
})

describe('administración: configuración (planes, precios, dominio y links)', () => {
    const configurar = (cuerpo: unknown, autorizacion = administrador()) => request(app).put('/api/v1/delegations/5/config').set('Authorization', autorizacion).send(cuerpo as object)

    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa())
        m.inscripcion.count.mockResolvedValue(4)
    })

    it('guarda el precio, el promocional y el estado de cada plan y reprecia al grupo', async () => {
        const r = await configurar({ planes: { CON_KIT: { precio: 90 }, VIRTUAL: { activo: false }, SIN_KIT: { precioPromocional: null } }, minIntegrantes: 6 })
        expect(r.status).toBe(200)
        const cambios = new Map(m.tipoInscripcion.update.mock.calls.map((llamada) => [llamada[0].where.id, llamada[0].data]))
        expect(cambios.get(31)).toEqual({ precio: 90, precioInstitucional: 90, precioPromocional: null, activo: true })
        expect(cambios.get(33)).toEqual({ precio: 30, precioInstitucional: 30, precioPromocional: null, activo: false })
        expect(cambios.get(32)).toEqual({ precio: 60, precioInstitucional: 60, precioPromocional: null, activo: true })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ minIntegrantes: 6 })
        // Reprecia a los integrantes de cada plan con el total activo (4)
        expect(m.inscripcion.updateMany.mock.calls.map((llamada) => llamada[0].where.tipoInscripcionId)).toEqual([31, 32, 33])
    })

    it('sin tocar un plan, no lo actualiza; el promocional se aplica al cruzar el mínimo', async () => {
        m.inscripcion.count.mockResolvedValue(10)
        await configurar({ minIntegrantes: 10 })
        expect(m.tipoInscripcion.update).not.toHaveBeenCalled()
        const sin = m.inscripcion.updateMany.mock.calls.find((llamada) => llamada[0].where.tipoInscripcionId === 32)
        expect(sin?.[0].data).toMatchObject({ monto: 50, descuento: 10, tieneDescuento: true })
    })

    it('el dominio y el link individual se encienden, apagan y normalizan', async () => {
        await configurar({ dominioCorreo: '@UNAC.edu.pe' })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ dominioCorreo: 'unac.edu.pe' })
        m.delegacion.update.mockClear()
        await configurar({ dominioCorreo: '' })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ dominioCorreo: null })
        m.delegacion.update.mockClear()
        await configurar({ inscripcionIndividual: false })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ codigoInscripcion: null })
    })

    it('encender el link individual de una delegación que no lo tenía genera uno nuevo; si ya lo tenía, lo conserva', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ codigoInscripcion: null }))
        await configurar({ inscripcionIndividual: true })
        expect(m.delegacion.update.mock.calls[0][0].data.codigoInscripcion).toMatch(/^[0-9a-f]{16}$/)
        m.delegacion.update.mockClear()
        m.delegacion.findUnique.mockResolvedValue(completa())
        await configurar({ inscripcionIndividual: true })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({})
    })

    it('un plan activo sin precio o un promocional mayor responde 409 y no cambia nada', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ planes: categoria([conKit, sinKit, { ...virtual, activo: false, precio: new Prisma.Decimal(0), precioInstitucional: new Prisma.Decimal(0) }]) }))
        const sinPrecio = await configurar({ planes: { VIRTUAL: { activo: true } } })
        expect(sinPrecio.status).toBe(409)
        expect(sinPrecio.body.code).toBe('INVALID_PRICES')
        const mayor = await configurar({ planes: { SIN_KIT: { precioPromocional: 70 } } })
        expect(mayor.status).toBe(409)
        expect(m.delegacion.update).not.toHaveBeenCalled()
    })

    it('apagar un plan con integrantes los conserva: solo se cierran las altas nuevas', async () => {
        const r = await configurar({ planes: { SIN_KIT: { activo: false } } })
        expect(r.status).toBe(200)
        expect(m.tipoInscripcion.update.mock.calls[0][0].data).toMatchObject({ activo: false })
        expect(m.inscripcion.delete).not.toHaveBeenCalled()
    })

    it('exige al menos un dato y solo lo hacen Owner y Administrador', async () => {
        expect((await configurar({})).status).toBe(422)
        for (const autorizacion of [tesorero(), comision(), comision(['delegaciones.inscribir', 'pagos.ver'])]) {
            const r = await configurar({ minIntegrantes: 5 }, autorizacion)
            expect(r.status).toBe(403)
        }
        expect(m.delegacion.update).not.toHaveBeenCalled()
    })

    it('regenerar un link lo cambia por otro; solo lo hacen Owner y Administrador', async () => {
        const individual = await request(app).post('/api/v1/delegations/5/links/regenerate').set('Authorization', administrador()).send({ enlace: 'individual' })
        expect(individual.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data.codigoInscripcion).toMatch(/^[0-9a-f]{16}$/)
        m.delegacion.update.mockClear()
        m.delegacion.findUnique.mockResolvedValue(completa())
        const delegado = await request(app).post('/api/v1/delegations/5/links/regenerate').set('Authorization', administrador()).send({ enlace: 'delegado' })
        expect(delegado.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data.codigoLink).toMatch(/^[0-9a-f]{16}$/)

        expect((await request(app).post('/api/v1/delegations/5/links/regenerate').set('Authorization', administrador()).send({ enlace: 'otro' })).status).toBe(422)
        expect((await request(app).post('/api/v1/delegations/5/links/regenerate').set('Authorization', comision()).send({ enlace: 'delegado' })).status).toBe(403)
    })
})

describe('administración: integrantes del grupo', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa({ dominioCorreo: 'unac.edu.pe' }))
    })

    const cargar = (participantes: unknown[], autorizacion = administrador()) => request(app).post('/api/v1/delegations/5/inscriptions').set('Authorization', autorizacion).send({ participantes })
    const preciosAplicados = () => new Map<number, Record<string, unknown>>(m.inscripcion.updateMany.mock.calls.map((llamada) => [llamada[0].where.tipoInscripcionId, llamada[0].data]))

    it('un grupo mixto: cada integrante queda con el tipo de su plan', async () => {
        m.inscripcion.count.mockResolvedValue(3)
        const r = await cargar([persona(1, { plan: 'CON_KIT' }), persona(2, { plan: 'SIN_KIT' }), persona(3, { plan: 'VIRTUAL' })])
        expect(r.status).toBe(201)
        expect(m.inscripcion.create.mock.calls.map((llamada) => llamada[0].data.tipoInscripcionId)).toEqual([31, 32, 33])
        // Cada plan cobra su precio (3 integrantes: por debajo del mínimo)
        const precios = preciosAplicados()
        expect(precios.get(31)).toMatchObject({ monto: 80, descuento: 0, tieneDescuento: false })
        expect(precios.get(32)).toMatchObject({ monto: 60, descuento: 0 })
        expect(precios.get(33)).toMatchObject({ monto: 30, descuento: 0 })
    })

    it('al llegar al mínimo solo los planes con precio promocional lo cobran, para todo el grupo', async () => {
        m.inscripcion.count.mockResolvedValue(10)
        await cargar([persona(1, { plan: 'SIN_KIT' })])
        const precios = preciosAplicados()
        expect(precios.get(32)).toMatchObject({ monto: 50, descuento: 10, tieneDescuento: true })
        expect(precios.get(31)).toMatchObject({ monto: 80, descuento: 0 })
        // Reprecia a todo el plan, no solo a los nuevos
        expect(m.inscripcion.updateMany.mock.calls[0][0].where).toMatchObject({ delegacionId: 5, eventoId: 2 })
    })

    it('el recuento ignora a los rechazados y cancelados', async () => {
        m.inscripcion.count.mockResolvedValue(4)
        await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(m.inscripcion.count.mock.calls[0][0].where).toMatchObject({ delegacionId: 5, estado: { codigo: { notIn: ['RECHAZADO', 'CANCELADO'] } } })
    })

    it('el staff inscribe con cualquier correo aunque la delegación tenga dominio', async () => {
        const r = await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(r.status).toBe(201)
        expect(m.participante.create.mock.calls[0][0].data.correo).toBe('persona1@example.com')
    })

    it('los integrantes nacen pendientes, con credencial propia y un código interno de pago', async () => {
        await cargar([persona(1, { plan: 'SIN_KIT' }), persona(2, { plan: 'SIN_KIT' })])
        const datos = m.inscripcion.create.mock.calls.map((llamada) => llamada[0].data)
        expect(datos.every((d) => d.estadoId === 1 && d.delegacionId === 5)).toBe(true)
        expect(datos[0].codigoCredencial).toMatch(/^[0-9A-Z]{10}$/)
        expect(datos[0].numeroOperacion).toMatch(/^DELEGACION-/)
        expect(datos[0].numeroOperacion).not.toBe(datos[1].numeroOperacion)
    })

    it('con varios planes activos y sin elegir, 422 con el campo; no se escribe nada', async () => {
        const r = await cargar([persona(1)])
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('PLAN_REQUIRED')
        expect(r.body.fields).toEqual({ 'participantes[0].plan': 'Elige un plan' })
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('con un solo plan activo no hace falta elegirlo', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ planes: categoria([{ ...conKit, activo: false }, sinKit, { ...virtual, activo: false }]) }))
        const r = await cargar([persona(1)])
        expect(r.status).toBe(201)
        expect(m.inscripcion.create.mock.calls[0][0].data.tipoInscripcionId).toBe(32)
    })

    it('un plan apagado rechaza las altas nuevas aunque ya tenga integrantes', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ planes: categoria([conKit, { ...sinKit, activo: false }, virtual]) }))
        const r = await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_PLAN_NOT_AVAILABLE')
        expect(r.body.fields).toEqual({ 'participantes[0].plan': 'Plan no disponible' })
    })

    it('una delegación sin planes configurados no admite integrantes (la Comisión crea y el Owner configura)', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ planes: categoria([{ ...conKit, activo: false }, { ...sinKit, activo: false }, { ...virtual, activo: false }]) }))
        const r = await cargar([persona(1)], comision())
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('DELEGATION_WITHOUT_PLANS')
    })

    it('reenviar la misma lista omite a quien ya estaba, sin duplicar', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 101, participanteId: 1, delegacionId: 5, estado: { codigo: 'PENDIENTE' } }])
        const r = await cargar([persona(1, { plan: 'SIN_KIT' }), persona(2, { plan: 'SIN_KIT' })])
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ registrados: 1, omitidos: 1 })
        expect(m.inscripcion.create).toHaveBeenCalledTimes(1)
    })

    it('quien tenía la inscripción rechazada se reutiliza con el plan nuevo y vuelve a contar', async () => {
        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 101, participanteId: 1, delegacionId: 5, estado: { codigo: 'RECHAZADO' } }])
        const r = await cargar([persona(1, { plan: 'CON_KIT' })])
        expect(r.status).toBe(201)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
        expect(m.inscripcion.update.mock.calls[0][0].data).toMatchObject({ estadoId: 1, tipoInscripcionId: 31, motivoRechazo: null, delegacionId: 5 })
    })

    it('rechaza documentos y correos repetidos en la misma carga antes de escribir', async () => {
        const documento = await cargar([persona(1, { plan: 'SIN_KIT' }), persona(2, { numeroDocumento: '70000001', plan: 'SIN_KIT' })])
        expect(documento.status).toBe(409)
        const correo = await cargar([persona(1, { plan: 'SIN_KIT' }), persona(2, { correo: 'persona1@example.com', plan: 'SIN_KIT' })])
        expect(correo.status).toBe(409)
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('rechaza el correo de otra persona y a quien ya está inscrito fuera de la delegación', async () => {
        m.participante.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([participante(9, '70000009', 'persona1@example.com')])
        const correo = await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(correo.status).toBe(409)
        expect(correo.body.code).toBe('EMAIL_IN_USE')

        m.participante.findMany.mockResolvedValueOnce([participante(1, '70000001')]).mockResolvedValueOnce([participante(1, '70000001')])
        m.inscripcion.findMany.mockResolvedValue([{ id: 101, participanteId: 1, delegacionId: null, estado: { codigo: 'PENDIENTE' } }])
        const ya = await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(ya.status).toBe(409)
        expect(ya.body.code).toBe('PARTICIPANT_ALREADY_REGISTERED')
    })

    it('una delegación inactiva no recibe integrantes', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ activo: false }))
        const r = await cargar([persona(1, { plan: 'SIN_KIT' })])
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('DELEGATION_INACTIVE')
    })

    it('el Tesorero ve las delegaciones pero no inscribe', async () => {
        const r = await cargar([persona(1, { plan: 'SIN_KIT' })], tesorero())
        expect(r.status).toBe(403)
        expect(m.participante.create).not.toHaveBeenCalled()
    })
})

describe('administración: cambiar de plan, quitar un integrante y aprobar al grupo', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa())
        m.inscripcion.findFirst.mockResolvedValue({ id: 10, tipoInscripcionId: 32, estado: { codigo: 'PENDIENTE' } })
    })

    const cambiar = (plan: string, autorizacion = administrador()) => request(app).patch('/api/v1/delegations/5/inscriptions/10').set('Authorization', autorizacion).send({ plan })

    it('el staff mueve a un integrante a otro plan activo y el grupo se recalcula', async () => {
        m.inscripcion.count.mockResolvedValue(4)
        const r = await cambiar('con_kit')
        expect(r.status).toBe(200)
        expect(m.inscripcion.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { tipoInscripcionId: 31 } })
        expect(m.inscripcion.updateMany).toHaveBeenCalledTimes(3)
    })

    it('un plan apagado no sirve de destino, pero quedarse en él no es un error', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ planes: categoria([conKit, { ...sinKit, activo: false }, { ...virtual, activo: false }]) }))
        const apagado = await cambiar('VIRTUAL')
        expect(apagado.status).toBe(422)
        expect(apagado.body.code).toBe('DELEGATION_PLAN_NOT_AVAILABLE')
        expect((await cambiar('SIN_KIT')).status).toBe(200)
    })

    it('un integrante rechazado, cancelado o de otra delegación no se mueve', async () => {
        m.inscripcion.findFirst.mockResolvedValue({ id: 10, tipoInscripcionId: 32, estado: { codigo: 'RECHAZADO' } })
        expect((await cambiar('CON_KIT')).status).toBe(409)
        m.inscripcion.findFirst.mockResolvedValue(null)
        expect((await cambiar('CON_KIT')).status).toBe(404)
    })

    it('la Comisión elegida puede, el Tesorero no; un plan desconocido es 422', async () => {
        expect((await cambiar('CON_KIT', comision())).status).toBe(200)
        expect((await cambiar('CON_KIT', tesorero())).status).toBe(403)
        expect((await cambiar('VIP')).status).toBe(422)
    })

    it('quita a un integrante pendiente y recalcula el grupo', async () => {
        const r = await request(app).delete('/api/v1/delegations/5/inscriptions/10').set('Authorization', administrador())
        expect(r.status).toBe(200)
        expect(m.inscripcion.delete).toHaveBeenCalledWith({ where: { id: 10 } })
        expect(m.inscripcion.updateMany).toHaveBeenCalled()
    })

    it('un integrante aprobado no se quita: se cancela desde Inscripciones', async () => {
        m.inscripcion.findFirst.mockResolvedValue({ id: 10, estado: { codigo: 'APROBADO' } })
        const r = await request(app).delete('/api/v1/delegations/5/inscriptions/10').set('Authorization', administrador())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('INSCRIPTION_NOT_REMOVABLE')
        expect(m.inscripcion.delete).not.toHaveBeenCalled()
    })

    it('aprueba solo a los integrantes por revisar y el Tesorero también puede', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({
            inscripciones: [inscripcionDe(1, 1, 'PENDIENTE'), inscripcionDe(2, 2, 'APROBADO'), inscripcionDe(3, 3, 'EN_REVISION'), inscripcionDe(4, 4, 'RECHAZADO')],
        }))
        aprobarVariasMock.mockResolvedValue([{ id: 1 }, { id: 3 }])
        const r = await request(app).post('/api/v1/delegations/5/approve').set('Authorization', tesorero())
        expect(r.status).toBe(200)
        expect(aprobarVariasMock).toHaveBeenCalledWith([1, 3], 30)
        expect(r.body.data).toMatchObject({ aprobadas: 2, credencialesEnSegundoPlano: 2 })
    })

    it('sin integrantes por aprobar responde 409; la Comisión no aprueba', async () => {
        m.delegacion.findUnique.mockResolvedValue(completa({ inscripciones: [inscripcionDe(2, 2, 'APROBADO')] }))
        const vacio = await request(app).post('/api/v1/delegations/5/approve').set('Authorization', administrador())
        expect(vacio.status).toBe(409)
        expect(vacio.body.code).toBe('NOTHING_TO_APPROVE')
        expect((await request(app).post('/api/v1/delegations/5/approve').set('Authorization', comision())).status).toBe(403)
    })
})

describe('administración: datos del grupo', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockResolvedValue(completa())
    })

    it('renombrar la delegación renombra su categoría y sus planes (es lo que imprime la credencial)', async () => {
        const r = await request(app).put('/api/v1/delegations/5').set('Authorization', comision()).send({ nombre: 'UNAC · Sistemas' })
        expect(r.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ nombre: 'UNAC · Sistemas' })
        expect(m.categoriaInscripcion.updateMany).toHaveBeenCalledWith({ where: { delegacionId: 5 }, data: { nombre: 'UNAC · Sistemas' } })
        expect(m.tipoInscripcion.updateMany).toHaveBeenCalledWith({ where: { categoria: { delegacionId: 5 } }, data: { nombre: 'DELEGACION UNAC · SISTEMAS' } })
    })

    it('editar el delegado no toca los planes ni reprecia al grupo', async () => {
        const r = await request(app).put('/api/v1/delegations/5').set('Authorization', administrador())
            .send({ representante: { nombres: 'Luz', apellidos: 'Rojas', tipoDocumento: 'dni', numeroDocumento: '70000002', correo: 'luz@unh.edu.pe', celular: '999111222' } })
        expect(r.status).toBe(200)
        expect(m.delegacion.update.mock.calls[0][0].data).toMatchObject({ representanteNombre: 'Luz Rojas', representanteDocumento: '70000002' })
        expect(m.tipoInscripcion.updateMany).not.toHaveBeenCalled()
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('ya no acepta precios ni modalidad: esos datos van en /config', async () => {
        await request(app).put('/api/v1/delegations/5').set('Authorization', administrador()).send({ nombre: 'Otro nombre', precioEstandar: 1, modalidad: 'VIRTUAL' })
        expect(m.delegacion.update.mock.calls[0][0].data).toEqual({ nombre: 'Otro nombre' })
    })

    it('el Tesorero no edita; una delegación inexistente responde 404', async () => {
        expect((await request(app).put('/api/v1/delegations/5').set('Authorization', tesorero()).send({ nombre: 'Otro' })).status).toBe(403)
        m.delegacion.findUnique.mockResolvedValue(null)
        expect((await request(app).put('/api/v1/delegations/5').set('Authorization', administrador()).send({ nombre: 'Otro' })).status).toBe(404)
    })
})

describe('vouchers de la delegación (panel)', () => {
    const pagos = (cantidad: number) => Array.from({ length: cantidad }, (_, i) => ({
        modalidadPago: 'billetera', billeteraDigital: 'yape', numeroOperacion: `OP-${1000 + i}`, fechaPago: '2026-10-15', monto: 250,
    }))

    beforeEach(() => {
        m.delegacion.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => (
            select?.eventoId && !select?.codigoLink ? { id: 5, eventoId: 2 } : completa()
        ))
    })

    function subir(lista: unknown[], archivos: number, autorizacion = administrador(), url = '/api/v1/delegations/5/payments') {
        const peticion = request(app).post(url).set('Authorization', autorizacion).field('pagos', JSON.stringify(lista))
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

    it('quien inscribe (Comisión) los sube; el Tesorero, que solo valida, no', async () => {
        expect((await subir(pagos(1), 1, comision())).status).toBe(201)
        expect((await subir(pagos(1), 1, tesorero())).status).toBe(403)
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

    it('el Tesorero (con «inscripciones.validar») verifica o rechaza un voucher; la Comisión no', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5 })
        m.delegacionPago.update.mockResolvedValue({ id: 8, estado: 'RECHAZADO', monto: new Prisma.Decimal(250), fechaPago: FECHA, motivoRechazo: 'Monto distinto', creadoEn: FECHA })
        const r = await request(app).patch('/api/v1/delegations/5/payments/8').set('Authorization', tesorero()).send({ estado: 'RECHAZADO', motivo: 'Monto distinto' })
        expect(r.status).toBe(200)
        expect(m.delegacionPago.update.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Monto distinto', revisadoPorId: 30 })
        expect((await request(app).patch('/api/v1/delegations/5/payments/8').set('Authorization', comision()).send({ estado: 'VERIFICADO' })).status).toBe(403)
    })

    it('devolver un voucher a pendiente limpia la revisión', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5 })
        m.delegacionPago.update.mockResolvedValue({ id: 8, estado: 'PENDIENTE', monto: new Prisma.Decimal(250), fechaPago: FECHA, creadoEn: FECHA })
        await request(app).patch('/api/v1/delegations/5/payments/8').set('Authorization', administrador()).send({ estado: 'PENDIENTE' })
        expect(m.delegacionPago.update.mock.calls[0][0].data).toEqual({ estado: 'PENDIENTE', motivoRechazo: null, revisadoEn: null, revisadoPorId: null })
    })

    it('un voucher verificado no se elimina; uno pendiente sí, y solo Owner y Administrador', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, estado: 'VERIFICADO', voucherArchivo: 'voucher-8.pdf' })
        const verificado = await request(app).delete('/api/v1/delegations/5/payments/8').set('Authorization', administrador())
        expect(verificado.status).toBe(409)
        expect(verificado.body.code).toBe('PAYMENT_VERIFIED')

        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, estado: 'PENDIENTE', voucherArchivo: 'voucher-8.pdf' })
        expect((await request(app).delete('/api/v1/delegations/5/payments/8').set('Authorization', tesorero())).status).toBe(403)
        expect(m.delegacionPago.delete).not.toHaveBeenCalled()
        const ok = await request(app).delete('/api/v1/delegations/5/payments/8').set('Authorization', administrador())
        expect(ok.status).toBe(200)
        expect(m.delegacionPago.delete).toHaveBeenCalledWith({ where: { id: 8 } })
    })

    it('el voucher lo ve quien tiene «pagos.ver»; sin ese permiso, 403', async () => {
        m.delegacionPago.findFirst.mockResolvedValue({ id: 8, delegacionId: 5, voucherArchivo: 'voucher-8.png' })
        const r = await request(app).get('/api/v1/delegations/5/payments/8/voucher').set('Authorization', tesorero())
        // La guarda pasó: el 404 es porque el archivo no está en el servidor
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('VOUCHER_NOT_FOUND')
        expect((await request(app).get('/api/v1/delegations/5/payments/8/voucher').set('Authorization', comision())).status).toBe(403)
    })
})

describe('el delegado agrega con su link (solo agrega)', () => {
    beforeEach(() => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string, id?: number } }) => {
            if (where.codigoLink === 'abc123def456') return completa({ dominioCorreo: 'unac.edu.pe' })
            if (where.codigoLink) return null
            return completa({ dominioCorreo: 'unac.edu.pe' })
        })
    })

    const agregar = (participantes: unknown[]) => request(app).post('/api/v1/site/delegations/link/abc123def456/participants').set('X-Api-Key', TOKEN_SITIO).send({ participantes })

    it('suma integrantes con su plan y recalcula la tarifa del grupo', async () => {
        m.inscripcion.count.mockResolvedValue(3)
        const r = await agregar([persona(1, { correo: 'a@unac.edu.pe', plan: 'CON_KIT' }), persona(2, { correo: 'b@unac.edu.pe', plan: 'VIRTUAL' })])
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ registrados: 2, omitidos: 0 })
        expect(m.inscripcion.create.mock.calls.map((llamada) => llamada[0].data.tipoInscripcionId)).toEqual([31, 33])
        expect(m.inscripcion.updateMany).toHaveBeenCalled()
    })

    it('exige el dominio de la delegación en los correos (el correo completo, no el prefijo)', async () => {
        const r = await agregar([persona(1, { correo: 'a@unac.edu.pe', plan: 'CON_KIT' }), persona(2, { plan: 'VIRTUAL' })])
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
        expect(r.body.fields).toEqual({ 'participantes[1].correo': 'Debe terminar en @unac.edu.pe' })
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('con el plan faltando y varios activos, 422', async () => {
        const r = await agregar([persona(1, { correo: 'a@unac.edu.pe' })])
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('PLAN_REQUIRED')
    })

    it('no suma integrantes a un link de otro evento', async () => {
        m.delegacion.findUnique.mockImplementation(async ({ where }: { where: { codigoLink?: string } }) => (where.codigoLink ? completa({ eventoId: 7 }) : completa()))
        const r = await agregar([persona(1, { correo: 'a@unac.edu.pe', plan: 'CON_KIT' })])
        expect(r.status).toBe(404)
        expect(m.inscripcion.create).not.toHaveBeenCalled()
    })

    it('con las inscripciones cerradas no suma integrantes', async () => {
        m.tokenAcceso.findUnique.mockResolvedValue({ id: 7, eventoId: 2, revocadoEn: null, expiraEn: null, evento: { ...evento, inscripcionesAbiertas: false } })
        const r = await agregar([persona(1, { correo: 'a@unac.edu.pe', plan: 'CON_KIT' })])
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('REGISTRATION_CLOSED')
    })

    it('suma vouchers a su delegación', async () => {
        const r = await request(app).post('/api/v1/site/delegations/link/abc123def456/payments').set('X-Api-Key', TOKEN_SITIO)
            .field('pagos', JSON.stringify([{ modalidadPago: 'billetera', billeteraDigital: 'yape', numeroOperacion: 'OP-2000', fechaPago: '2026-10-15', monto: 100 }]))
            .attach('vouchers', PDF, { filename: 'v.pdf', contentType: 'application/pdf' })
        expect(r.status).toBe(201)
        expect(m.delegacionPago.create.mock.calls[0][0].data).toMatchObject({ delegacionId: 5, numeroOperacion: 'OP-2000', monto: 100 })
    })

    it('no hay rutas para que el delegado borre integrantes ni vouchers', async () => {
        expect((await request(app).delete('/api/v1/site/delegations/link/abc123def456/participants/1').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        expect((await request(app).delete('/api/v1/site/delegations/link/abc123def456/payments/1').set('X-Api-Key', TOKEN_SITIO)).status).toBe(404)
        expect((await request(app).put('/api/v1/site/delegations/link/abc123def456').set('X-Api-Key', TOKEN_SITIO).send({ nombre: 'x' })).status).toBe(404)
    })
})

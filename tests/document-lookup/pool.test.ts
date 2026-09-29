import { prisma } from '../../src/database/prisma'
import { cifrar } from '../../src/core/crypto'
import { proveedores } from '../../src/api/document-lookup/providers'
import { FallaProveedor } from '../../src/api/document-lookup/providers/types'
import { consultarDni, enmascarar, renovarVencidos } from '../../src/api/document-lookup/services/lookup'
import { limiteAlcanzado, siguienteRenovacion } from '../../src/api/document-lookup/services/renewal'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        personaConsultada: { findUnique: jest.fn(), upsert: jest.fn() },
        consultaDocumento: { create: jest.fn() },
        tokenConsulta: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    },
}))
jest.mock('../../src/api/document-lookup/providers', () => ({
    proveedores: {
        DECOLECTA: { id: 'DECOLECTA', consultarDni: jest.fn() },
        APIPERU: { id: 'APIPERU', consultarDni: jest.fn() },
    },
}))

const m = prisma as unknown as {
    personaConsultada: { findUnique: jest.Mock, upsert: jest.Mock }
    consultaDocumento: { create: jest.Mock }
    tokenConsulta: { findMany: jest.Mock, update: jest.Mock, updateMany: jest.Mock }
}
const decolecta = proveedores.DECOLECTA.consultarDni as jest.Mock
const apiperu = proveedores.APIPERU.consultarDni as jest.Mock

function token(id: number, proveedor: 'DECOLECTA' | 'APIPERU', extra: Record<string, unknown> = {}) {
    return {
        id, proveedor, nombre: `t${id}`, tokenCifrado: cifrar(`secreto-${id}`), tokenSufijo: '0000', limiteConsultas: null, consultasUsadas: 0,
        periodoRenovacion: 'MENSUAL', fechaRenovacion: null, prioridad: id, estado: 'ACTIVO', activo: true, ...extra,
    }
}

const persona = { numero: '12345678', nombres: 'ANA', apellidoPaterno: 'QUISPE', apellidoMaterno: 'ROJAS' }

function tokensActivos(lista: ReturnType<typeof token>[]) {
    m.tokenConsulta.findMany.mockImplementation(({ where }) => Promise.resolve(where.fechaRenovacion ? [] : lista))
}

beforeEach(() => {
    jest.clearAllMocks()
    m.personaConsultada.findUnique.mockResolvedValue(null)
    m.tokenConsulta.update.mockImplementation(({ where, data }) => Promise.resolve({ ...token(where.id, 'DECOLECTA'), consultasUsadas: data.consultasUsadas?.increment ? 1 : 0, ...data }))
})

describe('pool de consultas DNI', () => {
    it('responde desde caché sin gastar tokens', async () => {
        m.personaConsultada.findUnique.mockResolvedValue({ numeroDocumento: '12345678', nombres: 'ANA', apellidoPaterno: 'QUISPE', apellidoMaterno: 'ROJAS', consultadoEn: new Date() })
        const r = await consultarDni('12345678', 'LANDING')
        expect(r.fuente).toBe('CACHE')
        expect(decolecta).not.toHaveBeenCalled()
        expect(m.consultaDocumento.create.mock.calls[0][0].data).toMatchObject({ resultado: 'CACHE', numeroMascara: '12****78' })
    })

    it('pasa al siguiente token cuando uno se agota y lo marca AGOTADO', async () => {
        tokensActivos([token(1, 'DECOLECTA'), token(2, 'APIPERU')])
        decolecta.mockRejectedValue(new FallaProveedor('AGOTADO', 'quota', 429))
        apiperu.mockResolvedValue(persona)
        const r = await consultarDni('12345678', 'LANDING')
        expect(r).toMatchObject({ nombres: 'ANA', proveedor: 'APIPERU', fuente: 'PROVEEDOR' })
        expect(m.tokenConsulta.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ estado: 'AGOTADO' }) }))
        expect(m.personaConsultada.upsert).toHaveBeenCalled()
    })

    it('marca INVALIDO un token rechazado y sigue con el próximo', async () => {
        tokensActivos([token(1, 'APIPERU'), token(2, 'APIPERU')])
        apiperu.mockRejectedValueOnce(new FallaProveedor('TOKEN_INVALIDO', 'unauthorized', 401)).mockResolvedValueOnce(persona)
        await consultarDni('12345678', 'LANDING')
        expect(m.tokenConsulta.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ estado: 'INVALIDO' }) }))
    })

    it('si un proveedor no encuentra el DNI prueba otro proveedor', async () => {
        tokensActivos([token(1, 'APIPERU'), token(2, 'APIPERU'), token(3, 'DECOLECTA')])
        apiperu.mockRejectedValue(new FallaProveedor('NO_ENCONTRADO', 'no existe', 404))
        decolecta.mockResolvedValue(persona)
        const r = await consultarDni('12345678', 'LANDING')
        expect(r.proveedor).toBe('DECOLECTA')
        expect(apiperu).toHaveBeenCalledTimes(1)
    })

    it('responde 404 si todos los proveedores dicen que no existe', async () => {
        tokensActivos([token(1, 'APIPERU'), token(2, 'DECOLECTA')])
        apiperu.mockRejectedValue(new FallaProveedor('NO_ENCONTRADO', 'no existe', 404))
        decolecta.mockRejectedValue(new FallaProveedor('NO_ENCONTRADO', 'no existe', 400))
        await expect(consultarDni('12345678', 'LANDING')).rejects.toMatchObject({ status: 404, code: 'DOCUMENT_NOT_FOUND' })
    })

    it('responde 503 cuando no hay tokens disponibles', async () => {
        tokensActivos([])
        await expect(consultarDni('12345678', 'LANDING')).rejects.toMatchObject({ status: 503, code: 'LOOKUP_UNAVAILABLE' })
        expect(m.consultaDocumento.create.mock.calls[0][0].data.resultado).toBe('SIN_TOKENS')
    })

    it('omite tokens que alcanzaron su límite local', async () => {
        tokensActivos([token(1, 'DECOLECTA', { limiteConsultas: 100, consultasUsadas: 100 }), token(2, 'APIPERU')])
        apiperu.mockResolvedValue(persona)
        await consultarDni('12345678', 'LANDING')
        expect(decolecta).not.toHaveBeenCalled()
    })

    it('valida el formato del DNI', async () => {
        await expect(consultarDni('1234', 'LANDING')).rejects.toMatchObject({ status: 422 })
    })
})

describe('renovación de cuotas', () => {
    it('renueva tokens vencidos de forma idempotente', async () => {
        const vencido = token(1, 'DECOLECTA', { estado: 'AGOTADO', consultasUsadas: 1000, fechaRenovacion: new Date('2026-09-01T00:00:00Z') })
        m.tokenConsulta.findMany.mockResolvedValue([vencido])
        await renovarVencidos(new Date('2026-09-15T00:00:00Z'))
        expect(m.tokenConsulta.updateMany).toHaveBeenCalledWith({
            where: { id: 1, fechaRenovacion: vencido.fechaRenovacion },
            data: expect.objectContaining({ consultasUsadas: 0, estado: 'ACTIVO', fechaRenovacion: new Date('2026-10-01T00:00:00Z') }),
        })
    })

    it('no reactiva tokens inválidos', async () => {
        m.tokenConsulta.findMany.mockResolvedValue([token(1, 'DECOLECTA', { estado: 'INVALIDO', fechaRenovacion: new Date('2026-09-01T00:00:00Z') })])
        await renovarVencidos(new Date('2026-09-15T00:00:00Z'))
        expect(m.tokenConsulta.updateMany.mock.calls[0][0].data.estado).toBe('INVALIDO')
    })

    it('calcula la siguiente fecha respetando fin de mes y periodos atrasados', () => {
        expect(siguienteRenovacion(new Date('2026-01-31T00:00:00Z'), 'MENSUAL', new Date('2026-02-01T00:00:00Z'))?.toISOString()).toBe('2026-02-28T00:00:00.000Z')
        expect(siguienteRenovacion(new Date('2026-06-10T00:00:00Z'), 'MENSUAL', new Date('2026-09-20T00:00:00Z'))?.toISOString()).toBe('2026-10-10T00:00:00.000Z')
        expect(siguienteRenovacion(new Date('2026-09-28T05:00:00Z'), 'DIARIO', new Date('2026-09-29T12:00:00Z'))?.toISOString()).toBe('2026-09-30T05:00:00.000Z')
        expect(siguienteRenovacion(new Date('2026-01-01T00:00:00Z'), 'NINGUNO', new Date())).toBeNull()
    })

    it('detecta el límite local', () => {
        expect(limiteAlcanzado({ limiteConsultas: null, consultasUsadas: 9999 })).toBe(false)
        expect(limiteAlcanzado({ limiteConsultas: 10, consultasUsadas: 10 })).toBe(true)
    })

    it('enmascara el documento en la bitácora', () => {
        expect(enmascarar('12345678')).toBe('12****78')
    })
})

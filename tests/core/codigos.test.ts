import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/database/prisma'
import {
    asegurarCodigoCredencial, compararHash, conReintentoDeCodigo, enmascararCorreo, esColisionDeCodigo, hashCodigoAcceso,
    nuevoCodigoAcceso, nuevoCodigoCredencial, REGEX_CODIGO_ACCESO, REGEX_CODIGO_CREDENCIAL,
} from '../../src/core/codigos'

jest.mock('../../src/database/prisma', () => ({
    prisma: { inscripcion: { findUnique: jest.fn(), updateMany: jest.fn() } },
}))

const m = prisma as unknown as { inscripcion: { findUnique: jest.Mock, updateMany: jest.Mock } }

const p2002 = (target: unknown) => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x', meta: { target } })

beforeEach(() => jest.clearAllMocks())

describe('código de acceso al portal', () => {
    it('tiene 6 dígitos (con ceros a la izquierda) y varía', () => {
        const codigos = Array.from({ length: 300 }, nuevoCodigoAcceso)
        expect(codigos.every((codigo) => REGEX_CODIGO_ACCESO.test(codigo))).toBe(true)
        expect(new Set(codigos).size).toBeGreaterThan(290)
    })

    it('el hash es un HMAC hex de 64 caracteres que depende del correo normalizado y del código', () => {
        const hash = hashCodigoAcceso('Ana@Gmail.com ', '012345')
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        expect(hashCodigoAcceso('ana@gmail.com', '012345')).toBe(hash)
        expect(hashCodigoAcceso('ana@gmail.com', '012346')).not.toBe(hash)
        expect(hashCodigoAcceso('otra@gmail.com', '012345')).not.toBe(hash)
        // No es un SHA-256 simple del texto: sin la clave derivada de JWT_SECRET no se puede adivinar
        expect(hash).not.toBe(crypto.createHash('sha256').update('ana@gmail.com:012345').digest('hex'))
    })

    it('compara hashes en tiempo constante, también con largos distintos', () => {
        const hash = hashCodigoAcceso('ana@gmail.com', '123456')
        expect(compararHash(hash, hashCodigoAcceso('ana@gmail.com', '123456'))).toBe(true)
        expect(compararHash(hash, hashCodigoAcceso('ana@gmail.com', '654321'))).toBe(false)
        expect(compararHash(hash, hash.slice(0, 10))).toBe(false)
    })
})

describe('código de la credencial', () => {
    it('tiene 10 caracteres base 36 en mayúsculas y no se repite', () => {
        const codigos = Array.from({ length: 1000 }, nuevoCodigoCredencial)
        expect(codigos.every((codigo) => REGEX_CODIGO_CREDENCIAL.test(codigo))).toBe(true)
        expect(new Set(codigos).size).toBe(1000)
        // Usa todo el alfabeto (dígitos y letras)
        const caracteres = new Set(codigos.join(''))
        expect(caracteres.size).toBe(36)
    })

    it('reconoce la colisión del índice único del código y nada más', () => {
        expect(esColisionDeCodigo(p2002('uq_inscripciones_codigo_credencial'))).toBe(true)
        expect(esColisionDeCodigo(p2002(['codigoCredencial']))).toBe(true)
        expect(esColisionDeCodigo(p2002('uq_inscripciones_numero_operacion'))).toBe(false)
        expect(esColisionDeCodigo(new Error('codigo_credencial'))).toBe(false)
    })

    it('conReintentoDeCodigo repite ante una colisión hasta 3 intentos y no repite otros errores', async () => {
        const conUnaColision = jest.fn().mockRejectedValueOnce(p2002('uq_inscripciones_codigo_credencial')).mockResolvedValue('ok')
        await expect(conReintentoDeCodigo(conUnaColision)).resolves.toBe('ok')
        expect(conUnaColision).toHaveBeenCalledTimes(2)

        const siempreChoca = jest.fn().mockRejectedValue(p2002('uq_inscripciones_codigo_credencial'))
        await expect(conReintentoDeCodigo(siempreChoca)).rejects.toMatchObject({ code: 'P2002' })
        expect(siempreChoca).toHaveBeenCalledTimes(3)

        const otroDuplicado = jest.fn().mockRejectedValue(p2002('uq_inscripciones_numero_operacion'))
        await expect(conReintentoDeCodigo(otroDuplicado)).rejects.toMatchObject({ code: 'P2002' })
        expect(otroDuplicado).toHaveBeenCalledTimes(1)
    })

    describe('asegurarCodigoCredencial', () => {
        /** Simula la fila: `updateMany` solo escribe si el código sigue en NULL. */
        function fila(inicial: { codigoCredencial: string | null, estado: string, credencialEnviadaEn?: Date | null }) {
            const estado = { codigoCredencial: inicial.codigoCredencial, esQrLegado: false }
            m.inscripcion.findUnique.mockImplementation(async () => ({
                codigoCredencial: estado.codigoCredencial, credencialEnviadaEn: inicial.credencialEnviadaEn ?? null, estado: { codigo: inicial.estado },
            }))
            m.inscripcion.updateMany.mockImplementation(async ({ where, data }: { where: { codigoCredencial: null }, data: { codigoCredencial: string, esQrLegado?: boolean } }) => {
                if (estado.codigoCredencial !== where.codigoCredencial) return { count: 0 }
                Object.assign(estado, data)
                return { count: 1 }
            })
            return estado
        }

        it('devuelve el código existente sin escribir', async () => {
            fila({ codigoCredencial: 'K7Q2M9X4TB', estado: 'APROBADO' })
            await expect(asegurarCodigoCredencial(5)).resolves.toBe('K7Q2M9X4TB')
            expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
        })

        it('una pendiente sin código recibe uno sin la marca del QR anterior', async () => {
            const estado = fila({ codigoCredencial: null, estado: 'PENDIENTE' })
            const codigo = await asegurarCodigoCredencial(5)
            expect(codigo).toMatch(REGEX_CODIGO_CREDENCIAL)
            expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 5, codigoCredencial: null }, data: { codigoCredencial: codigo } })
            expect(estado).toEqual({ codigoCredencial: codigo, esQrLegado: false })
        })

        it('una aprobada o con la credencial ya enviada queda marcada con el QR anterior', async () => {
            for (const inicial of [{ estado: 'APROBADO' }, { estado: 'EN_REVISION', credencialEnviadaEn: new Date() }]) {
                const estado = fila({ codigoCredencial: null, ...inicial })
                await asegurarCodigoCredencial(5)
                expect(estado.esQrLegado).toBe(true)
            }
        })

        it('si otro proceso lo asignó en paralelo, devuelve ese código', async () => {
            const estado = fila({ codigoCredencial: null, estado: 'PENDIENTE' })
            m.inscripcion.updateMany.mockImplementationOnce(async () => {
                estado.codigoCredencial = 'GANADOR001'
                return { count: 0 }
            })
            await expect(asegurarCodigoCredencial(5)).resolves.toBe('GANADOR001')
        })

        it('reintenta si el código generado choca con otro', async () => {
            const estado = fila({ codigoCredencial: null, estado: 'PENDIENTE' })
            const escribir = m.inscripcion.updateMany.getMockImplementation()
            m.inscripcion.updateMany.mockRejectedValueOnce(p2002('uq_inscripciones_codigo_credencial')).mockImplementation(escribir)
            const codigo = await asegurarCodigoCredencial(5)
            expect(m.inscripcion.updateMany).toHaveBeenCalledTimes(2)
            expect(estado.codigoCredencial).toBe(codigo)
        })

        it('404 si la inscripción no existe', async () => {
            m.inscripcion.findUnique.mockResolvedValue(null)
            await expect(asegurarCodigoCredencial(99)).rejects.toMatchObject({ status: 404, code: 'INSCRIPTION_NOT_FOUND' })
        })
    })
})

describe('enmascararCorreo', () => {
    it.each([
        ['ana.perez@gmail.com', 'a***@g***.com'],
        [' Ana@Gmail.COM ', 'a***@g***.com'],
        ['2020123456@undc.edu.pe', '2***@u***.edu.pe'],
        ['x@localhost', 'x***@l***'],
        ['sin-arroba', 's***'],
    ])('%s → %s', (correo, esperado) => {
        expect(enmascararCorreo(correo)).toBe(esperado)
    })
})

import fs from 'fs'
import path from 'path'
import type { Request } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/database/prisma'
import {
    ALFABETO_CROCKFORD,
    INTENTOS_NUMERACION,
    REGEX_CODIGO,
    REGEX_GENERACION,
    claveVigente,
    conReintentoDeNumeracion,
    crearConNumeroYCodigo,
    esCertificadoDuplicado,
    esCodigoValido,
    esColisionDeNumeracion,
    extraerCodigo,
    generarCodigo,
    normalizarCodigo,
    nuevaGeneracion,
    partesDeCodigo,
    siguienteNumero,
    validarPrefijo,
} from '../../src/api/certificate/codigos/codigo'
import { exigirProveedorConfirmado, proveedorActivo, proveedorPorCodigo } from '../../src/api/certificate/codigos/proveedor'
import { proveedorLocal } from '../../src/api/certificate/codigos/local'
import { proveedorUndc } from '../../src/api/certificate/codigos/undc'
import {
    DIRECTORIO_CERTIFICADOS,
    DIRECTORIO_PLANTILLAS_CERTIFICADO,
    REGEX_ARCHIVO_FIRMADO,
    REGEX_ARCHIVO_GENERADO,
    borrarArchivo,
    directorioCertificados,
    escribirArchivoAtomico,
    nombreArchivoGenerado,
    nuevoNombreFirmado,
    nuevoNombrePlantilla,
    rutaCertificadoFirmado,
    rutaCertificadoGenerado,
    rutaPlantilla,
} from '../../src/core/almacenamiento'
import {
    configuracionCertificados,
    credencialesUndcCertificados,
    reiniciarCacheConfiguracion,
    urlVerificacionCertificado,
} from '../../src/core/configuracion-sistema'
import { cifrar } from '../../src/core/crypto'
import { eventoDeCertificado, eventoDePlantilla } from '../../src/core/resolutores-evento'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        $transaction: jest.fn(),
        configuracionSistema: { findUnique: jest.fn() },
        certificado: { findUnique: jest.fn(), aggregate: jest.fn() },
        plantillaCertificado: { findUnique: jest.fn() },
    },
}))

const m = prisma as unknown as {
    $transaction: jest.Mock
    configuracionSistema: { findUnique: jest.Mock }
    certificado: { findUnique: jest.Mock, aggregate: jest.Mock }
    plantillaCertificado: { findUnique: jest.Mock }
}

const p2002 = (target: unknown) => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'x', meta: { target } })

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
})

describe('código local <PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>', () => {
    it('formato, correlativo con ceros y parte aleatoria en Crockford', () => {
        const codigo = generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 123 })
        expect(codigo).toMatch(/^CIISIC-2026-000123-[0-9A-HJKMNP-TV-Z]{6}$/)
        expect(esCodigoValido(codigo)).toBe(true)
        expect(partesDeCodigo(codigo)).toEqual({ prefijo: 'CIISIC', anio: 2026, numero: 123, aleatorio: codigo.slice(-6) })
        expect(generarCodigo({ prefijo: 'X1', anio: 2027, numero: 999_999 })).toMatch(/^X1-2027-999999-/)
        expect(ALFABETO_CROCKFORD).toHaveLength(32)
        expect(ALFABETO_CROCKFORD).not.toMatch(/[ILOU]/)
    })

    it('la parte aleatoria no se repite y solo usa el alfabeto de Crockford', () => {
        const codigos = Array.from({ length: 300 }, () => generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 1 }))
        expect(new Set(codigos).size).toBeGreaterThanOrEqual(299)
        for (const codigo of codigos) {
            expect(codigo).toMatch(REGEX_CODIGO)
            for (const caracter of codigo.slice(-6)) expect(ALFABETO_CROCKFORD).toContain(caracter)
        }
        // Los 32 símbolos aparecen (30 bits uniformes)
        expect(new Set(codigos.map((c) => c.slice(-6)).join('')).size).toBe(32)
    })

    it('prefijo inválido → 422 INVALID_PREFIX; se normaliza a mayúsculas', () => {
        for (const prefijo of ['A', 'CON-GUION', 'X'.repeat(21), 'ÑANDU', '', 'DOS PALABRAS']) {
            expect(() => generarCodigo({ prefijo, anio: 2026, numero: 1 })).toThrow(expect.objectContaining({ status: 422, code: 'INVALID_PREFIX' }))
        }
        expect(validarPrefijo(' ciisic ')).toBe('CIISIC')
        expect(generarCodigo({ prefijo: 'undc', anio: 2026, numero: 1 })).toMatch(/^UNDC-2026-000001-/)
    })

    it('año o número fuera de rango son errores de programación', () => {
        expect(() => generarCodigo({ prefijo: 'CIISIC', anio: 26, numero: 1 })).toThrow()
        expect(() => generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 0 })).toThrow()
        expect(() => generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 1_000_000 })).toThrow()
        expect(() => generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 1.5 })).toThrow()
    })

    it('nuevaGeneracion: 8 caracteres Crockford', () => {
        const generaciones = Array.from({ length: 50 }, nuevaGeneracion)
        for (const g of generaciones) expect(g).toMatch(REGEX_GENERACION)
        expect(new Set(generaciones).size).toBe(50)
    })

    it('normalizarCodigo: mayúsculas, espacios y confusiones de Crockford; formato inválido → null', () => {
        expect(normalizarCodigo(' ciisic-2026-000123-7kq2xm ')).toBe('CIISIC-2026-000123-7KQ2XM')
        expect(normalizarCodigo('CIISIC-2026-000123-7KQ2XO')).toBe('CIISIC-2026-000123-7KQ2X0')
        expect(normalizarCodigo('CIISIC-2026-000123-IL0000')).toBe('CIISIC-2026-000123-110000')
        expect(normalizarCodigo('CIISIC-2026-000123-7KQ2XU')).toBeNull()
        expect(normalizarCodigo('CIISIC-2026-123-7KQ2XM')).toBeNull()
        expect(normalizarCodigo('CIISIC-2026-000123-7KQ2XM; DROP')).toBeNull()
        expect(normalizarCodigo('x'.repeat(61))).toBeNull()
        expect(normalizarCodigo(undefined)).toBeNull()
        expect(normalizarCodigo(123)).toBeNull()
    })

    it('extraerCodigo tolera [R], _firmado, -signed, minúsculas, carpetas y el nombre del generado', () => {
        const codigo = 'CIISIC-2026-000123-7KQ2XM'
        for (const nombre of [
            `${codigo}.pdf`, `${codigo} [R].pdf`, `${codigo}[R].pdf`, `${codigo}_firmado.pdf`, `${codigo}-signed.pdf`,
            `${codigo.toLowerCase()}_firmado.pdf`, `firmados/lote 1\\${codigo}.pdf`, `cert_${codigo}.pdf`, `${codigo}-AB12CD34.pdf`,
        ]) {
            expect({ nombre, codigo: extraerCodigo(nombre) }).toEqual({ nombre, codigo })
        }
        expect(extraerCodigo(`cert${codigo}.pdf`)).toBe(`CERT${codigo}`)
        expect(extraerCodigo(`cert${codigo}.pdf`, 'CIISIC')).toBe(codigo)
        expect(extraerCodigo('UNDC-2026-000001-ABCDEF.pdf', 'CIISIC')).toBe('UNDC-2026-000001-ABCDEF')
        expect(extraerCodigo('certificado de ana.pdf')).toBeNull()
        expect(extraerCodigo('CIISIC-2026-000123-7KQ2XU.pdf')).toBeNull()
    })

    it('claveVigente distingue la ponencia', () => {
        expect(claveVigente({ eventoId: 2, participanteId: 15, tipoCertificadoId: 3 })).toBe('2:15:3:-')
        expect(claveVigente({ eventoId: 2, participanteId: 15, tipoCertificadoId: 3, ponenciaId: 'a1b2' })).toBe('2:15:3:a1b2')
    })
})

describe('numeración con reintentos', () => {
    it('distingue la colisión de número/código de la de clave vigente', () => {
        expect(esColisionDeNumeracion(p2002('uq_certificados_evento_numero'))).toBe(true)
        expect(esColisionDeNumeracion(p2002('uq_certificados_codigo'))).toBe(true)
        expect(esColisionDeNumeracion(p2002(['codigo']))).toBe(true)
        expect(esColisionDeNumeracion(p2002(['eventoId', 'numero']))).toBe(true)
        expect(esColisionDeNumeracion(p2002('uq_certificados_codigo_externo'))).toBe(false)
        expect(esColisionDeNumeracion(p2002('uq_certificados_clave_vigente'))).toBe(false)
        expect(esColisionDeNumeracion(new Error('otro'))).toBe(false)
        expect(esCertificadoDuplicado(p2002('uq_certificados_clave_vigente'))).toBe(true)
        expect(esCertificadoDuplicado(p2002('uq_certificados_codigo'))).toBe(false)
    })

    it('conReintentoDeNumeracion reintenta hasta 5 veces y no reintenta otros errores', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(p2002('uq_certificados_evento_numero'))
            .mockRejectedValueOnce(p2002('uq_certificados_codigo'))
            .mockResolvedValue('ok')
        await expect(conReintentoDeNumeracion(fn)).resolves.toBe('ok')
        expect(fn).toHaveBeenCalledTimes(3)

        const siempre = jest.fn().mockRejectedValue(p2002('uq_certificados_evento_numero'))
        await expect(conReintentoDeNumeracion(siempre)).rejects.toMatchObject({ code: 'P2002' })
        expect(siempre).toHaveBeenCalledTimes(INTENTOS_NUMERACION)

        const duplicado = jest.fn().mockRejectedValue(p2002('uq_certificados_clave_vigente'))
        await expect(conReintentoDeNumeracion(duplicado)).rejects.toMatchObject({ code: 'P2002' })
        expect(duplicado).toHaveBeenCalledTimes(1)
    })

    it('siguienteNumero: max + 1 del evento (1 si no hay)', async () => {
        const tx = { certificado: { aggregate: jest.fn().mockResolvedValueOnce({ _max: { numero: 41 } }).mockResolvedValueOnce({ _max: { numero: null } }) } }
        expect(await siguienteNumero(tx as never, 7)).toBe(42)
        expect(await siguienteNumero(tx as never, 8)).toBe(1)
        expect(tx.certificado.aggregate).toHaveBeenCalledWith({ where: { eventoId: 7 }, _max: { numero: true } })
    })

    it('crearConNumeroYCodigo: ante una emisión simultánea toma el número siguiente y un código nuevo', async () => {
        const tx = { certificado: { aggregate: jest.fn().mockResolvedValueOnce({ _max: { numero: 4 } }).mockResolvedValueOnce({ _max: { numero: 5 } }) } }
        m.$transaction.mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
        const crear = jest.fn()
            .mockRejectedValueOnce(p2002('uq_certificados_evento_numero'))
            .mockImplementation(async (_tx, numerado: { numero: number, codigo: string }) => ({ id: 1, ...numerado }))
        const creado = await crearConNumeroYCodigo({ eventoId: 2, prefijo: 'CIISIC', anio: 2026 }, crear) as { id: number, numero: number, codigo: string }
        expect(creado).toMatchObject({ id: 1, numero: 6 })
        expect(creado.codigo).toMatch(/^CIISIC-2026-000006-/)
        expect(crear.mock.calls[0][1].numero).toBe(5)
        expect(m.$transaction).toHaveBeenCalledTimes(2)
    })
})

describe('proveedor del código', () => {
    const fila = (cambios: Record<string, unknown> = {}) => ({ id: 1, urlPanel: 'https://panel.example.pe', ...cambios })

    it('LOCAL por defecto: imprime el propio código y no registra afuera', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue(fila())
        const proveedor = await proveedorActivo()
        expect(proveedor).toBe(proveedorLocal)
        expect(proveedor.codigo).toBe('LOCAL')
        await expect(proveedor.resolverImpresion({ id: 1, eventoId: 2, codigo: 'CIISIC-2026-000001-ABCDEF', codigoExterno: null }))
            .resolves.toEqual({ codigoImpreso: 'CIISIC-2026-000001-ABCDEF', codigoExterno: null })
        await expect(proveedor.probarConexion()).resolves.toBeUndefined()
        await expect(proveedor.registrar({ id: 1, eventoId: 2, codigo: 'X', codigoExterno: null })).rejects.toMatchObject({ status: 501, code: 'CERTIFICATE_PROVIDER_PENDING' })
    })

    it('UNDC responde 501 CERTIFICATE_PROVIDER_PENDING en todo hasta tener API', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue(fila({ certificadosProveedor: 'UNDC' }))
        const proveedor = await proveedorActivo()
        expect(proveedor).toBe(proveedorUndc)
        const certificado = { id: 1, eventoId: 2, codigo: 'CIISIC-2026-000001-ABCDEF', codigoExterno: null }
        await expect(proveedor.resolverImpresion(certificado)).rejects.toMatchObject({ status: 501, code: 'CERTIFICATE_PROVIDER_PENDING' })
        await expect(proveedor.registrar(certificado)).rejects.toMatchObject({ status: 501, code: 'CERTIFICATE_PROVIDER_PENDING' })
        await expect(proveedor.probarConexion()).rejects.toMatchObject({ status: 501, code: 'CERTIFICATE_PROVIDER_PENDING' })
        expect(proveedorPorCodigo('LOCAL')).toBe(proveedorLocal)
    })

    it('la descarga para firmar exige el proveedor confirmado (409 PROVIDER_NOT_CONFIRMED)', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue(fila({ certificadosProveedorConfirmado: false }))
        await expect(exigirProveedorConfirmado()).rejects.toMatchObject({ status: 409, code: 'PROVIDER_NOT_CONFIRMED' })
        reiniciarCacheConfiguracion()
        m.configuracionSistema.findUnique.mockResolvedValue(fila({ certificadosProveedorConfirmado: true, certificadosPrefijo: 'UNDC' }))
        await expect(exigirProveedorConfirmado()).resolves.toEqual({
            proveedor: 'LOCAL', prefijo: 'UNDC', proveedorConfirmado: true, baseVerificacion: 'https://panel.example.pe/verificar',
        })
    })
})

describe('configuración de certificados (configuracion_sistema)', () => {
    it('valores por defecto si la fila no trae las columnas o no existe', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, urlPanel: null })
        expect(await configuracionCertificados()).toEqual({ proveedor: 'LOCAL', prefijo: 'CIISIC', proveedorConfirmado: false, baseVerificacion: null })
        reiniciarCacheConfiguracion()
        m.configuracionSistema.findUnique.mockResolvedValue(null)
        expect(await configuracionCertificados()).toEqual({ proveedor: 'LOCAL', prefijo: 'CIISIC', proveedorConfirmado: false, baseVerificacion: null })
    })

    it('la URL de verificación sale de url_panel; sin ella → 422 VERIFICATION_URL_NOT_CONFIGURED', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, urlPanel: 'https://admin-ciisic.example.pe' })
        const { baseVerificacion } = await configuracionCertificados()
        expect(urlVerificacionCertificado(baseVerificacion, 'CIISIC-2026-000123-7KQ2XM')).toBe('https://admin-ciisic.example.pe/verificar/CIISIC-2026-000123-7KQ2XM')
        expect(urlVerificacionCertificado('https://x.pe/verificar', 'A B/C')).toBe('https://x.pe/verificar/A%20B%2FC')
        expect(() => urlVerificacionCertificado(null, 'CIISIC-2026-000123-7KQ2XM')).toThrow(expect.objectContaining({ status: 422, code: 'VERIFICATION_URL_NOT_CONFIGURED' }))
    })

    it('credenciales UNDC: el secreto se descifra; si falta algo → null', async () => {
        m.configuracionSistema.findUnique.mockResolvedValue({
            id: 1, certificadosUndcUrl: 'https://certificados.undc.edu.pe/api', certificadosUndcUsuario: 'ciisic', certificadosUndcSecretoCifrado: cifrar('s3creto'), certificadosUndcTimeoutMs: 7000,
        })
        expect(await credencialesUndcCertificados()).toEqual({ url: 'https://certificados.undc.edu.pe/api', usuario: 'ciisic', secreto: 's3creto', timeoutMs: 7000 })
        reiniciarCacheConfiguracion()
        m.configuracionSistema.findUnique.mockResolvedValue({ id: 1, certificadosUndcUrl: 'https://certificados.undc.edu.pe/api', certificadosUndcUsuario: 'ciisic' })
        expect(await credencialesUndcCertificados()).toBeNull()
    })
})

describe('archivos de certificados (uploads/certificados)', () => {
    const codigo = 'CIISIC-2026-000123-7KQ2XM'

    it('rutas por id del evento con nombres generados por el servidor', () => {
        const generado = nombreArchivoGenerado(generarCodigo({ prefijo: 'CIISIC', anio: 2026, numero: 1 }), nuevaGeneracion())
        expect(generado).toMatch(REGEX_ARCHIVO_GENERADO)
        expect(nuevoNombreFirmado(codigo)).toMatch(REGEX_ARCHIVO_FIRMADO)
        expect(nuevoNombreFirmado(codigo)).not.toBe(nuevoNombreFirmado(codigo))
        expect(rutaCertificadoGenerado(7, generado)).toBe(path.join(DIRECTORIO_CERTIFICADOS, '7', 'generados', generado))
        const firmado = nuevoNombreFirmado(codigo)
        expect(rutaCertificadoFirmado(7, firmado)).toBe(path.join(DIRECTORIO_CERTIFICADOS, '7', 'firmados', firmado))
        const plantilla = nuevoNombrePlantilla()
        expect(rutaPlantilla(plantilla)).toBe(path.join(DIRECTORIO_PLANTILLAS_CERTIFICADO, plantilla))
        expect(directorioCertificados(3, 'generados')).toBe(path.join(DIRECTORIO_CERTIFICADOS, '3', 'generados'))
    })

    it('nombres ajenos al formato del servidor no dan ruta (sin recorrer carpetas)', () => {
        for (const nombre of ['../../.env', `${codigo}-AB12CD34.pdf/../x`, `${codigo}.pdf`, `../${codigo}-AB12CD34.pdf`, `${codigo}-AB12CD34Xpdf`, 'CIISIC-2026-0001d3-7KQ2XM-AB12CD34.pdf', '', null, undefined]) {
            expect(rutaCertificadoGenerado(7, nombre)).toBeNull()
            expect(rutaCertificadoFirmado(7, nombre)).toBeNull()
            expect(rutaPlantilla(nombre)).toBeNull()
        }
        expect(() => directorioCertificados(0, 'firmados')).toThrow()
        expect(() => directorioCertificados(Number.NaN, 'firmados')).toThrow()
        expect(() => nombreArchivoGenerado('../x', 'AB12CD34')).toThrow()
        expect(() => nuevoNombreFirmado('../x')).toThrow()
    })

    it('escribirArchivoAtomico crea la carpeta, escribe y no deja temporales; si falla, borra el temporal', async () => {
        const ruta = rutaCertificadoGenerado(9, nombreArchivoGenerado(codigo, 'AB12CD34')) as string
        await escribirArchivoAtomico(ruta, new Uint8Array(Buffer.from('%PDF-1.7 hola %%EOF')))
        expect(fs.readFileSync(ruta, 'utf8')).toBe('%PDF-1.7 hola %%EOF')
        expect(fs.readdirSync(path.dirname(ruta))).toEqual([path.basename(ruta)])

        // El destino es una carpeta: el rename falla y el temporal no queda
        const carpeta = path.join(path.dirname(ruta), 'ocupado.pdf')
        fs.mkdirSync(path.join(carpeta, 'dentro'), { recursive: true })
        await expect(escribirArchivoAtomico(carpeta, new Uint8Array([1, 2, 3]))).rejects.toThrow()
        expect(fs.readdirSync(path.dirname(ruta)).filter((n) => n.endsWith('.tmp'))).toEqual([])

        await borrarArchivo(ruta)
        await borrarArchivo(ruta)
        await borrarArchivo(null)
        expect(fs.existsSync(ruta)).toBe(false)
    })
})

describe('resolutores de evento de certificados (spec 015)', () => {
    const req = (id: string) => ({ params: { id } }) as unknown as Request

    it('eventoDeCertificado y eventoDePlantilla: evento del recurso, null si no existe', async () => {
        m.certificado.findUnique.mockResolvedValueOnce({ eventoId: 4 }).mockResolvedValueOnce(null)
        expect(await eventoDeCertificado(req('10'))).toBe(4)
        expect(await eventoDeCertificado(req('11'))).toBeNull()
        expect(m.certificado.findUnique).toHaveBeenCalledWith({ where: { id: 10 }, select: { eventoId: true } })
        m.plantillaCertificado.findUnique.mockResolvedValueOnce({ eventoId: 5 }).mockResolvedValueOnce(null)
        expect(await eventoDePlantilla(req('3'))).toBe(5)
        expect(await eventoDePlantilla(req('4'))).toBeNull()
        expect(eventoDeCertificado.nombre).toBe('certificado')
        expect(eventoDePlantilla.nombre).toBe('plantilla')
    })

    it('un id inválido falla cerrado con 400 sin consultar la BD; 0x3 y 3.0 se leen como 3, igual que en el controlador', async () => {
        for (const id of ['-1', 'abc', '', '1e999']) {
            await expect(eventoDeCertificado(req(id))).rejects.toMatchObject({ status: 400, code: 'INVALID_ID' })
            await expect(eventoDePlantilla(req(id))).rejects.toMatchObject({ status: 400, code: 'INVALID_ID' })
        }
        expect(m.certificado.findUnique).not.toHaveBeenCalled()
        expect(m.plantillaCertificado.findUnique).not.toHaveBeenCalled()
        m.certificado.findUnique.mockResolvedValue({ eventoId: 4 })
        for (const id of ['0x3', '3.0']) expect(await eventoDeCertificado(req(id))).toBe(4)
        expect(m.certificado.findUnique.mock.calls.map(([args]) => args.where.id)).toEqual([3, 3])
    })
})

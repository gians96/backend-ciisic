import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import * as configuracion from '../../src/core/configuracion-sistema'
import { DIRECTORIO_CERTIFICADOS } from '../../src/core/almacenamiento'
import { credencialParaEvento, enviarConCredencial, prepararEnvioMasivo } from '../../src/api/email-credential/services/email-credential'
import { importarCertificados } from '../../src/api/certificate/services/importacion'
import { subirArchivos } from '../../src/api/certificate/services/certificados'
import { enviarCertificados } from '../../src/api/certificate/services/envio'
import type { FilaExcelCertificado } from '../../src/api/certificate/services/lector-excel'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

/**
 * Certificados (spec 015, fase 1): importación del Excel por DNI, PDF firmados emparejados por el código del nombre,
 * envío con reserva de la marca y consultas públicas. La BD y el correo están simulados.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        participante: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
        inscripcion: { findMany: jest.fn(), count: jest.fn() },
        certificado: {
            findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), groupBy: jest.fn(),
        },
    },
}))
jest.mock('../../src/api/email-credential/services/email-credential', () => ({ credencialParaEvento: jest.fn(), enviarConCredencial: jest.fn(), prepararEnvioMasivo: jest.fn() }))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    participante: { findMany: Mock, create: Mock, findUnique: Mock }
    inscripcion: { findMany: Mock, count: Mock }
    certificado: { findMany: Mock, findUnique: Mock, findFirst: Mock, create: Mock, update: Mock, updateMany: Mock, count: Mock, groupBy: Mock }
}

const evento = {
    id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC', correoContacto: 'congreso@undc.edu.pe', remitenteNombre: null, credencialCorreoId: null,
    fechaInicio: new Date('2026-10-26T00:00:00Z'), fechaFin: new Date('2026-10-30T00:00:00Z'),
}
const PANEL = 'https://admin.test'
const conPanel = (urlPanel: string | null) => jest.spyOn(configuracion, 'obtenerConfiguracion').mockResolvedValue({
    undcApiUrl: null, undcApiKeyCifrada: null, undcApiTimeoutMs: 8000, googleClientId: null, urlPanel, urlLanding: null, rutasLegacyActivas: true,
})

const filaExcel = (fila: number, cambios: Partial<FilaExcelCertificado> = {}): FilaExcelCertificado => ({
    fila, documento: '15357430', nombres: 'JUAN GUSTAVO', apellidos: 'HERNANDEZ PEVES', tipo: 'ASISTENTE', correo: 'j_hernandez@undc.edu.pe', celular: '988028491',
    codigo: 'zxDmUZLcC8', observacion: 'Docente', ...cambios,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.participante.findMany.mockResolvedValue([])
    m.inscripcion.findMany.mockResolvedValue([])
    m.certificado.findMany.mockResolvedValue([])
})

describe('importarCertificados', () => {
    it('empareja por DNI con la persona que pagó y simula sin escribir', async () => {
        m.participante.findMany.mockResolvedValueOnce([{ id: 15, tipoDocumentoId: 'dni', numeroDocumento: '15357430', correo: 'j_hernandez@undc.edu.pe' }])
        m.inscripcion.findMany.mockResolvedValueOnce([{ id: 300, participanteId: 15 }])
        const r = await importarCertificados(2, [filaExcel(2)], { aplicar: false, actorId: 1 })
        expect(r.filas[0]).toMatchObject({ resultado: 'CREAR', conInscripcion: true, personaNueva: false, codigo: 'zxDmUZLcC8' })
        expect(r.resumen).toMatchObject({ crear: 1, errores: 0, sinInscripcion: 0 })
        expect(m.certificado.create).not.toHaveBeenCalled()
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('encuentra el DNI aunque Excel se haya comido el cero y crea el certificado', async () => {
        m.participante.findMany.mockResolvedValueOnce([{ id: 7, tipoDocumentoId: 'dni', numeroDocumento: '02442123', correo: 'jferreyros@undc.edu.pe' }])
        m.certificado.create.mockResolvedValue({})
        const r = await importarCertificados(2, [filaExcel(2, { documento: '2442123', codigo: 'WBVTYDJEKq', correo: 'jferreyros@undc.edu.pe' })], { aplicar: true, actorId: 1 })
        expect(r.filas[0]).toMatchObject({ resultado: 'CREADO', documento: '02442123', conInscripcion: false })
        expect(m.certificado.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ eventoId: 2, participanteId: 7, inscripcionId: null, codigo: 'WBVTYDJEKq', claveVigente: '2:7:ASISTENTE', numeroDocumento: '02442123', importadoPorId: 1 }),
        })
    })

    it('crea a la persona que no existe con los datos del Excel', async () => {
        m.participante.create.mockResolvedValue({ id: 99, tipoDocumentoId: 'dni', numeroDocumento: '15357430', correo: 'j_hernandez@undc.edu.pe' })
        m.certificado.create.mockResolvedValue({})
        const r = await importarCertificados(2, [filaExcel(3)], { aplicar: true, actorId: 1 })
        expect(r.filas[0]).toMatchObject({ resultado: 'CREADO', personaNueva: true, conInscripcion: false })
        expect(m.participante.create).toHaveBeenCalledWith(expect.objectContaining({
            data: { tipoDocumentoId: 'dni', numeroDocumento: '15357430', nombres: 'JUAN GUSTAVO', apellidos: 'HERNANDEZ PEVES', correo: 'j_hernandez@undc.edu.pe', celular: '988028491' },
        }))
        expect(r.resumen).toMatchObject({ crear: 1, personasNuevas: 1, sinInscripcion: 1 })
    })

    it('no toca a otra persona que ya usa el correo', async () => {
        m.participante.findMany
            .mockResolvedValueOnce([]) // por documento
            .mockResolvedValueOnce([{ id: 4, tipoDocumentoId: 'dni', numeroDocumento: '11111111', correo: 'j_hernandez@undc.edu.pe' }]) // por correo
        const r = await importarCertificados(2, [filaExcel(2)], { aplicar: true, actorId: 1 })
        expect(r.filas[0]).toMatchObject({ resultado: 'ERROR' })
        expect(r.filas[0].mensaje).toMatch(/correo/)
        expect(m.participante.create).not.toHaveBeenCalled()
    })

    it('marca los códigos repetidos, los inválidos y los que son de otra persona', async () => {
        m.participante.findMany.mockResolvedValueOnce([{ id: 15, tipoDocumentoId: 'dni', numeroDocumento: '15357430', correo: 'j_hernandez@undc.edu.pe' }])
        m.certificado.findMany.mockResolvedValueOnce([{ id: 1, eventoId: 2, participanteId: 80, codigo: 'zxDmUZLcC8', estado: 'SIN_ARCHIVO', tipo: 'ASISTENTE', nombreImpreso: 'X', observacion: null, inscripcionId: null }])
        const r = await importarCertificados(2, [
            filaExcel(2),
            filaExcel(3, { documento: '22222222', codigo: 'zxDmUZLcC8' }),
            filaExcel(4, { documento: '33333333', codigo: 'con espacio-' }),
        ], { aplicar: false, actorId: 1 })
        expect(r.filas.map((f) => f.resultado)).toEqual(['ERROR', 'ERROR', 'ERROR'])
        expect(r.filas[0].mensaje).toMatch(/otro certificado/)
        expect(r.filas[1].mensaje).toMatch(/repetido/)
    })

    it('reimportar el mismo Excel no cambia nada', async () => {
        m.participante.findMany.mockResolvedValueOnce([{ id: 15, tipoDocumentoId: 'dni', numeroDocumento: '15357430', correo: 'j_hernandez@undc.edu.pe' }])
        m.certificado.findMany.mockResolvedValueOnce([{
            id: 1, eventoId: 2, participanteId: 15, codigo: 'zxDmUZLcC8', estado: 'LISTO', tipo: 'ASISTENTE', nombreImpreso: 'JUAN GUSTAVO HERNANDEZ PEVES', observacion: 'Docente', inscripcionId: null,
        }])
        const r = await importarCertificados(2, [filaExcel(2)], { aplicar: true, actorId: 1 })
        expect(r.filas[0].resultado).toBe('SIN_CAMBIOS')
        expect(m.certificado.update).not.toHaveBeenCalled()
        expect(m.certificado.create).not.toHaveBeenCalled()
    })

    it('una colisión de índice único queda como error de la fila', async () => {
        m.participante.findMany.mockResolvedValueOnce([{ id: 15, tipoDocumentoId: 'dni', numeroDocumento: '15357430', correo: 'j_hernandez@undc.edu.pe' }])
        m.certificado.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
        const r = await importarCertificados(2, [filaExcel(2)], { aplicar: true, actorId: 1 })
        expect(r.filas[0].resultado).toBe('ERROR')
    })
})

describe('subirArchivos', () => {
    const PDF = Buffer.from('%PDF-1.7\n<</Type /Sig>>\n%%EOF')

    it('asocia cada PDF por el código del nombre y guarda el archivo con un nombre del servidor', async () => {
        m.certificado.findMany.mockResolvedValueOnce([{ id: 10, eventoId: 2, codigo: '1GUdLMfaPT', estado: 'SIN_ARCHIVO', archivo: null, hashArchivo: null, nombreImpreso: 'ANA PÉREZ' }])
        m.certificado.updateMany.mockResolvedValue({ count: 1 })
        const r = await subirArchivos(2, [
            { nombreOriginal: '1GUdLMfaPT[R][R][R].pdf', contenido: PDF },
            { nombreOriginal: '1gudlmfapt[R].pdf', contenido: PDF },
            { nombreOriginal: 'sin codigo.pdf', contenido: PDF },
            { nombreOriginal: 'ZZZZZZZZZZ[R].pdf', contenido: Buffer.from('no es pdf') },
            { nombreOriginal: '1GUdLMfaPT[R].pdf', contenido: PDF },
        ], { reemplazar: false, actorId: 3 })
        expect(r.detalle.map((d) => d.resultado)).toEqual(['ASOCIADO', 'NO_ENCONTRADO', 'NOMBRE_INVALIDO', 'NO_ES_PDF', 'DUPLICADO'])
        expect(r.detalle[0]).toMatchObject({ codigo: '1GUdLMfaPT', certificadoId: 10, firmas: 1 })
        const datos = m.certificado.updateMany.mock.calls[0][0]
        expect(datos.where).toEqual({ id: 10, archivo: null, NOT: { estado: 'ANULADO' } })
        expect(datos.data).toMatchObject({ estado: 'LISTO', firmasDetectadas: 1, subidoPorId: 3 })
        expect(datos.data.archivo).toMatch(/^cert-[0-9a-f-]{36}\.pdf$/)
        expect(fs.existsSync(path.join(DIRECTORIO_CERTIFICADOS, '2', datos.data.archivo))).toBe(true)
    })

    it('sin reemplazar no pisa un PDF distinto y reconoce el mismo PDF', async () => {
        const hash = require('crypto').createHash('sha256').update(PDF).digest('hex')
        m.certificado.findMany.mockResolvedValueOnce([
            { id: 10, eventoId: 2, codigo: 'AAAA1111', estado: 'LISTO', archivo: 'cert-00000000-0000-0000-0000-000000000000.pdf', hashArchivo: hash, nombreImpreso: 'A' },
            { id: 11, eventoId: 2, codigo: 'BBBB2222', estado: 'LISTO', archivo: 'cert-00000000-0000-0000-0000-000000000001.pdf', hashArchivo: 'otro', nombreImpreso: 'B' },
            { id: 12, eventoId: 2, codigo: 'CCCC3333', estado: 'ANULADO', archivo: null, hashArchivo: null, nombreImpreso: 'C' },
        ])
        const r = await subirArchivos(2, [
            { nombreOriginal: 'AAAA1111[R].pdf', contenido: PDF },
            { nombreOriginal: 'BBBB2222[R].pdf', contenido: PDF },
            { nombreOriginal: 'CCCC3333[R].pdf', contenido: PDF },
        ], { reemplazar: false, actorId: 3 })
        expect(r.detalle.map((d) => d.resultado)).toEqual(['YA_TENIA', 'TIENE_OTRO', 'ANULADO'])
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
    })
})

describe('enviarCertificados', () => {
    const credencial = { id: 1, remitenteCorreo: 'envios@undc.edu.pe', remitenteNombre: 'CIISIC' }
    let archivo: string

    beforeAll(() => {
        archivo = 'cert-11111111-1111-1111-1111-111111111111.pdf'
        fs.mkdirSync(path.join(DIRECTORIO_CERTIFICADOS, '2'), { recursive: true })
        fs.writeFileSync(path.join(DIRECTORIO_CERTIFICADOS, '2', archivo), '%PDF-1.7 firmado')
    })

    const fila = (id: number, cambios: Record<string, unknown> = {}) => ({
        id, eventoId: 2, codigo: `CODIGO${id}AB`, tipo: 'ASISTENTE', nombreImpreso: `PERSONA ${id}`, archivo, enviadoEn: null,
        participante: { nombres: 'ANA LUCIA', correo: `p${id}@example.com` }, ...cambios,
    })

    beforeEach(() => {
        conPanel(PANEL)
        ;(credencialParaEvento as Mock).mockResolvedValue(credencial)
        ;(prepararEnvioMasivo as Mock).mockResolvedValue({ total: 100, hayDesconocida: false })
        m.certificado.update.mockResolvedValue({})
    })

    it('envía el PDF adjunto con los dos enlaces y reserva la marca', async () => {
        m.certificado.findMany.mockResolvedValueOnce([fila(1), fila(2, { enviadoEn: new Date('2026-11-01') })])
        m.certificado.updateMany.mockResolvedValue({ count: 1 })
        ;(enviarConCredencial as Mock).mockResolvedValue(null)
        const r = await enviarCertificados(2, { ids: [1, 2, 3], reenviar: false }, 5, new Date('2026-11-12T10:00:00Z'))
        expect(r).toEqual({ enviados: 1, yaEnviados: 1, noElegibles: 1, fallidos: 0 })
        const correo = (enviarConCredencial as Mock).mock.calls[0][1]
        expect(correo.para).toEqual([{ email: 'p1@example.com' }])
        expect(correo.adjuntos[0].nombre).toBe('certificado-CODIGO1AB.pdf')
        expect(Buffer.from(correo.adjuntos[0].contenidoBase64, 'base64').toString()).toBe('%PDF-1.7 firmado')
        expect(correo.html).toContain(`${PANEL}/certificado/CODIGO1AB`)
        expect(correo.html).toContain(`${PANEL}/consulta-certificados`)
        expect(correo.html).toContain('Hola, Ana')
        expect(m.certificado.updateMany).toHaveBeenCalledWith({ where: { id: 1, estado: 'LISTO', enviadoEn: null }, data: { enviadoEn: new Date('2026-11-12T10:00:00Z') } })
    })

    it('si el correo falla, devuelve la marca y guarda el motivo', async () => {
        m.certificado.findMany.mockResolvedValueOnce([fila(1)])
        m.certificado.updateMany.mockResolvedValue({ count: 1 })
        ;(enviarConCredencial as Mock).mockResolvedValue('Buzón inexistente')
        const ahora = new Date('2026-11-12T10:00:00Z')
        const r = await enviarCertificados(2, { ids: [1], reenviar: false }, 5, ahora)
        expect(r).toMatchObject({ enviados: 0, fallidos: 1 })
        expect(m.certificado.updateMany).toHaveBeenLastCalledWith({ where: { id: 1, estado: 'LISTO', enviadoEn: ahora }, data: { enviadoEn: null } })
        expect(m.certificado.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { envioError: 'Buzón inexistente' } })
    })

    it('sin la URL del panel no envía nada', async () => {
        conPanel(null)
        await expect(enviarCertificados(2, { ids: [1], reenviar: false }, 5)).rejects.toMatchObject({ status: 409, code: 'PANEL_URL_MISSING' })
        expect(enviarConCredencial).not.toHaveBeenCalled()
    })
})

describe('rutas', () => {
    const owner = () => `Bearer ${tokenDeRol('SUPERADMIN', 5)}`

    it('la lista exige sesión de staff', async () => {
        const r = await request(app).get('/api/v1/events/2/certificates')
        expect(r.status).toBe(401)
    })

    it('la lista devuelve la situación y los totales del evento', async () => {
        m.certificado.findMany.mockResolvedValueOnce([{
            id: 1, codigo: 'WBVTYDJEKq', tipo: 'ASISTENTE', estado: 'LISTO', nombreImpreso: 'JAIR', numeroDocumento: '02442123', observacion: null, inscripcionId: 3, firmasDetectadas: 3,
            bytesArchivo: 1000, subidoEn: null, enviadoEn: null, envioError: null, anuladoEn: null, motivoAnulacion: null, creadoEn: new Date(), participante: { id: 7, correo: 'j@undc.edu.pe', celular: '9' },
        }])
        m.certificado.count.mockResolvedValue(1)
        m.certificado.groupBy.mockResolvedValue([{ estado: 'LISTO', _count: { _all: 1 } }])
        m.inscripcion.count.mockResolvedValue(4)
        const r = await request(app).get('/api/v1/events/2/certificates?situacion=POR_ENTREGAR').set('Authorization', owner())
        expect(r.status).toBe(200)
        expect(r.body.data[0]).toMatchObject({ codigo: 'WBVTYDJEKq', situacion: 'POR_ENTREGAR', conInscripcion: true })
        expect(r.body.meta.resumen).toMatchObject({ porEntregar: 0, pagadosSinCertificado: 4 })
    })

    it('un filtro inválido es 422', async () => {
        const r = await request(app).get('/api/v1/events/2/certificates?situacion=OTRA').set('Authorization', owner())
        expect(r.status).toBe(422)
    })

    it('la consulta por DNI devuelve los certificados listos sin el documento', async () => {
        m.certificado.findMany.mockResolvedValueOnce([{
            id: 1, eventoId: 2, codigo: 'WBVTYDJEKq', tipo: 'ASISTENTE', nombreImpreso: 'JAIR FERREYROS', archivo: 'x', subidoEn: new Date('2026-11-10T00:00:00Z'),
            evento: { nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC', fechaInicio: evento.fechaInicio, fechaFin: evento.fechaFin },
        }])
        const r = await request(app).post('/api/v1/public/certificates/lookup').send({ documento: '2442123' })
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(m.certificado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { estado: 'LISTO', numeroDocumento: { in: ['02442123', '2442123'] } } }))
        expect(r.body.data.certificados[0]).toEqual({
            codigo: 'WBVTYDJEKq', tipo: 'ASISTENTE', titular: 'JAIR FERREYROS',
            evento: { nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC', fechaInicio: '2026-10-26', fechaFin: '2026-10-30' }, emitidoEn: '2026-11-10T00:00:00.000Z',
        })
        expect(JSON.stringify(r.body)).not.toContain('02442123')
    })

    it('un DNI sin certificados y uno inválido responden el mismo 404', async () => {
        const sin = await request(app).post('/api/v1/public/certificates/lookup').send({ documento: '12345678' })
        const invalido = await request(app).post('/api/v1/public/certificates/lookup').send({ documento: 'abc' })
        expect(sin.status).toBe(404)
        expect(invalido.status).toBe(404)
        expect(sin.body.code).toBe('CERTIFICATE_NOT_FOUND')
        expect(invalido.body.code).toBe('CERTIFICATE_NOT_FOUND')
    })

    it('un código mal formado es 404 sin consultar la BD; uno sin PDF también es 404', async () => {
        const mal = await request(app).get('/api/v1/public/certificates/no-valido!')
        expect(mal.status).toBe(404)
        expect(m.certificado.findUnique).not.toHaveBeenCalled()
        m.certificado.findUnique.mockResolvedValueOnce({ codigo: 'WBVTYDJEKq', estado: 'SIN_ARCHIVO' })
        const sinPdf = await request(app).get('/api/v1/public/certificates/WBVTYDJEKq')
        expect(sinPdf.status).toBe(404)
    })

    it('el código distingue mayúsculas', async () => {
        m.certificado.findUnique.mockResolvedValueOnce({ codigo: 'WBVTYDJEKq', estado: 'LISTO' })
        const r = await request(app).get('/api/v1/public/certificates/wbvtydjekq')
        expect(r.status).toBe(404)
    })

    it('el portal lista los certificados listos del participante', async () => {
        m.certificado.findMany.mockResolvedValueOnce([{
            id: 1, eventoId: 2, codigo: 'WBVTYDJEKq', tipo: 'ASISTENTE', nombreImpreso: 'ANA', archivo: 'x', subidoEn: new Date('2026-11-10T00:00:00Z'),
            evento: { nombre: 'VIII CIISIC 2026', nombreCorto: 'VIII CIISIC', fechaInicio: evento.fechaInicio, fechaFin: evento.fechaFin },
        }])
        m.participante.findUnique.mockResolvedValueOnce({ correo: 'ana@gmail.com' })
        const r = await request(app).get('/api/v1/me/certificates').set('Authorization', `Bearer ${tokenDeParticipante(50)}`)
        expect(r.status).toBe(200)
        expect(m.certificado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { participanteId: 50, estado: 'LISTO' } }))
        expect(r.body.data[0]).toMatchObject({ id: 1, codigoImpreso: 'WBVTYDJEKq', tipo: 'Asistente', estado: 'FIRMADO', descargable: true })
    })
})

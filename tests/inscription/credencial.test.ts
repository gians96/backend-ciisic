import fs from 'fs'
import path from 'path'
import { Prisma } from '@prisma/client'
import type { Evento } from '@prisma/client'
import puppeteer from 'puppeteer'
import QRCode from 'qrcode'
import { prisma } from '../../src/database/prisma'
import { DIRECTORIO_FOTOS, DIRECTORIO_UPLOADS, nuevoNombreFoto } from '../../src/core/almacenamiento'
import { REGEX_CODIGO_CREDENCIAL } from '../../src/core/codigos'
import { borrarCredenciales, generarCredencialPdf, huellaCredencial, rutaCredencial } from '../../src/api/inscription/utils/generatePdf'
import { archivoCredencial, cambiarEstado, crearInscripcion, eliminarInscripcion, reenviarCredencial } from '../../src/api/inscription/services/inscription'
import { enviarCorreoAprobacion } from '../../src/api/inscription/utils/sendEmail'
import type { InscripcionDetalle } from '../../src/api/inscription/services/mappers'
import type { CrearInscripcionInput } from '../../src/api/inscription/validation'

jest.mock('../../src/database/prisma', () => {
    const mock: Record<string, unknown> = {
        tipoInscripcion: { findFirst: jest.fn() },
        clasificacion: { findUnique: jest.fn() },
        personaConsultada: { findUnique: jest.fn() },
        participante: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        inscripcion: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    }
    mock.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mock))
    return { prisma: mock }
})
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoAprobacion: jest.fn() }))
// Puppeteer y el QR se simulan: la prueba revisa el HTML que se imprimiría y los archivos
jest.mock('qrcode', () => ({ toDataURL: jest.fn(async (texto: string) => `data:image/png;base64,${Buffer.from(texto).toString('base64')}`) }))
jest.mock('puppeteer', () => ({ launch: jest.fn() }))

type Mock = jest.Mock
const m = prisma as unknown as {
    $transaction: Mock
    tipoInscripcion: { findFirst: Mock }, clasificacion: { findUnique: Mock }, personaConsultada: { findUnique: Mock }
    participante: { findUnique: Mock, create: Mock, update: Mock }
    inscripcion: { findUnique: Mock, create: Mock, update: Mock, updateMany: Mock, delete: Mock }
}
const lanzar = puppeteer.launch as unknown as Mock
const aQr = QRCode.toDataURL as unknown as Mock
const enviarCorreo = enviarCorreoAprobacion as Mock

// ─── Navegador simulado ────────────────────────────────────────────────────

let htmlImpresos: string[] = []
let activos = 0
let maximoActivos = 0
/** Si está definido, `page.pdf` espera a que la prueba lo libere. */
let bloqueo: Promise<void> | null = null

function navegadorSimulado() {
    activos++
    maximoActivos = Math.max(maximoActivos, activos)
    const page = {
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        setContent: jest.fn(async (html: string) => {
            htmlImpresos.push(html)
        }),
        pdf: jest.fn(async () => {
            if (bloqueo) await bloqueo
            return Buffer.from('%PDF-1.4 simulado')
        }),
    }
    return { newPage: async () => page, close: jest.fn(async () => { activos-- }) }
}

// ─── Datos ─────────────────────────────────────────────────────────────────

const evento = { id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', telefonoContacto: null, correoContacto: null, logoArchivo: null, actualizadoEn: new Date('2026-09-01T00:00:00Z') }

function inscripcion(cambios: Record<string, unknown> = {}, participante: Record<string, unknown> = {}): InscripcionDetalle {
    return {
        id: 5, eventoId: 2, participanteId: 50, creadoEn: new Date('2026-09-20T15:00:00Z'), actualizadoEn: new Date('2026-09-20T15:00:00Z'),
        revisadoEn: new Date('2026-09-21T15:00:00Z'), credencialEnviadaEn: null, codigoCredencial: 'K7Q2M9X4TB', esQrLegado: false,
        estado: { id: 3, codigo: 'APROBADO', nombre: 'Aprobado' },
        evento,
        participante: {
            id: 50, tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana <b>', apellidos: 'Pérez', correo: 'ana@gmail.com', celular: '987654321',
            fotoArchivo: null, actualizadoEn: new Date('2026-09-01T00:00:00Z'), ...participante,
        },
        tipoInscripcion: { id: 7, nombre: 'General', etiqueta: 'CON KIT', categoria: { id: 3, codigo: 'PUBLICO_GENERAL', nombre: 'Público general', esEstudiantil: false } },
        clasificacion: null,
        revisadoPor: null,
        ...cambios,
    } as unknown as InscripcionDetalle
}

const carpetaEvento = path.join(DIRECTORIO_UPLOADS, 'credenciales', evento.codigo)
const archivosDe = (carpeta: string) => (fs.existsSync(carpeta) ? fs.readdirSync(carpeta).sort() : [])

beforeEach(() => {
    jest.clearAllMocks()
    lanzar.mockImplementation(async () => navegadorSimulado())
    htmlImpresos = []
    activos = 0
    maximoActivos = 0
    bloqueo = null
    fs.rmSync(path.join(DIRECTORIO_UPLOADS, 'credenciales'), { recursive: true, force: true })
})

describe('PDF de la credencial (spec 014)', () => {
    it('el QR codifica el código de la credencial, que también se imprime; los datos van escapados', async () => {
        const ruta = await generarCredencialPdf(inscripcion())
        expect(aQr).toHaveBeenCalledWith('K7Q2M9X4TB')
        expect(path.basename(ruta)).toMatch(/^5-[0-9a-f]{12}\.pdf$/)
        expect(fs.readFileSync(ruta, 'utf8')).toBe('%PDF-1.4 simulado')
        const html = htmlImpresos[0]
        expect(html).toContain('<div class="codigo-credencial">K7Q2M9X4TB</div>')
        expect(html).toContain(`src="data:image/png;base64,${Buffer.from('K7Q2M9X4TB').toString('base64')}"`)
        expect(html).toContain('Ana &lt;b&gt;')
        expect(html).toContain('class="persona sin-foto"')
        expect(html).not.toContain('{{')
    })

    it('con foto, la incrusta como data URL', async () => {
        const foto = nuevoNombreFoto('jpg')
        fs.mkdirSync(DIRECTORIO_FOTOS, { recursive: true })
        fs.writeFileSync(path.join(DIRECTORIO_FOTOS, foto), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
        await generarCredencialPdf(inscripcion({}, { fotoArchivo: foto }))
        expect(htmlImpresos[0]).toContain('class="persona con-foto"')
        expect(htmlImpresos[0]).toContain(`src="data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}"`)
    })

    it('un nombre de foto que no es del servidor se ignora', async () => {
        await generarCredencialPdf(inscripcion({}, { fotoArchivo: '../../etc/passwd' }))
        expect(htmlImpresos[0]).toContain('class="persona sin-foto"')
    })

    it('sin código no se genera', async () => {
        await expect(generarCredencialPdf(inscripcion({ codigoCredencial: null }))).rejects.toThrow(/código de credencial/)
        expect(lanzar).not.toHaveBeenCalled()
    })

    it('la huella cambia con el código, la foto, los datos impresos, el tipo y el evento, y no con lo que no se imprime', () => {
        const base = huellaCredencial(inscripcion())
        expect(base).toMatch(/^[0-9a-f]{12}$/)
        for (const distinta of [
            inscripcion({ codigoCredencial: 'ZZZZZZZZZZ' }),
            inscripcion({}, { fotoArchivo: nuevoNombreFoto('png') }),
            inscripcion({}, { apellidos: 'Pérez Corregido' }),
            inscripcion({}, { numeroDocumento: '87654321' }),
            inscripcion({ tipoInscripcion: { id: 7, nombre: 'General', etiqueta: 'SIN KIT', categoria: {} } }),
            inscripcion({ evento: { ...evento, actualizadoEn: new Date('2026-09-02T00:00:00Z') } }),
            inscripcion({ revisadoEn: new Date('2026-09-25T15:00:00Z') }),
        ]) {
            expect(huellaCredencial(distinta)).not.toBe(base)
        }
        // No se imprimen: la cuenta de Google, la hora exacta de revisión ni la marca del QR anterior
        expect(huellaCredencial(inscripcion({ esQrLegado: true, revisadoEn: new Date('2026-09-21T16:00:00Z') }, { googleSub: 'g-1', actualizadoEn: new Date() }))).toBe(base)
    })

    it('al generar una versión nueva borra las anteriores de esa inscripción y solo de ella', async () => {
        fs.mkdirSync(carpetaEvento, { recursive: true })
        const otroEvento = path.join(DIRECTORIO_UPLOADS, 'credenciales', 'ciisic-vii-2025')
        fs.mkdirSync(otroEvento, { recursive: true })
        for (const archivo of ['5.pdf', '5-aaaaaaaaaaaa.pdf', '50.pdf', '50-aaaaaaaaaaaa.pdf', '15-bbbbbbbbbbbb.pdf', 'notas.txt']) fs.writeFileSync(path.join(carpetaEvento, archivo), 'x')
        fs.writeFileSync(path.join(otroEvento, '5-cccccccccccc.pdf'), 'x')
        const ruta = await generarCredencialPdf(inscripcion())
        expect(archivosDe(carpetaEvento)).toEqual(['15-bbbbbbbbbbbb.pdf', '50-aaaaaaaaaaaa.pdf', '50.pdf', path.basename(ruta), 'notas.txt'].sort())
        expect(archivosDe(otroEvento)).toEqual([])
    })

    it('borrarCredenciales elimina <id>.pdf y <id>-<huella>.pdf salvo el que se conserva', () => {
        fs.mkdirSync(carpetaEvento, { recursive: true })
        for (const archivo of ['5.pdf', '5-aaaaaaaaaaaa.pdf', '5-bbbbbbbbbbbb.pdf', '55.pdf']) fs.writeFileSync(path.join(carpetaEvento, archivo), 'x')
        expect(borrarCredenciales(5, path.join(carpetaEvento, '5-bbbbbbbbbbbb.pdf'))).toBe(2)
        expect(archivosDe(carpetaEvento)).toEqual(['5-bbbbbbbbbbbb.pdf', '55.pdf'])
        expect(borrarCredenciales(5)).toBe(1)
        expect(borrarCredenciales(5)).toBe(0)
    })

    it('pedir el mismo PDF dos veces a la vez abre un solo navegador', async () => {
        const [a, b] = await Promise.all([generarCredencialPdf(inscripcion()), generarCredencialPdf(inscripcion())])
        expect(a).toBe(b)
        expect(lanzar).toHaveBeenCalledTimes(1)
    })

    it('una generación que termina tarde (con datos anteriores) no borra el PDF de otra que empezó después', async () => {
        let liberarAnterior: () => void = () => undefined
        const anteriorBloqueada = new Promise<void>((resolve) => {
            liberarAnterior = resolve
        })
        lanzar.mockImplementationOnce(async () => {
            const navegador = navegadorSimulado()
            const page = await navegador.newPage()
            page.pdf.mockImplementationOnce(async () => {
                await anteriorBloqueada
                return Buffer.from('%PDF-1.4 anterior')
            })
            return navegador
        })
        const anterior = generarCredencialPdf(inscripcion())
        const nueva = await generarCredencialPdf(inscripcion({}, { apellidos: 'Pérez Corregido' }))
        liberarAnterior()
        const rutaAnterior = await anterior
        expect(rutaAnterior).not.toBe(nueva)
        // La más nueva sigue ahí (la que se sirve, por su huella); la anterior queda como sobrante
        expect(archivosDe(carpetaEvento)).toEqual([path.basename(rutaAnterior), path.basename(nueva)].sort())
        // La próxima generación limpia los sobrantes
        const otra = await generarCredencialPdf(inscripcion({}, { apellidos: 'Pérez Otra Vez' }))
        expect(archivosDe(carpetaEvento)).toEqual([path.basename(otra)])
    })

    it('no abre más de 2 navegadores a la vez y con la cola llena responde PDF_BUSY', async () => {
        let liberar: () => void = () => undefined
        bloqueo = new Promise((resolve) => {
            liberar = resolve
        })
        // 2 imprimiendo + 30 en cola; la siguiente se rechaza
        const pedidos = Array.from({ length: 32 }, (_, i) => generarCredencialPdf(inscripcion({ id: 100 + i })))
        await expect(generarCredencialPdf(inscripcion({ id: 200 }))).rejects.toMatchObject({ status: 503, code: 'PDF_BUSY' })
        await new Promise((resolve) => setImmediate(resolve))
        expect(activos).toBe(2)
        liberar()
        const rutas = await Promise.all(pedidos)
        expect(new Set(rutas).size).toBe(32)
        expect(maximoActivos).toBe(2)
        expect(lanzar).toHaveBeenCalledTimes(32)
    })
})

describe('credencial en el servicio de inscripciones', () => {
    /** Fila simulada: `findUnique` la devuelve y `updateMany` solo escribe si el código sigue en NULL. */
    function filaEnBd(inicial: InscripcionDetalle) {
        const fila = { ...inicial } as InscripcionDetalle
        m.inscripcion.findUnique.mockImplementation(async () => ({ ...fila }))
        m.inscripcion.updateMany.mockImplementation(async ({ where, data }: { where: { codigoCredencial: null }, data: Partial<InscripcionDetalle> }) => {
            if (fila.codigoCredencial !== where.codigoCredencial) return { count: 0 }
            Object.assign(fila, data)
            return { count: 1 }
        })
        m.inscripcion.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            if (data.estado) Object.assign(fila, { estado: { id: 3, codigo: 'APROBADO', nombre: 'Aprobado' }, revisadoEn: new Date('2026-09-21T15:00:00Z') })
            return { ...fila }
        })
        return fila
    }

    it('la descarga de una inscripción sin código (imagen anterior) le asigna uno y la marca con el QR anterior', async () => {
        const fila = filaEnBd(inscripcion({ codigoCredencial: null, credencialEnviadaEn: new Date('2026-09-21T16:00:00Z') }))
        const ruta = await archivoCredencial(5)
        expect(fila.codigoCredencial).toMatch(REGEX_CODIGO_CREDENCIAL)
        expect(fila.esQrLegado).toBe(true)
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 5, codigoCredencial: null }, data: { codigoCredencial: fila.codigoCredencial, esQrLegado: true } })
        expect(aQr).toHaveBeenCalledWith(fila.codigoCredencial)
        expect(ruta).toBe(rutaCredencial({ ...fila }))
    })

    it('la descarga reutiliza el PDF si sigue al día y lo regenera si cambió lo impreso', async () => {
        filaEnBd(inscripcion())
        const primera = await archivoCredencial(5)
        expect(await archivoCredencial(5)).toBe(primera)
        expect(lanzar).toHaveBeenCalledTimes(1)
        filaEnBd(inscripcion({}, { apellidos: 'Pérez Corregido' }))
        const segunda = await archivoCredencial(5)
        expect(segunda).not.toBe(primera)
        expect(lanzar).toHaveBeenCalledTimes(2)
        expect(archivosDe(carpetaEvento)).toEqual([path.basename(segunda)])
    })

    it('aprobar una inscripción sin código lo asigna antes de aprobar (sin la marca del QR anterior) y envía el QR nuevo', async () => {
        const fila = filaEnBd(inscripcion({ codigoCredencial: null, estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' }, revisadoEn: null }))
        enviarCorreo.mockResolvedValue(true)
        const { credencialEnviada } = await cambiarEstado(5, 'APROBADO', null, 1)
        expect(credencialEnviada).toBe(true)
        expect(fila.codigoCredencial).toMatch(REGEX_CODIGO_CREDENCIAL)
        expect(fila.esQrLegado).toBe(false)
        expect(m.inscripcion.updateMany.mock.invocationCallOrder[0]).toBeLessThan(m.inscripcion.update.mock.invocationCallOrder[0])
        expect(aQr).toHaveBeenCalledWith(fila.codigoCredencial)
        expect(enviarCorreo).toHaveBeenCalledWith(expect.objectContaining({ codigoCredencial: fila.codigoCredencial }), expect.stringMatching(/5-[0-9a-f]{12}\.pdf$/))
    })

    it('el reenvío de una credencial sin código también lo asigna', async () => {
        const fila = filaEnBd(inscripcion({ codigoCredencial: null }))
        enviarCorreo.mockResolvedValue(true)
        await expect(reenviarCredencial(5)).resolves.toEqual({ credencialEnviada: true })
        expect(aQr).toHaveBeenCalledWith(fila.codigoCredencial)
    })

    it('un PDF_BUSY al aprobar no deshace la aprobación: la credencial queda sin enviar', async () => {
        filaEnBd(inscripcion({ estado: { id: 1, codigo: 'PENDIENTE', nombre: 'Pendiente' } }))
        let liberar: () => void = () => undefined
        bloqueo = new Promise((resolve) => {
            liberar = resolve
        })
        const ocupados = Array.from({ length: 32 }, (_, i) => generarCredencialPdf(inscripcion({ id: 300 + i })))
        const { credencialEnviada } = await cambiarEstado(5, 'APROBADO', null, 1)
        expect(credencialEnviada).toBe(false)
        expect(enviarCorreo).not.toHaveBeenCalled()
        liberar()
        await Promise.all(ocupados)
    })

    it('al eliminar la inscripción se borran todas sus credenciales', async () => {
        filaEnBd(inscripcion())
        fs.mkdirSync(carpetaEvento, { recursive: true })
        for (const archivo of ['5.pdf', '5-aaaaaaaaaaaa.pdf', '6.pdf']) fs.writeFileSync(path.join(carpetaEvento, archivo), 'x')
        await eliminarInscripcion(5)
        expect(archivosDe(carpetaEvento)).toEqual(['6.pdf'])
    })
})

describe('código de la credencial al crear la inscripción', () => {
    const eventoAbierto = { id: 2, codigo: 'ciisic-viii-2026', estado: 'PUBLICADO', inscripcionesAbiertas: true, inscripcionesInicio: null, inscripcionesFin: null, dominioInstitucional: 'undc.edu.pe' } as unknown as Evento
    const tipoGeneral = { id: 3, activo: true, precio: new Prisma.Decimal(140), precioInstitucional: new Prisma.Decimal(120), categoria: { id: 2, eventoId: 2, codigo: 'PUBLICO_GENERAL', esEstudiantil: false } }
    const entrada = {
        participante: { tipoDocumento: 'dni', numeroDocumento: '12345678', nombres: 'Juan', apellidos: 'Pérez', correo: 'juan@gmail.com', celular: '987654321' },
        tipoInscripcionId: 3, clasificacionId: null, modalidadPago: 'banco', banco: 'bcp', tipoOperacion: 'directo', billeteraDigital: null,
        numeroOperacion: 'OP-123', fechaPago: '2026-09-20', verificacionToken: null,
    } as unknown as CrearInscripcionInput
    const p2002 = (target: string) => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target } })
    const codigosCreados = () => m.inscripcion.create.mock.calls.map(([args]) => (args as { data: { codigoCredencial: string } }).data.codigoCredencial)

    beforeEach(() => {
        m.tipoInscripcion.findFirst.mockResolvedValue(tipoGeneral)
        m.personaConsultada.findUnique.mockResolvedValue(null)
        m.participante.findUnique.mockResolvedValue(null)
        m.participante.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 10, ...data }))
        m.inscripcion.findUnique.mockResolvedValue(null)
        m.inscripcion.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 99, ...data }))
    })

    it.each([[false], [true]])('se asigna al crear (legacy: %s)', async (legacy) => {
        await crearInscripcion(eventoAbierto, entrada, legacy ? null : 'voucher-1.png', { legacy })
        expect(codigosCreados()).toEqual([expect.stringMatching(REGEX_CODIGO_CREDENCIAL)])
    })

    it('si el código choca, repite la transacción con otro código', async () => {
        m.inscripcion.create.mockRejectedValueOnce(p2002('uq_inscripciones_codigo_credencial'))
        await expect(crearInscripcion(eventoAbierto, entrada, 'voucher-1.png')).resolves.toMatchObject({ id: 99 })
        const [primero, segundo] = codigosCreados()
        expect(m.$transaction).toHaveBeenCalledTimes(2)
        expect(segundo).not.toBe(primero)
    })

    it('tras 3 choques responde 409 y otros duplicados no se repiten', async () => {
        m.inscripcion.create.mockRejectedValue(p2002('uq_inscripciones_codigo_credencial'))
        await expect(crearInscripcion(eventoAbierto, entrada, 'voucher-1.png')).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_RECORD' })
        expect(m.$transaction).toHaveBeenCalledTimes(3)

        m.$transaction.mockClear()
        m.inscripcion.create.mockRejectedValue(p2002('uq_inscripciones_numero_operacion'))
        await expect(crearInscripcion(eventoAbierto, entrada, 'voucher-1.png')).rejects.toMatchObject({ status: 409, code: 'OPERATION_ALREADY_REGISTERED' })
        expect(m.$transaction).toHaveBeenCalledTimes(1)
    })
})

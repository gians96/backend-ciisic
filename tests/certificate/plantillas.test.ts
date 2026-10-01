import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { PDFDocument } from 'pdf-lib'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { reiniciarCacheConfiguracion } from '../../src/core/configuracion-sistema'
import { DIRECTORIO_PLANTILLAS_CERTIFICADO, MAX_BYTES_PLANTILLA, nuevoNombrePlantilla, rutaPlantilla } from '../../src/core/almacenamiento'
import { PERMISOS_ELEGIBLES_COMISION } from '../../src/core/permisos'
import { encabezadoAvisos, type AvisoVistaPrevia } from '../../src/api/certificate/services/plantillas'
import { validarCampos } from '../../src/api/certificate/validation/plantillas'
import { CODIGOS_FUENTE } from '../../src/api/certificate/pdf/fuentes'
import { cifradoSimulado, disenoDePrueba } from '../helpers/pdf'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        plantillaCertificado: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
        tipoCertificado: { findUnique: jest.fn(), findFirst: jest.fn() },
        certificado: { count: jest.fn(), updateMany: jest.fn() },
        configuracionSistema: { findUnique: jest.fn() },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    },
}))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    plantillaCertificado: Record<'findUnique' | 'findMany' | 'create' | 'updateMany' | 'delete', Mock>
    tipoCertificado: Record<'findUnique' | 'findFirst', Mock>
    certificado: { count: Mock, updateMany: Mock }
    configuracionSistema: { findUnique: Mock }
    $transaction: Mock
    $queryRaw: Mock
}

const OWNER = () => `Bearer ${tokenDeRol('SUPERADMIN')}`
const ADMIN = () => `Bearer ${tokenDeRol('ADMIN')}`
const TESORERO = () => `Bearer ${tokenDeRol('TESORERO', 30, { eventoIds: [2] })}`
const COMISION = () => `Bearer ${tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: [...PERMISOS_ELEGIBLES_COMISION] })}`

const EVENTO = {
    id: 2,
    codigo: 'CIISIC-VIII',
    nombre: 'VIII Congreso Internacional de Ingeniería de Sistemas',
    nombreCorto: 'VIII CIISIC',
    fechaInicio: new Date('2026-10-27T05:00:00Z'),
    fechaFin: new Date('2026-10-31T05:00:00Z'),
}

interface Fila {
    id: number
    eventoId: number
    nombre: string
    archivoDiseno: string
    archivoOriginal: string
    tamanoBytes: number
    paginas: number
    anchoPt: number
    altoPt: number
    campos: unknown
    horasPorDefecto: number | null
    firmasRequeridas: number
    version: number
    activa: boolean
    creadoPorId: number | null
    creadoEn: Date
    actualizadoEn: Date
}

let filas: Map<number, Fila>
let siguienteId: number
/** Certificados por plantilla (para `enUso` y `TEMPLATE_IN_USE`). */
let certificados: Record<number, number>
let urlPanel: string | null

const conInclude = (fila: Fila, include?: { evento?: boolean }) => ({
    ...fila,
    creadoPor: null,
    _count: { certificados: certificados[fila.id] ?? 0 },
    ...(include?.evento ? { evento: EVENTO } : {}),
})

/** Aplica `data` de Prisma (con `{ increment }`) a una fila. */
function aplicar(fila: Fila, data: Record<string, unknown>): Fila {
    const nueva = { ...fila } as Record<string, unknown>
    for (const [clave, valor] of Object.entries(data)) {
        nueva[clave] = valor && typeof valor === 'object' && 'increment' in valor ? (nueva[clave] as number) + (valor as { increment: number }).increment : valor
    }
    return nueva as unknown as Fila
}

beforeEach(() => {
    jest.clearAllMocks()
    reiniciarCacheConfiguracion()
    fs.rmSync(DIRECTORIO_PLANTILLAS_CERTIFICADO, { recursive: true, force: true })
    filas = new Map()
    siguienteId = 7
    certificados = {}
    urlPanel = 'https://admin-ciisic.episundc.pe'

    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === EVENTO.id ? EVENTO : null))
    m.configuracionSistema.findUnique.mockImplementation(() => Promise.resolve({ id: 1, urlPanel, certificadosPrefijo: 'CIISIC', certificadosProveedor: 'LOCAL', certificadosProveedorConfirmado: false }))
    m.plantillaCertificado.findUnique.mockImplementation(({ where, include }) => {
        const fila = filas.get(where.id)
        return Promise.resolve(fila ? conInclude(fila, include) : null)
    })
    m.plantillaCertificado.findMany.mockImplementation(({ where }) => Promise.resolve([...filas.values()].filter((f) => f.eventoId === where.eventoId).map((f) => conInclude(f))))
    m.plantillaCertificado.create.mockImplementation(({ data }) => {
        const fila = { id: siguienteId++, version: 1, activa: true, creadoEn: new Date(), actualizadoEn: new Date(), ...data } as Fila
        filas.set(fila.id, fila)
        return Promise.resolve(conInclude(fila))
    })
    m.plantillaCertificado.updateMany.mockImplementation(({ where, data }) => {
        const fila = filas.get(where.id)
        if (!fila || fila.version !== where.version || (where.archivoDiseno && where.archivoDiseno !== fila.archivoDiseno)) return Promise.resolve({ count: 0 })
        filas.set(fila.id, aplicar(fila, data))
        return Promise.resolve({ count: 1 })
    })
    m.plantillaCertificado.delete.mockImplementation(({ where }) => {
        filas.delete(where.id)
        return Promise.resolve({})
    })
    m.certificado.count.mockImplementation(({ where }) => Promise.resolve(certificados[where.plantillaId] ?? 0))
    m.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
    m.$queryRaw.mockImplementation((_partes: TemplateStringsArray, id: number) => {
        const fila = filas.get(id)
        return Promise.resolve(fila ? [{ archivo: fila.archivoDiseno }] : [])
    })
    m.tipoCertificado.findUnique.mockImplementation(({ where }) => Promise.resolve(where.codigo === 'PONENTE' ? { id: 3, codigo: 'PONENTE', textoImpreso: 'PONENTE', activo: true } : null))
    m.tipoCertificado.findFirst.mockResolvedValue({ id: 1, codigo: 'PARTICIPANTE', textoImpreso: 'PARTICIPANTE', activo: true })
})

/** Archivos de diseño en disco (sin temporales). */
const disenosEnDisco = () => (fs.existsSync(DIRECTORIO_PLANTILLAS_CERTIFICADO) ? fs.readdirSync(DIRECTORIO_PLANTILLAS_CERTIFICADO).sort() : [])

/** Plantilla ya guardada (fila + PDF en disco). */
/** Como MySQL guarda un JSON: las claves de cada objeto ordenadas por largo y luego por bytes. */
function comoMysql<T>(valor: T): T {
    if (Array.isArray(valor)) return valor.map(comoMysql) as T
    if (valor && typeof valor === 'object') {
        const claves = Object.keys(valor).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        return Object.fromEntries(claves.map((k) => [k, comoMysql((valor as Record<string, unknown>)[k])])) as T
    }
    return valor
}

async function plantillaGuardada(opciones: { paginas?: number, campos?: unknown[], version?: number, firmasRequeridas?: number } = {}): Promise<Fila> {
    const bytes = await disenoDePrueba({ paginas: opciones.paginas ?? 1 })
    const archivoDiseno = nuevoNombrePlantilla()
    fs.mkdirSync(DIRECTORIO_PLANTILLAS_CERTIFICADO, { recursive: true })
    fs.writeFileSync(rutaPlantilla(archivoDiseno) as string, bytes)
    const fila: Fila = {
        id: 5, eventoId: 2, nombre: 'Diseño general', archivoDiseno, archivoOriginal: 'diseño.pdf', tamanoBytes: bytes.byteLength,
        paginas: opciones.paginas ?? 1, anchoPt: 841.89, altoPt: 595.28, campos: comoMysql(opciones.campos ?? CAMPOS_GUARDADOS), horasPorDefecto: 24,
        firmasRequeridas: opciones.firmasRequeridas ?? 1, version: opciones.version ?? 1, activa: true, creadoPorId: 2, creadoEn: new Date(), actualizadoEn: new Date(),
    }
    filas.set(fila.id, fila)
    return fila
}

/** Campos ya normalizados, como quedan guardados. */
const CAMPOS_GUARDADOS = [
    { id: 'nombre', tipo: 'NOMBRE', pagina: 1, x: 100, y: 300, ancho: 640, fuente: 'PINYON_SCRIPT', tamano: 36, tamanoMinimo: 18, alineacion: 'CENTRO' },
    { id: 'tipo', tipo: 'TIPO', pagina: 1, x: 100, y: 250, ancho: 640, fuente: 'MONTSERRAT_BOLD', tamano: 18, alineacion: 'CENTRO' },
    { id: 'qr', tipo: 'QR', pagina: 1, x: 700, y: 40, lado: 90 },
    { id: 'codigo', tipo: 'CODIGO', pagina: 1, x: 700, y: 30, tamano: 8 },
]

/** Respuesta binaria de supertest como Buffer (superagent pasa el flujo de la respuesta). */
const binario = ((res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void) => {
    const partes: Buffer[] = []
    res.on('data', (parte: Buffer) => partes.push(Buffer.from(parte)))
    res.on('end', () => callback(null, Buffer.concat(partes)))
}) as unknown as Parameters<request.Test['parse']>[0]

const subir = (url: string, bytes: Uint8Array | Buffer, opciones: { filename?: string, contentType?: string, campos?: Record<string, string>, metodo?: 'post' | 'put', token?: string } = {}) => {
    let r = request(app)[opciones.metodo ?? 'post'](url).set('Authorization', opciones.token ?? ADMIN())
    for (const [clave, valor] of Object.entries(opciones.campos ?? {})) r = r.field(clave, valor)
    return r.attach('file', Buffer.from(bytes), { filename: opciones.filename ?? 'Diseño CIISIC 2026.pdf', contentType: opciones.contentType ?? 'application/pdf' })
}

describe('acceso: todo es de certificados.gestionar', () => {
    const RUTAS: [string, 'get' | 'post' | 'put' | 'delete'][] = [
        ['/api/v1/certificate-fonts', 'get'],
        ['/api/v1/events/2/certificate-templates', 'get'],
        ['/api/v1/events/2/certificate-templates', 'post'],
        ['/api/v1/certificate-templates/5', 'get'],
        ['/api/v1/certificate-templates/5', 'put'],
        ['/api/v1/certificate-templates/5', 'delete'],
        ['/api/v1/certificate-templates/5/design', 'get'],
        ['/api/v1/certificate-templates/5/design', 'put'],
        ['/api/v1/certificate-templates/5/preview', 'post'],
    ]

    it.each(RUTAS)('%s (%s): 401 sin sesión, 403 al Tesorero y a la Comisión con todos sus permisos elegibles', async (url, metodo) => {
        await plantillaGuardada()
        expect((await request(app)[metodo](url)).status).toBe(401)
        for (const token of [TESORERO(), COMISION()]) {
            const r = await request(app)[metodo](url).set('Authorization', token).send({ nombre: 'Otro' })
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect(m.plantillaCertificado.findUnique).not.toHaveBeenCalled()
        expect(m.plantillaCertificado.findMany).not.toHaveBeenCalled()
        expect(m.evento.findUnique).not.toHaveBeenCalled()
    })

    it('el Owner y el Administrador entran', async () => {
        for (const token of [OWNER(), ADMIN()]) {
            expect((await request(app).get('/api/v1/events/2/certificate-templates').set('Authorization', token)).status).toBe(200)
        }
    })
})

describe('GET /v1/certificate-fonts', () => {
    it('devuelve el catálogo de fuentes incluidas', async () => {
        const r = await request(app).get('/api/v1/certificate-fonts').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.body.data.map((f: { codigo: string }) => f.codigo)).toEqual(CODIGOS_FUENTE)
        expect(r.body.data[0]).toEqual({ codigo: 'MONTSERRAT', nombre: expect.any(String) })
    })
})

describe('POST /v1/events/:eventId/certificate-templates', () => {
    it('guarda el diseño en disco con nombre del servidor y responde sus medidas (sin la ruta)', async () => {
        const bytes = await disenoDePrueba()
        const r = await subir('/api/v1/events/2/certificate-templates', bytes, { campos: { horasPorDefecto: '40' } })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({
            id: 7, eventoId: 2, nombre: 'Diseño CIISIC 2026', archivoOriginal: 'Diseño CIISIC 2026.pdf', tamanoBytes: bytes.byteLength,
            paginas: 1, anchoPt: 841.89, altoPt: 595.28, campos: [], horasPorDefecto: 40, firmasRequeridas: 1, version: 1, activa: true,
            totalCertificados: 0, enUso: false,
        })
        expect(r.body.data).not.toHaveProperty('archivoDiseno')
        const enDisco = disenosEnDisco()
        expect(enDisco).toHaveLength(1)
        expect(enDisco[0]).toMatch(/^plantilla-[0-9a-f-]{36}\.pdf$/)
        expect(fs.readFileSync(path.join(DIRECTORIO_PLANTILLAS_CERTIFICADO, enDisco[0]))).toEqual(Buffer.from(bytes))
        expect(m.plantillaCertificado.create.mock.calls[0][0].data).toMatchObject({ archivoDiseno: enDisco[0], creadoPorId: 2 })
    })

    it('acepta los campos en JSON (multipart) y los normaliza: id, página, medidas a centésimas y color en minúsculas', async () => {
        const campos = [
            { tipo: 'NOMBRE', x: 100.123, y: 300, ancho: 640, alineacion: 'CENTRO', color: '#1A2B3C', extra: 'se descarta' },
            { id: 'pie', tipo: 'TEXTO', pagina: 2, x: 50, y: 40, texto: 'Otorgado a {nombre} por {horas} horas', lineasMax: 2 },
        ]
        const r = await subir('/api/v1/events/2/certificate-templates', await disenoDePrueba({ paginas: 2 }), { campos: { nombre: 'Anverso y reverso', campos: JSON.stringify(campos) } })
        expect(r.status).toBe(201)
        expect(r.body.data).toMatchObject({ nombre: 'Anverso y reverso', paginas: 2 })
        expect(r.body.data.campos).toEqual([
            { id: 'nombre-1', tipo: 'NOMBRE', pagina: 1, x: 100.12, y: 300, ancho: 640, color: '#1a2b3c', alineacion: 'CENTRO' },
            { id: 'pie', tipo: 'TEXTO', pagina: 2, x: 50, y: 40, lineasMax: 2, texto: 'Otorgado a {nombre} por {horas} horas' },
        ])
    })

    it.each([
        ['cifrado', () => disenoDePrueba().then(cifradoSimulado), 422, 'PDF_ENCRYPTED'],
        ['rotado', () => disenoDePrueba({ rotacion: 90 }), 422, 'PDF_ROTATED'],
        ['de 3 páginas', () => disenoDePrueba({ paginas: 3 }), 422, 'PDF_TOO_MANY_PAGES'],
        ['que no es un PDF', async () => Buffer.from('<html>hola</html>'), 422, 'INVALID_PDF'],
        ['con la firma de PDF pero roto', async () => Buffer.from('%PDF-1.7\nbasura sin objetos ni páginas\n%%EOF'), 422, 'INVALID_PDF'],
        ['de más de 5 MB', async () => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MAX_BYTES_PLANTILLA)]), 413, 'UPLOAD_LIMIT_EXCEEDED'],
    ])('rechaza un diseño %s sin guardar nada', async (_caso, crear, estado, codigo) => {
        const r = await subir('/api/v1/events/2/certificate-templates', await crear())
        expect(r.status).toBe(estado)
        expect(r.body.code).toBe(codigo)
        expect(m.plantillaCertificado.create).not.toHaveBeenCalled()
        expect(disenosEnDisco()).toEqual([])
    })

    it('exige un archivo .pdf', async () => {
        const otraExtension = await subir('/api/v1/events/2/certificate-templates', await disenoDePrueba(), { filename: 'diseno.png', contentType: 'image/png' })
        expect(otraExtension.status).toBe(422)
        expect(otraExtension.body.code).toBe('INVALID_PDF')
        const sinArchivo = await request(app).post('/api/v1/events/2/certificate-templates').set('Authorization', ADMIN()).field('nombre', 'Sin archivo')
        expect(sinArchivo.status).toBe(422)
        expect(sinArchivo.body).toMatchObject({ code: 'FILE_REQUIRED', fields: { file: expect.any(String) } })
        expect(disenosEnDisco()).toEqual([])
    })

    it('evento inexistente → 404 sin escribir el archivo', async () => {
        const r = await subir('/api/v1/events/99/certificate-templates', await disenoDePrueba())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('EVENT_NOT_FOUND')
        expect(disenosEnDisco()).toEqual([])
    })

    it('valida el resto del formulario (horas y firmas)', async () => {
        const r = await subir('/api/v1/events/2/certificate-templates', await disenoDePrueba(), { campos: { horasPorDefecto: '-1', firmasRequeridas: '9' } })
        expect(r.status).toBe(422)
        expect(Object.keys(r.body.fields).sort()).toEqual(['firmasRequeridas', 'horasPorDefecto'])
        expect(disenosEnDisco()).toEqual([])
    })

    it('si la BD falla, borra el diseño que ya escribió', async () => {
        m.plantillaCertificado.create.mockRejectedValueOnce(new Error('BD caída'))
        const r = await subir('/api/v1/events/2/certificate-templates', await disenoDePrueba())
        expect(r.status).toBe(500)
        expect(disenosEnDisco()).toEqual([])
    })
})

describe('campos inválidos → 422 INVALID_TEMPLATE_FIELDS con un mensaje por campo', () => {
    it('devuelve a la vez los errores de formato y los de página, texto e id repetido', async () => {
        const campos = [
            { tipo: 'NOMBRE', x: 100, y: 300, tamano: 300 },
            { tipo: 'QR', pagina: 2, x: 10, y: 10, lado: 80 },
            { tipo: 'TEXTO', x: 1, y: 1 },
            { tipo: 'FIRMA', x: 1, y: 1 },
            { id: 'codigo', tipo: 'CODIGO', x: 1, y: 1, color: 'rojo', fuente: 'COMIC_SANS' },
            { id: 'codigo', tipo: 'FECHA_EMISION', x: 1, y: 1 },
            { tipo: 'HORAS', x: 1, y: 1, tamano: 10, tamanoMinimo: 14 },
            { tipo: 'DETALLE', y: 1, alineacion: 'JUSTIFICADO', lineasMax: 0 },
            'no soy un objeto',
        ]
        const r = await subir('/api/v1/events/2/certificate-templates', await disenoDePrueba(), { campos: { campos: JSON.stringify(campos) } })
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('INVALID_TEMPLATE_FIELDS')
        expect(Object.keys(r.body.fields).sort()).toEqual([
            'campos[0].tamano',
            'campos[1].pagina',
            'campos[2].texto',
            'campos[3].tipo',
            'campos[4].color',
            'campos[4].fuente',
            'campos[5].id',
            'campos[6].tamanoMinimo',
            'campos[7].alineacion',
            'campos[7].lineasMax',
            'campos[7].x',
            'campos[8]',
        ].sort())
        expect(r.body.fields['campos[1].pagina']).toBe('El diseño tiene 1 página')
        expect(r.body.fields['campos[5].id']).toContain('campos[4]')
        expect(disenosEnDisco()).toEqual([])
    })

    it.each([
        ['más de 30 campos', Array.from({ length: 31 }, (_v, i) => ({ id: `t${i}`, tipo: 'TEXTO', x: 1, y: 1, texto: 'x' })), 'campos', /30/],
        ['no es una lista', { tipo: 'NOMBRE' }, 'campos', /lista/],
        ['JSON roto', '[{"tipo":', 'campos', /lista/],
    ])('%s', async (_caso, campos, clave, mensaje) => {
        await expect(validarCampos(typeof campos === 'string' ? campos : JSON.stringify(campos), 1)).rejects.toMatchObject({
            status: 422, code: 'INVALID_TEMPLATE_FIELDS', fields: { [clave]: expect.stringMatching(mensaje) },
        })
    })

    it('el QR mide de 36 a 300 pt y la fuente debe ser del catálogo', async () => {
        await expect(validarCampos([{ tipo: 'QR', x: 1, y: 1, lado: 20 }, { tipo: 'NOMBRE', x: 1, y: 1, fuente: 'PARISIENNE' }], 1)).rejects.toMatchObject({
            fields: { 'campos[0].lado': expect.stringContaining('36') },
        })
        await expect(validarCampos([{ tipo: 'QR', x: 1, y: 1, lado: 300 }, { tipo: 'NOMBRE', x: 1, y: 1, fuente: 'PARISIENNE' }], 1)).resolves.toHaveLength(2)
    })
})

describe('GET /v1/events/:eventId/certificate-templates y GET /v1/certificate-templates/:id', () => {
    it('lista las plantillas del evento con su uso', async () => {
        await plantillaGuardada()
        certificados[5] = 12
        const r = await request(app).get('/api/v1/events/2/certificate-templates').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual([expect.objectContaining({ id: 5, nombre: 'Diseño general', totalCertificados: 12, enUso: true, campos: CAMPOS_GUARDADOS })])
        expect(m.plantillaCertificado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventoId: 2 } }))
    })

    it('404 si el evento o la plantilla no existen', async () => {
        const evento = await request(app).get('/api/v1/events/99/certificate-templates').set('Authorization', ADMIN())
        expect(evento.status).toBe(404)
        expect(evento.body.code).toBe('EVENT_NOT_FOUND')
        const plantilla = await request(app).get('/api/v1/certificate-templates/99').set('Authorization', ADMIN())
        expect(plantilla.status).toBe(404)
        expect(plantilla.body.code).toBe('TEMPLATE_NOT_FOUND')
    })

    it('el detalle trae los campos y la versión', async () => {
        await plantillaGuardada({ version: 3 })
        const r = await request(app).get('/api/v1/certificate-templates/5').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ id: 5, version: 3, campos: CAMPOS_GUARDADOS, horasPorDefecto: 24 })
    })
})

describe('PUT /v1/certificate-templates/:id', () => {
    it('cambiar los campos sube la versión (escritura condicionada a la versión leída)', async () => {
        await plantillaGuardada()
        const campos = [...CAMPOS_GUARDADOS, { id: 'fecha', tipo: 'FECHA_EMISION', x: 100, y: 80, formatoFecha: 'CORTO' }]
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ campos })
        expect(r.status).toBe(200)
        expect(r.body.data.version).toBe(2)
        expect(r.body.data.campos).toHaveLength(5)
        expect(m.plantillaCertificado.updateMany).toHaveBeenCalledWith({ where: { id: 5, version: 1 }, data: expect.objectContaining({ version: { increment: 1 } }) })
    })

    it('guardar sin cambios lo que devolvió el GET (claves en el orden de MySQL) no sube la versión', async () => {
        await plantillaGuardada()
        const leida = await request(app).get('/api/v1/certificate-templates/5').set('Authorization', ADMIN())
        expect(Object.keys(leida.body.data.campos[0])[0]).toBe('x')
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ campos: leida.body.data.campos, version: 1 })
        expect(r.status).toBe(200)
        expect(r.body.data.version).toBe(1)
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()
    })

    it('bajar las firmas requeridas deja FIRMADO a los parciales que ya las tienen; subirlas no toca nada', async () => {
        await plantillaGuardada({ firmasRequeridas: 3 })
        m.certificado.updateMany.mockResolvedValue({ count: 2 })
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ firmasRequeridas: 2 })
        expect(r.status).toBe(200)
        expect(m.certificado.updateMany).toHaveBeenCalledWith({
            where: { plantillaId: 5, estado: 'EN_FIRMA', firmasDetectadas: { gte: 2 } },
            data: { estado: 'FIRMADO', firmadoEn: expect.any(Date) },
        })
        m.certificado.updateMany.mockClear()
        await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ firmasRequeridas: 4 })
        expect(m.certificado.updateMany).not.toHaveBeenCalled()
        log.mockRestore()
    })

    it('los mismos campos (otro orden de claves, sin nulos) no suben la versión ni escriben', async () => {
        await plantillaGuardada()
        const iguales = CAMPOS_GUARDADOS.map((campo) => Object.fromEntries([...Object.entries(campo)].reverse().concat([['color', null]])))
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ campos: iguales })
        expect(r.status).toBe(200)
        expect(r.body.data.version).toBe(1)
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()
    })

    it('nombre, horas, firmas y activa no cambian la versión', async () => {
        await plantillaGuardada()
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ nombre: 'Diseño 2026', horasPorDefecto: null, firmasRequeridas: 2, activa: false })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ nombre: 'Diseño 2026', horasPorDefecto: null, firmasRequeridas: 2, activa: false, version: 1 })
        expect(m.plantillaCertificado.updateMany.mock.calls[0][0].data).toEqual({ nombre: 'Diseño 2026', horasPorDefecto: null, firmasRequeridas: 2, activa: false })
    })

    it('409 TEMPLATE_CHANGED si el editor tiene una versión vieja o la plantilla cambió en medio', async () => {
        await plantillaGuardada({ version: 4 })
        const vieja = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ version: 3, nombre: 'Otro nombre' })
        expect(vieja.status).toBe(409)
        expect(vieja.body.code).toBe('TEMPLATE_CHANGED')
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()

        m.plantillaCertificado.updateMany.mockResolvedValueOnce({ count: 0 })
        const carrera = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ version: 4, nombre: 'Otro nombre' })
        expect(carrera.status).toBe(409)
        expect(carrera.body.code).toBe('TEMPLATE_CHANGED')
    })

    it('campos en una página que el diseño no tiene → 422 con el campo señalado', async () => {
        await plantillaGuardada()
        const r = await request(app).put('/api/v1/certificate-templates/5').set('Authorization', ADMIN()).send({ campos: [{ id: 'reverso', tipo: 'CODIGO', pagina: 2, x: 1, y: 1 }] })
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'INVALID_TEMPLATE_FIELDS', fields: { 'campos[0].pagina': 'El diseño tiene 1 página' } })
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()
    })

    it('404 si no existe', async () => {
        const r = await request(app).put('/api/v1/certificate-templates/99').set('Authorization', ADMIN()).send({ nombre: 'Otro nombre' })
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('TEMPLATE_NOT_FOUND')
    })
})

describe('DELETE /v1/certificate-templates/:id', () => {
    it('con certificados → 409 TEMPLATE_IN_USE y el diseño se conserva', async () => {
        const fila = await plantillaGuardada()
        certificados[5] = 1
        const r = await request(app).delete('/api/v1/certificate-templates/5').set('Authorization', ADMIN())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('TEMPLATE_IN_USE')
        expect(m.plantillaCertificado.delete).not.toHaveBeenCalled()
        expect(disenosEnDisco()).toEqual([fila.archivoDiseno])
    })

    it('sin certificados la borra (con la fila bloqueada) y luego el archivo', async () => {
        await plantillaGuardada()
        const r = await request(app).delete('/api/v1/certificate-templates/5').set('Authorization', ADMIN())
        expect(r.status).toBe(200)
        expect(r.body).toEqual({ success: true, data: null })
        expect(m.$queryRaw.mock.calls[0][0].join('?')).toMatch(/FOR UPDATE/)
        expect(m.plantillaCertificado.delete).toHaveBeenCalledWith({ where: { id: 5 } })
        expect(disenosEnDisco()).toEqual([])
    })

    it('404 si no existe', async () => {
        const r = await request(app).delete('/api/v1/certificate-templates/99').set('Authorization', ADMIN())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('TEMPLATE_NOT_FOUND')
    })
})

describe('GET/PUT /v1/certificate-templates/:id/design', () => {
    it('GET entrega el PDF de diseño sin caché', async () => {
        const fila = await plantillaGuardada()
        const r = await request(app).get('/api/v1/certificate-templates/5/design').set('Authorization', ADMIN()).buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('application/pdf')
        expect(r.headers['cache-control']).toBe('private, no-store')
        expect(r.headers['content-disposition']).toBe('inline; filename="plantilla-5-v1.pdf"')
        expect(r.body).toEqual(fs.readFileSync(rutaPlantilla(fila.archivoDiseno) as string))
    })

    it('GET responde 404 si el archivo ya no está', async () => {
        const fila = await plantillaGuardada()
        fs.rmSync(rutaPlantilla(fila.archivoDiseno) as string)
        const r = await request(app).get('/api/v1/certificate-templates/5/design').set('Authorization', ADMIN())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('TEMPLATE_DESIGN_NOT_FOUND')
    })

    it('PUT reemplaza el diseño: versión +1, archivo nuevo y el anterior se borra', async () => {
        const anterior = await plantillaGuardada()
        const nuevo = await disenoDePrueba({ paginas: 2, tamano: [595.28, 841.89] })
        const r = await subir('/api/v1/certificate-templates/5/design', nuevo, { metodo: 'put', filename: 'vertical.pdf' })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ version: 2, paginas: 2, anchoPt: 595.28, altoPt: 841.89, archivoOriginal: 'vertical.pdf', campos: CAMPOS_GUARDADOS })
        const enDisco = disenosEnDisco()
        expect(enDisco).toHaveLength(1)
        expect(enDisco[0]).not.toBe(anterior.archivoDiseno)
        expect(fs.readFileSync(rutaPlantilla(enDisco[0]) as string)).toEqual(Buffer.from(nuevo))
    })

    it('PUT rechaza un diseño con menos páginas que las que usan los campos, y deja el anterior', async () => {
        const anterior = await plantillaGuardada({ paginas: 2, campos: [...CAMPOS_GUARDADOS, { id: 'reverso', tipo: 'TEXTO', pagina: 2, x: 1, y: 1, texto: 'Reverso' }] })
        const r = await subir('/api/v1/certificate-templates/5/design', await disenoDePrueba(), { metodo: 'put' })
        expect(r.status).toBe(422)
        expect(r.body).toMatchObject({ code: 'INVALID_TEMPLATE_FIELDS', fields: { 'campos[4].pagina': 'El nuevo diseño tiene 1 página' } })
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()
        expect(disenosEnDisco()).toEqual([anterior.archivoDiseno])
    })

    it('PUT valida el PDF igual que al crear y borra el nuevo si otro lo cambió en medio', async () => {
        const anterior = await plantillaGuardada()
        const rotado = await subir('/api/v1/certificate-templates/5/design', await disenoDePrueba({ rotacion: 270 }), { metodo: 'put' })
        expect(rotado.status).toBe(422)
        expect(rotado.body.code).toBe('PDF_ROTATED')

        m.plantillaCertificado.updateMany.mockResolvedValueOnce({ count: 0 })
        const carrera = await subir('/api/v1/certificate-templates/5/design', await disenoDePrueba(), { metodo: 'put' })
        expect(carrera.status).toBe(409)
        expect(carrera.body.code).toBe('TEMPLATE_CHANGED')
        expect(disenosEnDisco()).toEqual([anterior.archivoDiseno])
    })
})

describe('POST /v1/certificate-templates/:id/preview', () => {
    const avisosDe = (r: request.Response): AvisoVistaPrevia[] => JSON.parse(decodeURIComponent(r.headers['x-avisos']))

    it('devuelve el PDF estampado con datos de ejemplo, el prefijo vigente y sin avisos', async () => {
        await plantillaGuardada()
        const r = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({}).buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toBe('application/pdf')
        expect(r.headers['cache-control']).toBe('no-store')
        expect(avisosDe(r)).toEqual([])
        expect(r.headers['x-avisos-total']).toBe('0')
        const doc = await PDFDocument.load(r.body as Buffer, { updateMetadata: false })
        expect(doc.getPageCount()).toBe(1)
        expect(doc.getSubject()).toMatch(/^ciisic:CIISIC-2026-000123-7KQ2XM:[0-9A-HJKMNP-TV-Z]{8}$/)
        expect(doc.getTitle()).toBe('Certificado CIISIC-2026-000123-7KQ2XM')
        // Sin tipo, usa el primero activo del catálogo
        expect(m.tipoCertificado.findFirst).toHaveBeenCalled()
    }, 20_000)

    it('usa los campos sin guardar, el tipo y los datos que envía el editor; no escribe nada', async () => {
        await plantillaGuardada()
        const r = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN())
            .send({ campos: [{ tipo: 'NOMBRE', x: 100, y: 300 }], tipoCodigo: 'ponente', datos: { nombre: 'Ana Pérez', fechaEmision: '2026-11-02', horas: null } })
            .buffer(true).parse(binario)
        expect(r.status).toBe(200)
        expect(m.tipoCertificado.findUnique).toHaveBeenCalledWith({ where: { codigo: 'PONENTE' } })
        expect(m.plantillaCertificado.updateMany).not.toHaveBeenCalled()
        expect(m.plantillaCertificado.create).not.toHaveBeenCalled()
    })

    it('avisa (sin 500) cuando un carácter no está en ninguna fuente: X-Avisos va con encodeURIComponent', async () => {
        await plantillaGuardada()
        const r = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({ datos: { nombre: 'Lǐ Míng 李明' } })
        expect(r.status).toBe(200)
        expect(r.headers['x-avisos']).toMatch(/^[\x20-\x7e]*$/)
        const avisos = avisosDe(r)
        expect(avisos).toContainEqual({ campo: 'nombre', codigo: 'GLIFO_FALTANTE', mensaje: expect.stringContaining('李明') })
        expect(r.headers['x-avisos-total']).toBe(String(avisos.length))
    })

    it('sin URL del panel el QR es de ejemplo y lo avisa', async () => {
        urlPanel = null
        await plantillaGuardada()
        const r = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({})
        expect(r.status).toBe(200)
        expect(avisosDe(r)).toContainEqual(expect.objectContaining({ campo: null, codigo: 'URL_VERIFICACION_NO_CONFIGURADA' }))
    })

    it('tipo desconocido, campos o datos inválidos → 422; plantilla inexistente → 404', async () => {
        await plantillaGuardada()
        const tipo = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({ tipoCodigo: 'JURADO' })
        expect(tipo.status).toBe(422)
        expect(tipo.body.code).toBe('CERTIFICATE_TYPE_NOT_FOUND')
        const campos = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({ campos: [{ tipo: 'QR', x: 1, y: 1, lado: 5 }] })
        expect(campos.status).toBe(422)
        expect(campos.body).toMatchObject({ code: 'INVALID_TEMPLATE_FIELDS', fields: { 'campos[0].lado': expect.any(String) } })
        const datos = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({ datos: { fechaEmision: '02/11/2026' } })
        expect(datos.status).toBe(422)
        expect(datos.body.fields).toHaveProperty(['datos.fechaEmision'])
        const ninguna = await request(app).post('/api/v1/certificate-templates/99/preview').set('Authorization', ADMIN()).send({})
        expect(ninguna.status).toBe(404)
        expect(ninguna.body.code).toBe('TEMPLATE_NOT_FOUND')
    })

    it('si falta el archivo de diseño → 404 TEMPLATE_DESIGN_NOT_FOUND', async () => {
        const fila = await plantillaGuardada()
        fs.rmSync(rutaPlantilla(fila.archivoDiseno) as string)
        const r = await request(app).post('/api/v1/certificate-templates/5/preview').set('Authorization', ADMIN()).send({})
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('TEMPLATE_DESIGN_NOT_FOUND')
    })
})

describe('encabezadoAvisos', () => {
    it('recorta a ~3,5 KB y el último aviso dice cuántos faltan', () => {
        const avisos: AvisoVistaPrevia[] = Array.from({ length: 80 }, (_v, i) => ({ campo: `campo-${i}`, codigo: 'DESBORDA', mensaje: `El texto «ñandú ${i}» no entra en la caja ni a 8 pt: sale de los márgenes.` }))
        const encabezado = encabezadoAvisos(avisos)
        expect(encabezado.length).toBeLessThanOrEqual(3500)
        const leidos = JSON.parse(decodeURIComponent(encabezado)) as AvisoVistaPrevia[]
        const ultimo = leidos[leidos.length - 1]
        expect(ultimo.codigo).toBe('MAS_AVISOS')
        expect(ultimo.mensaje).toBe(`Y ${80 - (leidos.length - 1)} avisos más.`)
        expect(leidos.slice(0, -1)).toEqual(avisos.slice(0, leidos.length - 1))
    })

    it('sin recorte cuando entran todos', () => {
        const avisos: AvisoVistaPrevia[] = [{ campo: 'nombre', codigo: 'GLIFO_RESPALDO', mensaje: 'Pinyon Script no tiene «Ǐ»' }]
        expect(JSON.parse(decodeURIComponent(encabezadoAvisos(avisos)))).toEqual(avisos)
    })
})

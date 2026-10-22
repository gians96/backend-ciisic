import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { credencialParaEvento, enviarConCredencial } from '../../src/api/email-credential/services/email-credential'
import { htmlComunicado } from '../../src/api/specialized-talk/services/avisos'
import { situacionDe, variantesDocumento } from '../../src/core/ponencias-especializadas'
import { tokenDeRol } from '../helpers/tokens'
import { reiniciar, sembrarAsistente, sembrarInscripcion, sembrarPonencia, type EstadoBd } from '../helpers/bd-ponencias'

jest.mock('../../src/database/prisma', () => {
    const { crearBdPonencias } = jest.requireActual('../helpers/bd-ponencias') as typeof import('../helpers/bd-ponencias')
    const { bd, cliente } = crearBdPonencias()
    return { prisma: { ...cliente, __bd: bd, evento: { findUnique: jest.fn() }, participante: { findMany: jest.fn() } } }
})
// Nunca se envía un correo real: la credencial y el envío están simulados
jest.mock('../../src/api/email-credential/services/email-credential', () => ({
    ...jest.requireActual('../../src/api/email-credential/services/email-credential'),
    credencialParaEvento: jest.fn(),
    enviarConCredencial: jest.fn(),
}))

type Fila = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const m = prisma as unknown as { __bd: EstadoBd, evento: { findUnique: jest.Mock }, participante: { findMany: jest.Mock } }
const credencial = credencialParaEvento as jest.Mock
const enviar = enviarConCredencial as jest.Mock

const con = (token: string) => ({ Authorization: `Bearer ${token}` })
const admin = () => tokenDeRol('ADMIN', 2)
const comision = (permisos: string[], eventoIds = [2]) => tokenDeRol('COMISION', 40, { eventoIds, permisos })
const RUTA = '/api/v1/events/2/specialized-talk-attendees'

let evento: Fila
/** Participantes del congreso con su inscripción al evento 2. */
let congreso: Array<{ tipoDocumentoId: string, numeroDocumento: string, inscripciones: Fila[] }>

function inscripcionDeCongreso(estado: string, modalidad: 'PRESENCIAL' | 'VIRTUAL' | null = 'PRESENCIAL', eventoId = 2): Fila {
    return {
        eventoId,
        estado: { codigo: estado },
        tipoInscripcion: modalidad === null ? null : { nombre: modalidad === 'VIRTUAL' ? 'Público general virtual' : 'Público general', modalidad, categoria: { nombre: 'Público general' } },
    }
}

/** Un asistente a ponencias (con `ponencias` inscripciones vigentes) y, si se da, su inscripción al congreso. */
function persona(datos: { dni: string, nombres?: string, apellidos?: string, correo?: string | null, estado?: string, modalidad?: 'PRESENCIAL' | 'VIRTUAL' | null, ponencias?: number, documentoEnCongreso?: string, validada?: boolean }) {
    const asistente = sembrarAsistente(m.__bd, { numeroDocumento: datos.dni, nombres: datos.nombres ?? 'Ana', apellidos: datos.apellidos ?? 'Pérez', correo: datos.correo === undefined ? `${datos.dni}@e2e.test` : datos.correo, celular: '987654321' })
    const filas: Fila[] = []
    for (let i = 0; i < (datos.ponencias ?? 1); i++) {
        const ponencia = sembrarPonencia(m.__bd, { tema: `Tema ${datos.dni}-${i}`, ambiente: `Aula ${datos.dni}-${i}` })
        filas.push(sembrarInscripcion(m.__bd, { ponenciaId: ponencia.id, asistenteId: asistente.id, inscripcionCongresoId: datos.validada ? 900 : null }))
    }
    if (datos.estado) congreso.push({ tipoDocumentoId: 'dni', numeroDocumento: datos.documentoEnCongreso ?? datos.dni, inscripciones: [inscripcionDeCongreso(datos.estado, datos.modalidad === undefined ? 'PRESENCIAL' : datos.modalidad)] })
    return { asistente, filas }
}

/** Una por cada situación. */
function escenario() {
    return {
        aprobada: persona({ dni: '10000001', apellidos: 'Aprobada', estado: 'APROBADO', ponencias: 2, validada: true }),
        virtual: persona({ dni: '10000002', apellidos: 'Virtual', estado: 'APROBADO', modalidad: 'VIRTUAL', validada: true }),
        pendiente: persona({ dni: '10000003', apellidos: 'Pendiente', estado: 'EN_REVISION' }),
        rechazada: persona({ dni: '10000004', apellidos: 'Rechazada', estado: 'RECHAZADO' }),
        sinCongreso: persona({ dni: '10000005', apellidos: 'Ajena' }),
    }
}

beforeEach(() => {
    reiniciar(m.__bd)
    jest.clearAllMocks()
    congreso = []
    evento = { id: 2, codigo: 'ciisic-viii', nombre: 'VIII CIISIC 2026', nombreCorto: 'CIISIC', estado: 'PUBLICADO', ponenciasAccesoLibre: false, credencialCorreoId: null, remitenteNombre: null, correoContacto: 'contacto@undc.edu.pe' }
    m.evento.findUnique.mockImplementation(({ where }: { where: { id: number } }) => Promise.resolve({ ...evento, id: where.id }))
    m.participante.findMany.mockImplementation(async ({ where, select }: { where: { numeroDocumento: { in: string[] } }, select: { inscripciones: { where: { eventoId: number } } } }) =>
        congreso
            .filter((c) => where.numeroDocumento.in.includes(c.numeroDocumento))
            .map((c) => ({ tipoDocumentoId: c.tipoDocumentoId, numeroDocumento: c.numeroDocumento, inscripciones: c.inscripciones.filter((i) => i.eventoId === select.inscripciones.where.eventoId) })))
    credencial.mockResolvedValue({ id: 1, remitenteCorreo: 'no-responder@undc.edu.pe', remitenteNombre: 'CIISIC' })
    enviar.mockResolvedValue(null)
})

// ─── Reglas puras ───────────────────────────────────────────────────────────

describe('reglas puras', () => {
    it('la situación sale del veredicto de elegibilidad', () => {
        expect(situacionDe({ ok: true, modo: 'VIRTUAL' })).toBe('APROBADO')
        expect(situacionDe({ ok: false, motivo: 'PAGO_PENDIENTE' })).toBe('PAGO_PENDIENTE')
        expect(situacionDe({ ok: false, motivo: 'RECHAZADA' })).toBe('RECHAZADO')
        expect(situacionDe({ ok: false, motivo: 'NO_ENCONTRADA' })).toBe('NO_INSCRITO')
    })

    it('el DNI también se busca sin los ceros a la izquierda; el carné no', () => {
        expect(variantesDocumento('dni', '08000001')).toEqual(['08000001', '8000001'])
        expect(variantesDocumento('dni', '12345678')).toEqual(['12345678'])
        expect(variantesDocumento('ce', '00123456789')).toEqual(['00123456789'])
    })

    it('el comunicado escapa el HTML, respeta los párrafos y usa el primer nombre', () => {
        const html = htmlComunicado('Hola {nombre},\n\nInscríbete <b>ya</b> & paga.\nGracias', 'JHOSEP JAVIER', { nombre: 'VIII CIISIC', correoContacto: 'contacto@undc.edu.pe' }, 'no-responder@undc.edu.pe')
        expect(html).toContain('Hola Jhosep,')
        expect(html).toContain('&lt;b&gt;ya&lt;/b&gt; &amp; paga.<br>Gracias')
        expect(html).not.toContain('<b>')
        expect(html).toContain('contacto@undc.edu.pe')
        expect(html.match(/<p /g)?.length).toBe(3)
    })
})

// ─── Listado ────────────────────────────────────────────────────────────────

describe('resumen por persona', () => {
    it('una fila por persona (no por ponencia) con su situación actual, y los problemas primero', async () => {
        escenario()
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.status).toBe(200)
        expect(r.body.data.map((f: Fila) => [f.asistente.apellidos, f.situacion, f.puede])).toEqual([
            ['Ajena', 'NO_INSCRITO', false],
            ['Rechazada', 'RECHAZADO', false],
            ['Pendiente', 'PAGO_PENDIENTE', false],
            ['Aprobada', 'APROBADO', true],
            ['Virtual', 'APROBADO', true],
        ])
        const aprobada = r.body.data.find((f: Fila) => f.asistente.apellidos === 'Aprobada')
        expect(aprobada).toMatchObject({ ponencias: 2, validada: true, congreso: { estado: 'APROBADO', tipo: 'Público general', modo: 'PRESENCIAL' } })
        expect(r.body.data.find((f: Fila) => f.asistente.apellidos === 'Virtual').congreso).toMatchObject({ modo: 'VIRTUAL', tipo: 'Público general virtual' })
        expect(r.body.data.find((f: Fila) => f.asistente.apellidos === 'Ajena').congreso).toBeNull()
        expect(r.body.meta).toMatchObject({
            total: 5, accesoLibre: false,
            resumen: { personas: 5, inscripciones: 6, pueden: 2, noPueden: 3, sinValidar: 3, avisadas: 0, porSituacion: { APROBADO: 2, PAGO_PENDIENTE: 1, RECHAZADO: 1, NO_INSCRITO: 1 } },
        })
    })

    it('no cuenta a quien solo tiene inscripciones canceladas', async () => {
        const { asistente } = persona({ dni: '10000006', apellidos: 'Cancelada' })
        m.__bd.inscripciones.filter((i) => i.asistenteId === asistente.id).forEach((i) => { i.estado = 'CANCELADO' })
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.body.data).toHaveLength(0)
    })

    it('empareja el DNI aunque el participante lo tenga guardado sin el cero inicial', async () => {
        persona({ dni: '08000001', apellidos: 'Ceros', estado: 'APROBADO', documentoEnCongreso: '8000001' })
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.body.data[0]).toMatchObject({ situacion: 'APROBADO', puede: true })
    })

    it('si el documento está dos veces (con y sin ceros), gana la inscripción aprobada', async () => {
        persona({ dni: '08000002', apellidos: 'Doble', estado: 'RECHAZADO' })
        congreso.push({ tipoDocumentoId: 'dni', numeroDocumento: '8000002', inscripciones: [inscripcionDeCongreso('APROBADO')] })
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.body.data[0].situacion).toBe('APROBADO')
    })

    it('una inscripción al congreso de otro evento no cuenta', async () => {
        persona({ dni: '10000007', apellidos: 'Otro' })
        congreso.push({ tipoDocumentoId: 'dni', numeroDocumento: '10000007', inscripciones: [inscripcionDeCongreso('APROBADO', 'PRESENCIAL', 3)] })
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.body.data[0].situacion).toBe('NO_INSCRITO')
    })

    it('con el acceso libre encendido todos pueden, pero la situación real se sigue mostrando', async () => {
        escenario()
        evento.ponenciasAccesoLibre = true
        const r = await request(app).get(RUTA).set(con(admin()))
        expect(r.body.data.every((f: Fila) => f.puede)).toBe(true)
        expect(r.body.data.find((f: Fila) => f.asistente.apellidos === 'Ajena').situacion).toBe('NO_INSCRITO')
        expect(r.body.meta).toMatchObject({ accesoLibre: true, resumen: { pueden: 5, noPueden: 0 } })
    })

    it('filtra por situación, si puede, validación, modo, aviso y búsqueda', async () => {
        const e = escenario()
        m.__bd.inscripciones.filter((i) => i.asistenteId === e.rechazada.asistente.id).forEach((i) => { i.avisoEnviadoEn = new Date() })
        const apellidos = async (consulta: string) => (await request(app).get(`${RUTA}?${consulta}`).set(con(admin()))).body.data.map((f: Fila) => f.asistente.apellidos).sort()
        expect(await apellidos('situacion=NO_INSCRITO')).toEqual(['Ajena'])
        expect(await apellidos('puede=no')).toEqual(['Ajena', 'Pendiente', 'Rechazada'])
        expect(await apellidos('puede=si')).toEqual(['Aprobada', 'Virtual'])
        expect(await apellidos('validacion=si')).toEqual(['Aprobada', 'Virtual'])
        expect(await apellidos('validacion=no')).toEqual(['Ajena', 'Pendiente', 'Rechazada'])
        expect(await apellidos('modo=VIRTUAL')).toEqual(['Virtual'])
        expect(await apellidos('aviso=si')).toEqual(['Rechazada'])
        expect(await apellidos('aviso=no')).toEqual(['Ajena', 'Aprobada', 'Pendiente', 'Virtual'])
        expect(await apellidos('q=10000003')).toEqual(['Pendiente'])
        expect(await apellidos('q=rechaz')).toEqual(['Rechazada'])
        expect(await apellidos('situacion=APROBADO&puede=no')).toEqual([])
    })

    it('un filtro inválido es 400 y los totales de meta.resumen no dependen de los filtros', async () => {
        escenario()
        for (const consulta of ['situacion=OTRA', 'puede=quizas', 'validacion=x', 'modo=HIBRIDO', 'aviso=tal']) {
            expect((await request(app).get(`${RUTA}?${consulta}`).set(con(admin()))).status).toBe(400)
        }
        const r = await request(app).get(`${RUTA}?puede=no&pageSize=1`).set(con(admin()))
        expect(r.body.data).toHaveLength(1)
        expect(r.body.meta).toMatchObject({ total: 3, pageSize: 1, resumen: { personas: 5 } })
    })

    it('exige especializadas.ver en el evento', async () => {
        escenario()
        expect((await request(app).get(RUTA)).status).toBe(401)
        expect((await request(app).get(RUTA).set(con(comision(['especializadas.asistencia'])))).status).toBe(200)
        expect((await request(app).get(RUTA).set(con(comision(['especializadas.ver'], [3])))).status).toBe(403)
        expect((await request(app).get(RUTA).set(con(tokenDeRol('TESORERO', 30, { eventoIds: [2] })))).status).toBe(403)
    })
})

// ─── Excel ──────────────────────────────────────────────────────────────────

describe('descarga a Excel', () => {
    it('devuelve un .xlsx con las personas filtradas', async () => {
        escenario()
        const r = await request(app).get(`${RUTA}/export?puede=no`).set(con(admin())).buffer(true).parse((res, cb) => {
            const trozos: Buffer[] = []
            res.on('data', (t: Buffer) => trozos.push(t))
            res.on('end', () => cb(null, Buffer.concat(trozos)))
        })
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toContain('spreadsheetml')
        expect(r.headers['content-disposition']).toMatch(/Ponencias especializadas ciisic-viii \d{4}-\d{2}-\d{2}\.xlsx/)
        expect(r.headers['cache-control']).toBe('no-store')
        const cuerpo = r.body as Buffer
        expect(cuerpo.subarray(0, 2).toString()).toBe('PK')
        const { Workbook } = await import('exceljs')
        const libro = new Workbook()
        await libro.xlsx.load(cuerpo as unknown as Parameters<typeof libro.xlsx.load>[0])
        expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Personas'])
        const hoja = libro.getWorksheet('Personas')!
        expect(hoja.rowCount).toBe(4)
        expect(hoja.getRow(2).getCell(2).value).toBe('Ajena')
        expect(hoja.getRow(2).getCell(9).value).toBe('No está inscrito al congreso')
        expect(hoja.getRow(2).getCell(13).value).toBe('No')
    }, 60_000)

    it('exige especializadas.ver', async () => {
        expect((await request(app).get(`${RUTA}/export`)).status).toBe(401)
        expect((await request(app).get(`${RUTA}/export`).set(con(comision(['especializadas.ver'], [3])))).status).toBe(403)
    })
})

// ─── Cancelar ───────────────────────────────────────────────────────────────

const ids = (...personas: Array<{ asistente: Fila }>) => personas.map((p) => p.asistente.id)

describe('cancelar a quien no puede estar inscrito', () => {
    it('cancela todas sus inscripciones vigentes con el motivo SIN_CONGRESO y respeta a quien sí puede', async () => {
        const e = escenario()
        const dosPonencias = persona({ dni: '10000008', apellidos: 'Doble', ponencias: 2 })
        const r = await request(app).post(`${RUTA}/cancel`).set(con(admin())).send({ asistenteIds: ids(e.sinCongreso, e.rechazada, e.aprobada, dosPonencias, { asistente: { id: 999 } }) })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ personas: 3, inscripciones: 4, avisos: null })
        expect(r.body.data.omitidas).toEqual(expect.arrayContaining([
            { asistenteId: e.aprobada.asistente.id, motivo: 'PUEDE_ASISTIR' },
            { asistenteId: 999, motivo: 'NO_ENCONTRADA' },
        ]))
        const de = (p: { asistente: Fila }) => m.__bd.inscripciones.filter((i) => i.asistenteId === p.asistente.id)
        for (const p of [e.sinCongreso, e.rechazada, dosPonencias]) {
            for (const fila of de(p)) expect(fila).toMatchObject({ estado: 'CANCELADO', motivoCancelacion: 'SIN_CONGRESO' })
            for (const fila of de(p)) expect(fila.canceladoEn).toBeInstanceOf(Date)
        }
        for (const fila of [...de(e.aprobada), ...de(e.virtual), ...de(e.pendiente)]) expect(fila.estado).toBe('INSCRITO')
        expect(enviar).not.toHaveBeenCalled()
    })

    it('no cancela lo que ya tiene asistencia: primero se anula la asistencia', async () => {
        const solo = persona({ dni: '10000009', apellidos: 'Asistio' })
        solo.filas[0]!.asistioEn = new Date()
        const mixta = persona({ dni: '10000010', apellidos: 'Mixta', ponencias: 2 })
        mixta.filas[0]!.asistioEn = new Date()
        const r = await request(app).post(`${RUTA}/cancel`).set(con(admin())).send({ asistenteIds: ids(solo, mixta) })
        expect(r.body.data).toMatchObject({ personas: 1, inscripciones: 1, omitidas: [{ asistenteId: solo.asistente.id, motivo: 'YA_ASISTIO' }] })
        expect(solo.filas[0]!.estado).toBe('INSCRITO')
        expect(mixta.filas[0]!.estado).toBe('INSCRITO')
        expect(mixta.filas[1]!.estado).toBe('CANCELADO')
    })

    it('con el acceso libre encendido responde 409: nadie sobra', async () => {
        const e = escenario()
        evento.ponenciasAccesoLibre = true
        const r = await request(app).post(`${RUTA}/cancel`).set(con(admin())).send({ asistenteIds: ids(e.sinCongreso) })
        expect([r.status, r.body.code]).toEqual([409, 'FREE_ACCESS_ENABLED'])
        expect(e.sinCongreso.filas[0]!.estado).toBe('INSCRITO')
    })

    it('con comunicado: lo envía a cada persona con su nombre, guarda la fecha y no revierte si un correo falla', async () => {
        const e = escenario()
        const sinCorreo = persona({ dni: '10000011', apellidos: 'SinCorreo', correo: null })
        enviar.mockImplementation(async (_cred: unknown, correo: { para: Array<{ email: string }> }) => (correo.para[0]!.email === '10000004@e2e.test' ? 'Brevo no disponible' : null))
        const r = await request(app).post(`${RUTA}/cancel`).set(con(admin())).send({
            asistenteIds: ids(e.sinCongreso, e.rechazada, e.pendiente, sinCorreo), notificar: true,
            asunto: 'Tu inscripción a las ponencias fue cancelada', mensaje: 'Hola {nombre},\n\nInscríbete al congreso <ya>.',
        })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ personas: 4, inscripciones: 4, avisos: { enviados: 2, sinCorreo: 1, fallidos: 1, sinCredencial: false } })
        expect(enviar).toHaveBeenCalledTimes(3)
        const [, correo] = enviar.mock.calls.find(([, c]) => c.para[0].email === '10000005@e2e.test')!
        expect(correo.asunto).toBe('Tu inscripción a las ponencias fue cancelada')
        expect(correo.remitente).toEqual({ email: 'no-responder@undc.edu.pe', name: 'CIISIC' })
        expect(correo.html).toContain('Hola Ana,')
        expect(correo.html).toContain('&lt;ya&gt;')
        // La cancelación se conserva aunque falló un correo, y solo los enviados quedan marcados
        expect(e.rechazada.filas[0]!.estado).toBe('CANCELADO')
        expect(e.sinCongreso.filas[0]!.avisoEnviadoEn).toBeInstanceOf(Date)
        expect(e.pendiente.filas[0]!.avisoEnviadoEn).toBeInstanceOf(Date)
        expect(e.rechazada.filas[0]!.avisoEnviadoEn).toBeUndefined()
        expect(sinCorreo.filas[0]!.avisoEnviadoEn).toBeUndefined()
    })

    it('sin credencial de correo cancela igual y lo avisa', async () => {
        const e = escenario()
        credencial.mockResolvedValue(null)
        const r = await request(app).post(`${RUTA}/cancel`).set(con(admin())).send({ asistenteIds: ids(e.sinCongreso), notificar: true, asunto: 'Aviso', mensaje: 'Texto' })
        expect(r.body.data).toMatchObject({ personas: 1, avisos: { enviados: 0, fallidos: 1, sinCredencial: true } })
        expect(e.sinCongreso.filas[0]!.estado).toBe('CANCELADO')
        expect(enviar).not.toHaveBeenCalled()
    })

    it('valida lo que se envía', async () => {
        const e = escenario()
        const cancelar = (cuerpo: object, token = admin()) => request(app).post(`${RUTA}/cancel`).set(con(token)).send(cuerpo)
        expect((await cancelar({})).status).toBe(422)
        expect((await cancelar({ asistenteIds: [] })).status).toBe(422)
        expect((await cancelar({ asistenteIds: [1, 1] })).status).toBe(422)
        expect((await cancelar({ asistenteIds: Array.from({ length: 101 }, (_, i) => i + 1) })).status).toBe(422)
        expect((await cancelar({ asistenteIds: ids(e.sinCongreso), notificar: true, asunto: 'Solo asunto' })).status).toBe(422)
        expect(e.sinCongreso.filas[0]!.estado).toBe('INSCRITO')
    })

    it('exige especializadas.inscribir en el evento', async () => {
        const e = escenario()
        const cuerpo = { asistenteIds: ids(e.sinCongreso) }
        expect((await request(app).post(`${RUTA}/cancel`).send(cuerpo)).status).toBe(401)
        expect((await request(app).post(`${RUTA}/cancel`).set(con(comision(['especializadas.ver']))).send(cuerpo)).status).toBe(403)
        expect((await request(app).post(`${RUTA}/cancel`).set(con(comision(['especializadas.inscribir'], [3]))).send(cuerpo)).status).toBe(403)
        expect(e.sinCongreso.filas[0]!.estado).toBe('INSCRITO')
        expect((await request(app).post(`${RUTA}/cancel`).set(con(comision(['especializadas.inscribir']))).send(cuerpo)).status).toBe(200)
    })
})

// ─── Solo avisar ────────────────────────────────────────────────────────────

describe('avisar sin cancelar', () => {
    const aviso = { asunto: 'Tu pago del congreso', mensaje: 'Hola {nombre}, paga el congreso para conservar tu lugar.' }

    it('envía el aviso a quien no puede, deja sus inscripciones vigentes y omite a quien sí puede', async () => {
        const e = escenario()
        const r = await request(app).post(`${RUTA}/notify`).set(con(admin())).send({ asistenteIds: ids(e.pendiente, e.sinCongreso, e.aprobada), ...aviso })
        expect(r.status).toBe(200)
        expect(r.body.data).toMatchObject({ personas: 2, avisos: { enviados: 2, sinCorreo: 0, fallidos: 0 }, omitidas: [{ asistenteId: e.aprobada.asistente.id, motivo: 'PUEDE_ASISTIR' }] })
        expect(enviar).toHaveBeenCalledTimes(2)
        expect(e.pendiente.filas[0]).toMatchObject({ estado: 'INSCRITO' })
        expect(e.pendiente.filas[0]!.avisoEnviadoEn).toBeInstanceOf(Date)
        expect(e.aprobada.filas[0]!.avisoEnviadoEn).toBeUndefined()
        // Y el resumen lo muestra como avisada
        const lista = await request(app).get(`${RUTA}?aviso=si`).set(con(admin()))
        expect(lista.body.data.map((f: Fila) => f.asistente.apellidos).sort()).toEqual(['Ajena', 'Pendiente'])
        expect(lista.body.meta.resumen.avisadas).toBe(2)
    })

    it('sin credencial de correo responde 409; si nadie lo necesita, 404; con el acceso libre, 409', async () => {
        const e = escenario()
        credencial.mockResolvedValue(null)
        const sinCredencial = await request(app).post(`${RUTA}/notify`).set(con(admin())).send({ asistenteIds: ids(e.pendiente), ...aviso })
        expect([sinCredencial.status, sinCredencial.body.code]).toEqual([409, 'EMAIL_CREDENTIAL_UNAVAILABLE'])
        credencial.mockResolvedValue({ id: 1, remitenteCorreo: 'no-responder@undc.edu.pe', remitenteNombre: 'CIISIC' })
        const nadie = await request(app).post(`${RUTA}/notify`).set(con(admin())).send({ asistenteIds: ids(e.aprobada), ...aviso })
        expect([nadie.status, nadie.body.code]).toEqual([404, 'ATTENDEES_NOT_FOUND'])
        evento.ponenciasAccesoLibre = true
        const libre = await request(app).post(`${RUTA}/notify`).set(con(admin())).send({ asistenteIds: ids(e.pendiente), ...aviso })
        expect([libre.status, libre.body.code]).toEqual([409, 'FREE_ACCESS_ENABLED'])
        expect(enviar).not.toHaveBeenCalled()
    })

    it('el asunto y el mensaje son obligatorios y se exige especializadas.inscribir', async () => {
        const e = escenario()
        expect((await request(app).post(`${RUTA}/notify`).set(con(admin())).send({ asistenteIds: ids(e.pendiente), asunto: 'Solo asunto' })).status).toBe(422)
        expect((await request(app).post(`${RUTA}/notify`).set(con(comision(['especializadas.ver']))).send({ asistenteIds: ids(e.pendiente), ...aviso })).status).toBe(403)
        expect(enviar).not.toHaveBeenCalled()
    })
})

import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import * as configuracion from '../../src/core/configuracion-sistema'
import { asegurarCodigoCredencial } from '../../src/core/codigos'
import { credencialParaEvento, enviarConCredencial } from '../../src/api/email-credential/services/email-credential'
import { enviarCorreoEnlaceCredencial } from '../../src/api/inscription/utils/sendEmail'
import { aprobadasPresenciales, idsDestinatarios, listarDestinatarios, whereDestinatarios } from '../../src/api/broadcast/services/destinatarios'
import { enviarEnlacesCredencial, enviarInvitacionPonencias, htmlInvitacionPonencias, probarInvitacionPonencias } from '../../src/api/broadcast/services/enviar'
import type { Actor } from '../../src/core/actor'
import { tokenDeRol } from '../helpers/tokens'

/**
 * Envíos masivos a los inscritos presenciales (spec 039): destinatarios, marca de «ya se le envió» con reserva
 * atómica, reversión si el envío falla y mensaje genérico con el botón a la inscripción de ponencias. Nada sale
 * de verdad: el envío de correos está simulado.
 */
jest.mock('../../src/database/prisma', () => ({
    prisma: {
        evento: { findUnique: jest.fn() },
        inscripcion: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    },
}))
jest.mock('../../src/api/email-credential/services/email-credential', () => ({ credencialParaEvento: jest.fn(), enviarConCredencial: jest.fn() }))
jest.mock('../../src/api/inscription/utils/sendEmail', () => ({ enviarCorreoEnlaceCredencial: jest.fn() }))
jest.mock('../../src/core/codigos', () => ({ ...jest.requireActual('../../src/core/codigos'), asegurarCodigoCredencial: jest.fn() }))

type Mock = jest.Mock
const m = prisma as unknown as {
    evento: { findUnique: Mock }
    inscripcion: { findMany: Mock, count: Mock, updateMany: Mock }
}
const credencialDeCorreo = credencialParaEvento as Mock
const enviarCorreo = enviarConCredencial as Mock
const enviarEnlace = enviarCorreoEnlaceCredencial as Mock
const asegurarCodigo = asegurarCodigoCredencial as Mock

const evento = {
    id: 2, codigo: 'ciisic-viii-2026', nombre: 'VIII Congreso <Internacional>', nombreCorto: 'VIII CIISIC 2026', correoContacto: 'congreso@undc.edu.pe',
    remitenteNombre: null, credencialCorreoId: null, fechaInicio: new Date('2026-10-26T00:00:00Z'),
}
const actor = { id: 9 } as unknown as Actor
const AHORA = new Date('2026-10-26T15:00:00.000Z')
const PREVIA = new Date('2026-10-25T20:00:00.000Z')
const LANDING = 'https://landing.test'

const fila = (id: number, cambios: Record<string, unknown> = {}) => ({
    id,
    codigoCredencial: `CODIGO${String(id).padStart(4, '0')}`,
    enlaceCredencialEnviadoEn: null,
    enlacePonenciasEnviadoEn: null,
    participante: { nombres: `Persona ${id}`, apellidos: 'Prueba', correo: `p${id}@example.com` },
    evento,
    ...cambios,
})

const conLanding = (urlLanding: string | null) => jest.spyOn(configuracion, 'obtenerConfiguracion').mockResolvedValue({
    undcApiUrl: null, undcApiKeyCifrada: null, undcApiTimeoutMs: 8000, googleClientId: null, urlPanel: null, urlLanding, rutasLegacyActivas: true,
})

beforeEach(() => {
    jest.clearAllMocks()
    m.evento.findUnique.mockResolvedValue(evento)
    m.inscripcion.updateMany.mockResolvedValue({ count: 1 })
    credencialDeCorreo.mockResolvedValue({ id: 1, remitenteCorreo: 'no-reply@undc.edu.pe', remitenteNombre: 'Congreso' })
    enviarCorreo.mockResolvedValue(null)
    enviarEnlace.mockResolvedValue(true)
    conLanding(LANDING)
})
afterEach(() => { jest.restoreAllMocks() })

describe('destinatarios', () => {
    it('son las inscripciones aprobadas del evento con tipo presencial o sin tipo (cortesías)', () => {
        expect(aprobadasPresenciales(2)).toEqual({
            eventoId: 2,
            estado: { codigo: 'APROBADO' },
            OR: [{ tipoInscripcion: { modalidad: 'PRESENCIAL' } }, { tipoInscripcionId: null }],
        })
    })

    it('la búsqueda pide cada palabra y el filtro «enviado» usa la marca de su canal', () => {
        const donde = whereDestinatarios(2, 'ponencias', { q: ' Ana  1234 ', enviado: 'no' }).AND as unknown[]
        expect(donde).toHaveLength(4)
        expect(donde[1]).toMatchObject({ participante: { OR: expect.arrayContaining([{ nombres: { contains: 'ana' } }, { numeroDocumento: { contains: 'ana' } }]) } })
        expect(donde[3]).toEqual({ enlacePonenciasEnviadoEn: null })
        expect(whereDestinatarios(2, 'credencial', { enviado: 'si' }).AND).toContainEqual({ enlaceCredencialEnviadoEn: { not: null } })
    })

    it('lista una página con la marca de envío y, aparte de los filtros, los totales del evento', async () => {
        m.inscripcion.findMany.mockResolvedValue([{
            id: 5, enlaceCredencialEnviadoEn: PREVIA, enlacePonenciasEnviadoEn: null,
            participante: { nombres: 'Ana', apellidos: 'Pérez', tipoDocumentoId: 'dni', numeroDocumento: '12345678', correo: 'ana@example.com' },
            tipoInscripcion: { nombre: 'CON KIT', etiqueta: 'CON KIT' }, clasificacion: null,
        }])
        m.inscripcion.count.mockResolvedValueOnce(1).mockResolvedValueOnce(40).mockResolvedValueOnce(15)
        const r = await listarDestinatarios(2, 'credencial', { enviado: 'si' }, { page: 1, pageSize: 20, skip: 0, take: 20 })
        expect(r.data).toEqual([{
            id: 5, nombres: 'Ana', apellidos: 'Pérez', tipoDocumento: 'dni', numeroDocumento: '12345678', correo: 'ana@example.com',
            tipo: { nombre: 'CON KIT', etiqueta: 'CON KIT' }, clasificacion: null, enviadoEn: PREVIA,
        }])
        expect(r.meta).toEqual({ page: 1, pageSize: 20, total: 1, resumen: { total: 40, enviados: 15, pendientes: 25 } })
        // En el canal de ponencias la marca es otra
        const otra = await listarDestinatarios(2, 'ponencias', {}, { page: 1, pageSize: 20, skip: 0, take: 20 })
        expect(otra.data[0].enviadoEn).toBeNull()
    })

    it('devuelve los ids de todos los destinatarios con los filtros para enviar por tandas', async () => {
        m.inscripcion.findMany.mockResolvedValue([{ id: 3 }, { id: 8 }])
        m.inscripcion.count.mockResolvedValue(2)
        expect(await idsDestinatarios(2, 'credencial', { enviado: 'no' })).toEqual({ ids: [3, 8], total: 2 })
        expect(m.inscripcion.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true }, take: 5000 }))
    })
})

describe('enviarEnlacesCredencial', () => {
    it('envía a cada persona su enlace, omite a quien ya lo recibió y a quien no es elegible', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1), fila(2, { enlaceCredencialEnviadoEn: PREVIA })])
        const r = await enviarEnlacesCredencial(2, { ids: [1, 2, 3], reenviar: false }, actor, AHORA)
        expect(r).toEqual({ enviados: 1, yaEnviados: 1, noElegibles: 1, fallidos: 0 })
        expect(enviarEnlace).toHaveBeenCalledTimes(1)
        expect(enviarEnlace).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), `${LANDING}/credencial/CODIGO0001`)
        // El servidor busca solo aprobadas presenciales del evento, entre las pedidas
        expect(m.inscripcion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [aprobadasPresenciales(2), { id: { in: [1, 2, 3] } }] } }))
        // Reserva la marca antes de enviar, condicionada a lo que leyó
        expect(m.inscripcion.updateMany).toHaveBeenCalledTimes(1)
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 1, enlaceCredencialEnviadoEn: null }, data: { enlaceCredencialEnviadoEn: AHORA } })
    })

    it('con «reenviar» vuelve a enviar a quien ya lo recibió y pisa solo la marca que leyó', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(2, { enlaceCredencialEnviadoEn: PREVIA })])
        const r = await enviarEnlacesCredencial(2, { ids: [2], reenviar: true }, actor, AHORA)
        expect(r.enviados).toBe(1)
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 2, enlaceCredencialEnviadoEn: PREVIA }, data: { enlaceCredencialEnviadoEn: AHORA } })
    })

    it('si el correo falla, devuelve la marca a como estaba y lo cuenta como fallido', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1), fila(2)])
        enviarEnlace.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        const r = await enviarEnlacesCredencial(2, { ids: [1, 2], reenviar: false }, actor, AHORA)
        expect(r).toEqual({ enviados: 1, yaEnviados: 0, noElegibles: 0, fallidos: 1 })
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 1, enlaceCredencialEnviadoEn: AHORA }, data: { enlaceCredencialEnviadoEn: null } })
        expect(m.inscripcion.updateMany).not.toHaveBeenCalledWith({ where: { id: 2, enlaceCredencialEnviadoEn: AHORA }, data: { enlaceCredencialEnviadoEn: null } })
    })

    it('una excepción al enviar no corta el lote ni deja la marca puesta', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1), fila(2)])
        enviarEnlace.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true)
        const r = await enviarEnlacesCredencial(2, { ids: [1, 2], reenviar: false }, actor, AHORA)
        expect(r).toMatchObject({ enviados: 1, fallidos: 1 })
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 1, enlaceCredencialEnviadoEn: AHORA }, data: { enlaceCredencialEnviadoEn: null } })
    })

    it('si otra petición ganó la reserva, no envía de nuevo', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1)])
        m.inscripcion.updateMany.mockResolvedValue({ count: 0 })
        const r = await enviarEnlacesCredencial(2, { ids: [1], reenviar: false }, actor, AHORA)
        expect(r).toEqual({ enviados: 0, yaEnviados: 1, noElegibles: 0, fallidos: 0 })
        expect(enviarEnlace).not.toHaveBeenCalled()
    })

    it('a una inscripción de la imagen anterior sin código le asigna uno antes de armar el enlace', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(4, { codigoCredencial: null })])
        asegurarCodigo.mockResolvedValue('NUEVO0CODE')
        await enviarEnlacesCredencial(2, { ids: [4], reenviar: false }, actor, AHORA)
        expect(asegurarCodigo).toHaveBeenCalledWith(4)
        expect(enviarEnlace).toHaveBeenCalledWith(expect.objectContaining({ codigoCredencial: 'NUEVO0CODE' }), `${LANDING}/credencial/NUEVO0CODE`)
    })

    it('sin URL de la landing o sin credencial de correo responde 409 y no toca nada', async () => {
        conLanding(null)
        await expect(enviarEnlacesCredencial(2, { ids: [1], reenviar: false }, actor, AHORA)).rejects.toMatchObject({ status: 409, code: 'LANDING_URL_MISSING' })
        conLanding(LANDING)
        credencialDeCorreo.mockResolvedValue(null)
        await expect(enviarEnlacesCredencial(2, { ids: [1], reenviar: false }, actor, AHORA)).rejects.toMatchObject({ status: 409, code: 'EMAIL_CREDENTIAL_UNAVAILABLE' })
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })
})

describe('enviarInvitacionPonencias', () => {
    const mensaje = 'Hola.\n\nYa puedes inscribirte a las ponencias <b>especializadas</b>.'
    const entrada = { ids: [1, 2, 3], reenviar: false, asunto: 'Inscríbete a las ponencias', mensaje }

    it('manda el mismo mensaje a cada persona por separado, con el botón a la inscripción de ponencias', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1), fila(2), fila(3, { enlacePonenciasEnviadoEn: PREVIA })])
        const r = await enviarInvitacionPonencias(2, entrada, actor, AHORA)
        expect(r).toEqual({ enviados: 2, yaEnviados: 1, noElegibles: 0, fallidos: 0 })
        expect(enviarCorreo).toHaveBeenCalledTimes(2)
        const [, primero] = enviarCorreo.mock.calls[0]
        const [, segundo] = enviarCorreo.mock.calls[1]
        expect(primero.para).toEqual([{ email: 'p1@example.com' }])
        expect(segundo.para).toEqual([{ email: 'p2@example.com' }])
        // Un mismo asunto y un mismo HTML para todas (no hay nada personalizado)
        expect(primero.asunto).toBe('Inscríbete a las ponencias')
        expect(primero.html).toBe(segundo.html)
        expect(primero.remitente).toEqual({ email: 'no-reply@undc.edu.pe', name: 'Congreso' })
        expect(primero.html).toContain(`href="${LANDING}/inscripcion-ponencias"`)
        expect(primero.html).toContain('Inscribirme a las ponencias')
        // La marca de este canal es la de ponencias, no la de la credencial
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 1, enlacePonenciasEnviadoEn: null }, data: { enlacePonenciasEnviadoEn: AHORA } })
        expect(m.inscripcion.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { enlaceCredencialEnviadoEn: AHORA } }))
    })

    it('escapa el mensaje del staff y el nombre del evento', () => {
        const html = htmlInvitacionPonencias(mensaje, evento, 'no-reply@undc.edu.pe', `${LANDING}/inscripcion-ponencias`)
        expect(html).not.toContain('<b>especializadas</b>')
        expect(html).toContain('&lt;b&gt;especializadas&lt;/b&gt;')
        expect(html).toContain('VIII Congreso &lt;Internacional&gt;')
        expect(html).toContain('congreso@undc.edu.pe')
    })

    it('un envío que falla devuelve su marca y no frena a los demás', async () => {
        m.inscripcion.findMany.mockResolvedValue([fila(1), fila(2)])
        enviarCorreo.mockResolvedValueOnce('Brevo respondió 500').mockResolvedValueOnce(null)
        const r = await enviarInvitacionPonencias(2, { ...entrada, ids: [1, 2] }, actor, AHORA)
        expect(r).toEqual({ enviados: 1, yaEnviados: 0, noElegibles: 0, fallidos: 1 })
        expect(m.inscripcion.updateMany).toHaveBeenCalledWith({ where: { id: 1, enlacePonenciasEnviadoEn: AHORA }, data: { enlacePonenciasEnviadoEn: null } })
    })

    it('sin URL de la landing responde 409 antes de enviar nada', async () => {
        conLanding('  ')
        await expect(enviarInvitacionPonencias(2, entrada, actor, AHORA)).rejects.toMatchObject({ status: 409, code: 'LANDING_URL_MISSING' })
        expect(enviarCorreo).not.toHaveBeenCalled()
    })
})

describe('probarInvitacionPonencias', () => {
    const entrada = { correo: 'yo@example.com', asunto: 'Inscríbete', mensaje: 'Hola, ya puedes inscribirte.' }

    it('envía una sola vez a esa dirección, marcado como prueba, y no marca a nadie', async () => {
        expect(await probarInvitacionPonencias(2, entrada, actor)).toEqual({ enviado: true })
        expect(enviarCorreo).toHaveBeenCalledTimes(1)
        expect(enviarCorreo.mock.calls[0][1]).toMatchObject({ para: [{ email: 'yo@example.com' }], asunto: '[Prueba] Inscríbete' })
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
        expect(m.inscripcion.findMany).not.toHaveBeenCalled()
    })

    it('si Brevo falla responde 502 EMAIL_SEND_FAILED', async () => {
        enviarCorreo.mockResolvedValue('La cuenta de Brevo no tiene créditos')
        await expect(probarInvitacionPonencias(2, entrada, actor)).rejects.toMatchObject({ status: 502, code: 'EMAIL_SEND_FAILED' })
    })
})

describe('rutas de los envíos masivos', () => {
    const owner = () => `Bearer ${tokenDeRol('SUPERADMIN', 5)}`

    it('lista los destinatarios con sus totales, sin caché', async () => {
        m.inscripcion.findMany.mockResolvedValue([])
        m.inscripcion.count.mockResolvedValue(0)
        const r = await request(app).get('/api/v1/events/2/credential-links?enviado=no&q=ana').set('Authorization', owner())
        expect(r.status).toBe(200)
        expect(r.headers['cache-control']).toBe('no-store')
        expect(r.body).toMatchObject({ success: true, data: [], meta: { page: 1, pageSize: 20, total: 0, resumen: { total: 0, enviados: 0, pendientes: 0 } } })
    })

    it('un filtro inválido responde 400', async () => {
        const r = await request(app).get('/api/v1/events/2/specialized-talk-invitations?enviado=quizas').set('Authorization', owner())
        expect(r.status).toBe(400)
        expect(r.body.code).toBe('INVALID_FILTER')
    })

    it.each([
        ['sin ids', '/api/v1/events/2/credential-links/send', { ids: [] }],
        ['ids repetidos', '/api/v1/events/2/credential-links/send', { ids: [1, 1] }],
        ['más de 100 personas', '/api/v1/events/2/credential-links/send', { ids: Array.from({ length: 101 }, (_, i) => i + 1) }],
        ['sin asunto', '/api/v1/events/2/specialized-talk-invitations/send', { ids: [1], mensaje: 'Un mensaje suficiente.' }],
        ['mensaje muy corto', '/api/v1/events/2/specialized-talk-invitations/send', { ids: [1], asunto: 'Asunto', mensaje: 'Hola' }],
        ['prueba con un correo inválido', '/api/v1/events/2/specialized-talk-invitations/test', { correo: 'no-es-correo', asunto: 'Asunto', mensaje: 'Un mensaje suficiente.' }],
    ])('rechaza con 422 (%s) sin enviar nada', async (_caso, ruta, cuerpo) => {
        const r = await request(app).post(ruta).set('Authorization', owner()).send(cuerpo)
        expect(r.status).toBe(422)
        expect(r.body.code).toBe('VALIDATION_ERROR')
        expect(enviarCorreo).not.toHaveBeenCalled()
        expect(enviarEnlace).not.toHaveBeenCalled()
    })

    it('exige sesión de staff', async () => {
        const r = await request(app).post('/api/v1/events/2/credential-links/send').send({ ids: [1] })
        expect(r.status).toBe(401)
    })
})

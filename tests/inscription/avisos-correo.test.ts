import { Prisma } from '@prisma/client'
import { credencialParaEvento, enviarConCredencial } from '../../src/api/email-credential/services/email-credential'
import { enDiferido, enviarAvisoCambioCorreo, enviarAvisoCorreoConservado } from '../../src/api/inscription/utils/sendEmail'
import type { InscripcionDetalle } from '../../src/api/inscription/services/mappers'

/** Avisos de seguridad sobre el correo (spec 014): plantillas, destinatario y credencial de correo del evento. */
jest.mock('../../src/database/prisma', () => ({ prisma: {} }))
jest.mock('../../src/api/email-credential/services/email-credential', () => ({
    credencialParaEvento: jest.fn(),
    enviarConCredencial: jest.fn(),
}))

type Mock = jest.Mock
const credencialDe = credencialParaEvento as Mock
const enviar = enviarConCredencial as Mock

const credencial = { id: 4, remitenteCorreo: 'no-responder@ciisic.pe', remitenteNombre: 'CIISIC' }
const evento = {
    nombre: 'VIII Congreso', nombreCorto: 'VIII CIISIC 2026', correoContacto: 'contacto@ciisic.pe', remitenteNombre: null,
    credencialCorreoId: 9, fechaInicio: new Date('2026-10-26T13:00:00Z'),
}

function inscripcion(): InscripcionDetalle {
    return { evento, participante: { nombres: 'Ana <script>', correo: 'ana@gmail.com' } } as unknown as InscripcionDetalle
}

const correoEnviado = () => enviar.mock.calls[0][1] as { para: { email: string }[], asunto: string, html: string, remitente: { name: string } }

beforeEach(() => {
    jest.clearAllMocks()
    credencialDe.mockResolvedValue(credencial)
    enviar.mockResolvedValue(null)
})

describe('aviso de correo conservado', () => {
    it('va al correo registrado con la credencial de correo del evento, el correo ingresado enmascarado y el texto escapado', async () => {
        await expect(enviarAvisoCorreoConservado(inscripcion(), 'n***@g***.com')).resolves.toBe(true)
        expect(credencialDe).toHaveBeenCalledWith(9)
        const correo = correoEnviado()
        expect(correo.para).toEqual([{ email: 'ana@gmail.com' }])
        expect(correo.asunto).toContain('VIII CIISIC 2026')
        expect(correo.remitente.name).toBe('CIISIC')
        expect(correo.html).toContain('n***@g***.com')
        expect(correo.html).toContain('contacto@ciisic.pe')
        expect(correo.html).toContain('Ana &lt;script&gt;')
        expect(correo.html).not.toContain('<script>')
        expect(correo.html).not.toMatch(/\{\{[A-Z_]+\}\}/)
    })

    it('sin credencial de correo activa no envía y devuelve false', async () => {
        credencialDe.mockResolvedValue(null)
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        await expect(enviarAvisoCorreoConservado(inscripcion(), 'n***@g***.com')).resolves.toBe(false)
        expect(enviar).not.toHaveBeenCalled()
        aviso.mockRestore()
    })

    it('si Brevo rechaza el envío devuelve false sin lanzar ni registrar el detalle (puede citar la dirección)', async () => {
        enviar.mockResolvedValue('Brevo respondió 400: email ana@gmail.com inválido')
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        await expect(enviarAvisoCorreoConservado(inscripcion(), 'n***@g***.com')).resolves.toBe(false)
        expect(error).toHaveBeenCalledWith(expect.stringContaining('correo conservado'))
        expect(JSON.stringify(error.mock.calls)).not.toContain('ana@gmail.com')
        error.mockRestore()
    })
})

describe('aviso de cambio de correo por el staff', () => {
    it('va al correo anterior con el correo nuevo enmascarado', async () => {
        await expect(enviarAvisoCambioCorreo({ nombres: 'Ana', correoAnterior: 'ana@gmail.com', correoNuevo: 'n***@g***.com', evento })).resolves.toBe(true)
        const correo = correoEnviado()
        expect(correo.para).toEqual([{ email: 'ana@gmail.com' }])
        expect(correo.html).toContain('n***@g***.com')
        expect(correo.html).toContain('VIII CIISIC 2026')
        expect(correo.html).not.toMatch(/\{\{[A-Z_]+\}\}/)
    })

    it('sin inscripciones usa la credencial predeterminada y el remitente como contacto', async () => {
        await enviarAvisoCambioCorreo({ nombres: 'Ana', correoAnterior: 'ana@gmail.com', correoNuevo: 'n***@g***.com', evento: null })
        expect(credencialDe).toHaveBeenCalledWith(null)
        expect(correoEnviado().html).toContain('no-responder@ciisic.pe')
    })
})

describe('envío en diferido', () => {
    const esperar = () => new Promise((resolver) => setImmediate(resolver))

    it('no corre antes de responder y registra un fallo (también uno síncrono) con su causa, sin rechazos sin manejar', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        const tarea = jest.fn(async () => {
            throw new Prisma.PrismaClientKnownRequestError('Falló con ana@gmail.com', { code: 'P1001', clientVersion: 'x' })
        })
        const sincrona = jest.fn((): Promise<unknown> => {
            throw new TypeError('síncrono con ana@gmail.com')
        })
        enDiferido('el aviso A (participante 7)', tarea)
        enDiferido('el aviso B (inscripción 9)', sincrona)
        expect(tarea).not.toHaveBeenCalled()
        await esperar()
        await esperar()
        expect(tarea).toHaveBeenCalledTimes(1)
        expect(sincrona).toHaveBeenCalledTimes(1)
        // La causa (tipo y código de Prisma) y los ids, nunca el mensaje (puede llevar datos personales)
        expect(error).toHaveBeenCalledWith('No se pudo enviar el aviso A (participante 7): PrismaClientKnownRequestError P1001')
        expect(error).toHaveBeenCalledWith('No se pudo enviar el aviso B (inscripción 9): TypeError')
        expect(JSON.stringify(error.mock.calls)).not.toContain('ana@gmail.com')
        error.mockRestore()
    })
})

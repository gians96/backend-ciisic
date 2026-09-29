import type { Evento } from '@prisma/client'
import { prisma } from '../../src/database/prisma'
import { aRespuestaPublica, verificarEstudiante } from '../../src/api/student-verification/services/student-verification'
import { firmarVerificacion, leerVerificacion } from '../../src/api/student-verification/services/verification-token'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        personaConsultada: { findUnique: jest.fn(), upsert: jest.fn() },
        consultaDocumento: { create: jest.fn() },
        tokenConsulta: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn() },
    },
}))

const m = prisma as unknown as { personaConsultada: { findUnique: jest.Mock } }
const evento = { id: 1, dominioInstitucional: 'undc.edu.pe' } as unknown as Evento
const solicitud = { correo: '2020123456@undc.edu.pe', tipoDocumento: 'dni', numeroDocumento: '12345678' }

let fetchMock: jest.SpyInstance
const respuestaUndc = (data: Record<string, unknown>, status = 200) =>
    Promise.resolve(new Response(JSON.stringify({ msg: 'OK', sucess: true, data }), { status, headers: { 'Content-Type': 'application/json' } }))
const estudiante = { es_estudiante: true, egresado: false, matriculado_semestre_activo: true, codigo_estudiante: '2020123456', carrera: 'INGENIERÍA DE SISTEMAS', coincide_identidad: true, criterio: 'NOMBRE' }

beforeEach(() => {
    jest.clearAllMocks()
    fetchMock = jest.spyOn(global, 'fetch')
    m.personaConsultada.findUnique.mockResolvedValue({ numeroDocumento: '12345678', nombres: 'JUAN CARLOS', apellidoPaterno: 'PEREZ', apellidoMaterno: 'GARCIA' })
})
afterEach(() => fetchMock.mockRestore())

describe('verificación de estudiante UNDC', () => {
    it('verifica y emite un token firmado', async () => {
        fetchMock.mockReturnValue(respuestaUndc(estudiante))
        const resultado = await verificarEstudiante(evento, solicitud)
        expect(resultado).toMatchObject({ esEstudianteUndc: true, codigoEstudiante: '2020123456', motivo: null })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api-undc.test/externo/estudiantes/verificar')
        expect(init.headers['X-API-Key']).toBe('undc_test_key')
        // Se envían los nombres oficiales (caché RENIEC), no los tipeados por el usuario
        expect(JSON.parse(init.body)).toMatchObject({ email: '2020123456@undc.edu.pe', dni: '12345678', nombres: 'JUAN CARLOS', apellido_paterno: 'PEREZ' })
        expect(aRespuestaPublica(resultado).verificacionToken).toEqual(expect.any(String))
    })

    it('no consulta API_UNDC con correos no institucionales', async () => {
        const r = await verificarEstudiante(evento, { ...solicitud, correo: 'juan@gmail.com' })
        expect(r).toMatchObject({ esEstudianteUndc: false, motivo: 'CORREO_NO_INSTITUCIONAL' })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(aRespuestaPublica(r).verificacionToken).toBeNull()
    })

    it('rechaza cuando la identidad no coincide (correo de otro alumno)', async () => {
        fetchMock.mockReturnValue(respuestaUndc({ ...estudiante, coincide_identidad: false }))
        expect(await verificarEstudiante(evento, solicitud)).toMatchObject({ esEstudianteUndc: false, motivo: 'IDENTIDAD_NO_COINCIDE' })
    })

    it('rechaza egresados', async () => {
        fetchMock.mockReturnValue(respuestaUndc({ ...estudiante, es_estudiante: false, egresado: true }))
        expect(await verificarEstudiante(evento, solicitud)).toMatchObject({ esEstudianteUndc: false, motivo: 'EGRESADO' })
    })

    it('no bloquea si API_UNDC no responde', async () => {
        fetchMock.mockRejectedValue(new TypeError('network'))
        expect(await verificarEstudiante(evento, solicitud)).toMatchObject({ esEstudianteUndc: false, motivo: 'SERVICIO_NO_DISPONIBLE' })
    })

    it('sin nombres oficiales no se puede verificar', async () => {
        m.personaConsultada.findUnique.mockResolvedValue(null)
        expect(await verificarEstudiante(evento, solicitud)).toMatchObject({ motivo: 'SIN_DATOS_IDENTIDAD' })
    })
})

describe('token de verificación', () => {
    const base = {
        eventoId: 1, tipoDocumento: 'dni', numeroDocumento: '12345678', correo: '2020123456@undc.edu.pe', esEstudianteUndc: true,
        codigoEstudiante: '2020123456', carrera: null, matriculadoSemestreActivo: null, criterio: 'NOMBRE' as const, motivo: null, verificadoEn: 'x',
    }
    const esperado = { eventoId: 1, tipoDocumento: 'dni', numeroDocumento: '12345678', correo: '2020123456@UNDC.edu.pe' }

    it('se acepta solo para la misma persona, correo y evento', () => {
        const token = firmarVerificacion(base)
        expect(leerVerificacion(token, esperado)?.esEstudianteUndc).toBe(true)
        expect(leerVerificacion(token, { ...esperado, eventoId: 2 })).toBeNull()
        expect(leerVerificacion(token, { ...esperado, numeroDocumento: '87654321' })).toBeNull()
    })

    it('rechaza tokens alterados o vacíos', () => {
        const token = firmarVerificacion(base)
        expect(leerVerificacion(`${token}x`, esperado)).toBeNull()
        expect(leerVerificacion(null, esperado)).toBeNull()
    })
})

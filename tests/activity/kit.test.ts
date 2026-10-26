import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { tokenDeRol } from '../helpers/tokens'

jest.mock('../../src/database/prisma', () => ({
    prisma: {
        inscripcion: { findUnique: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
        evento: { findUnique: jest.fn() },
    },
}))

type Fila = Record<string, unknown>
const m = prisma as unknown as {
    inscripcion: Record<string, jest.Mock>
    evento: Record<string, jest.Mock>
}

// ─── BD en memoria: lo justo para la entrega del kit ─────────────────────────

const CON_KIT = { modalidad: 'PRESENCIAL', incluyeKit: true }
const SIN_KIT = { modalidad: 'PRESENCIAL', incluyeKit: false }
const VIRTUAL = { modalidad: 'VIRTUAL', incluyeKit: false }
const VIRTUAL_CON_KIT = { modalidad: 'VIRTUAL', incluyeKit: true }
const APROBADO = { codigo: 'APROBADO' }
const ENTREGADO_EN = new Date('2026-10-26T15:32:00.000Z')

let inscripciones: Map<number, Fila>

function reiniciarBd() {
    inscripciones = new Map<number, Fila>([
        [500, { id: 500, eventoId: 2, estado: APROBADO, tipoInscripcion: CON_KIT, kitEntregadoEn: null, kitEntregadoPor: null }],
        [501, { id: 501, eventoId: 2, estado: APROBADO, tipoInscripcion: SIN_KIT, kitEntregadoEn: null, kitEntregadoPor: null }],
        [502, { id: 502, eventoId: 2, estado: APROBADO, tipoInscripcion: VIRTUAL, kitEntregadoEn: null, kitEntregadoPor: null }],
        [503, { id: 503, eventoId: 2, estado: { codigo: 'PENDIENTE' }, tipoInscripcion: CON_KIT, kitEntregadoEn: null, kitEntregadoPor: null }],
        [504, { id: 504, eventoId: 2, estado: APROBADO, tipoInscripcion: null, kitEntregadoEn: null, kitEntregadoPor: null }],
        [505, { id: 505, eventoId: 2, estado: APROBADO, tipoInscripcion: CON_KIT, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPor: { id: 41, nombres: 'Rosa', apellidos: 'Quispe' } }],
        [506, { id: 506, eventoId: 2, estado: APROBADO, tipoInscripcion: VIRTUAL_CON_KIT, kitEntregadoEn: null, kitEntregadoPor: null }],
        // Se entregó con un tipo que después dejó de llevar kit: aun así se puede deshacer
        [507, { id: 507, eventoId: 2, estado: APROBADO, tipoInscripcion: SIN_KIT, kitEntregadoEn: ENTREGADO_EN, kitEntregadoPor: { id: 41, nombres: 'Rosa', apellidos: 'Quispe' } }],
        [600, { id: 600, eventoId: 3, estado: APROBADO, tipoInscripcion: CON_KIT, kitEntregadoEn: null, kitEntregadoPor: null }],
    ])
}

/** Igualdad y `{ not: null }`: lo que usan las escrituras condicionadas del servicio. */
function cumple(fila: Fila, where: Fila): boolean {
    return Object.entries(where).every(([campo, condicion]) => {
        const valor = fila[campo] ?? null
        if (condicion !== null && typeof condicion === 'object') return (condicion as { not?: unknown }).not === null ? valor !== null : valor === condicion
        return valor === condicion
    })
}

beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
    reiniciarBd()
    m.evento.findUnique.mockImplementation(({ where }) => Promise.resolve([2, 3].includes(where.id) ? { id: where.id } : null))
    m.inscripcion.findUnique.mockImplementation(({ where }) => Promise.resolve(inscripciones.get(where.id) ?? null))
    m.inscripcion.updateMany.mockImplementation(({ where, data }) => {
        const filas = [...inscripciones.values()].filter((fila) => cumple(fila, where))
        filas.forEach((fila) => {
            Object.assign(fila, data)
            // Como la relación: la fila ya trae a quien lo entregó (id → nombre) al volver a leerla
            fila.kitEntregadoPor = data.kitEntregadoPorId ? { id: data.kitEntregadoPorId, nombres: 'Test', apellidos: 'Comisión tecnológica' } : null
        })
        return Promise.resolve({ count: filas.length })
    })
    m.inscripcion.count.mockImplementation(({ where }) => Promise.resolve([...inscripciones.values()].filter((fila) => {
        const tipo = fila.tipoInscripcion as { incluyeKit: boolean, modalidad: string } | null
        const pide = where.tipoInscripcion
        return fila.eventoId === where.eventoId
            && (fila.estado as { codigo: string }).codigo === where.estado.codigo
            && tipo?.incluyeKit === pide.incluyeKit && tipo?.modalidad === pide.modalidad
            && (where.kitEntregadoEn === undefined || fila.kitEntregadoEn !== null)
    }).length))
})

// ─── Cuentas ────────────────────────────────────────────────────────────────

const bearer = (token: string) => `Bearer ${token}`
const admin = () => bearer(tokenDeRol('ADMIN'))
const tesorero = () => bearer(tokenDeRol('TESORERO', 30, { eventoIds: [2] }))
/** Comisión del evento 2 que solo marca asistencia (implica `asistencia.ver`). */
const comision = () => bearer(tokenDeRol('COMISION', 41, { eventoIds: [2], permisos: ['asistencia.marcar'] }))
const comisionSoloVer = () => bearer(tokenDeRol('COMISION', 45, { eventoIds: [2], permisos: ['asistencia.ver'] }))

const entregar = (id: number, autorizacion: string) => request(app).put(`/api/v1/inscriptions/${id}/kit`).set('Authorization', autorizacion)
const deshacer = (id: number, autorizacion: string) => request(app).delete(`/api/v1/inscriptions/${id}/kit`).set('Authorization', autorizacion)
const fila = (id: number) => inscripciones.get(id) as Fila

// ─── Entregar ───────────────────────────────────────────────────────────────

describe('entregar el kit (spec 037)', () => {
    it('quien marca asistencia lo entrega: queda la hora y quién, y la respuesta dice el nuevo estado', async () => {
        const antes = Date.now()
        const r = await entregar(500, comision())
        expect(r.status).toBe(200)
        expect(r.body).toEqual({
            success: true,
            data: {
                inscripcionId: 500,
                kit: { incluye: true, entregado: true, entregadoEn: expect.any(String), entregadoPor: { id: 41, nombres: 'Test', apellidos: 'Comisión tecnológica' } },
            },
        })
        const hora = new Date(r.body.data.kit.entregadoEn).getTime()
        expect(hora).toBeGreaterThanOrEqual(antes)
        expect(hora).toBeLessThanOrEqual(Date.now())
        expect(fila(500)).toMatchObject({ kitEntregadoPorId: 41 })
        expect(fila(500).kitEntregadoEn).toBeInstanceOf(Date)
    })

    it('la escritura está condicionada a que siga sin entregar (dos operadores a la vez no se pisan)', async () => {
        await entregar(500, comision())
        expect(m.inscripcion.updateMany).toHaveBeenCalledTimes(1)
        expect(m.inscripcion.updateMany.mock.calls[0][0].where).toEqual({ id: 500, kitEntregadoEn: null })
    })

    it('si otra cuenta lo entrega entre la lectura y la escritura, responde 409 con su hora', async () => {
        m.inscripcion.updateMany.mockImplementationOnce(() => {
            Object.assign(fila(500), { kitEntregadoEn: ENTREGADO_EN })
            return Promise.resolve({ count: 0 })
        })
        const r = await entregar(500, comision())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('KIT_ALREADY_DELIVERED')
        expect(r.body.message).toMatch(/^El kit ya fue entregado (a las|el \d{4}-\d{2}-\d{2} a las) \d{2}:\d{2}\.$/)
    })

    it('entregarlo otra vez responde 409 KIT_ALREADY_DELIVERED y no toca la entrega original', async () => {
        const r = await entregar(505, admin())
        expect(r.status).toBe(409)
        expect(r.body).toMatchObject({ success: false, code: 'KIT_ALREADY_DELIVERED' })
        expect(r.body.message).toContain('10:32')
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
        expect(fila(505).kitEntregadoEn).toBe(ENTREGADO_EN)
    })

    it('un tipo sin kit, virtual (aunque marque kit) o una cortesía sin tipo responde 409 KIT_NOT_INCLUDED', async () => {
        for (const id of [501, 502, 506, 504]) {
            const r = await entregar(id, admin())
            expect(r.status).toBe(409)
            expect(r.body.code).toBe('KIT_NOT_INCLUDED')
        }
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('una inscripción sin aprobar responde 403 NOT_APPROVED', async () => {
        const r = await entregar(503, admin())
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('NOT_APPROVED')
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('una inscripción inexistente responde 404 y un id inválido 400', async () => {
        expect((await entregar(999, admin())).body).toMatchObject({ code: 'INSCRIPTION_NOT_FOUND' })
        expect((await entregar(999, admin())).status).toBe(404)
        const invalido = await request(app).put('/api/v1/inscriptions/abc/kit').set('Authorization', admin())
        expect(invalido.status).toBe(400)
        expect(invalido.body.code).toBe('INVALID_ID')
    })

    it('no depende del horario de ninguna actividad ni pide cuerpo', async () => {
        const r = await entregar(500, comision())
        expect(r.status).toBe(200)
        expect(m.inscripcion.findUnique).toHaveBeenCalled()
    })
})

// ─── Deshacer ───────────────────────────────────────────────────────────────

describe('deshacer la entrega del kit (spec 037)', () => {
    it('lo deja otra vez pendiente, sin hora ni autor, y se puede volver a entregar', async () => {
        const r = await deshacer(505, comision())
        expect(r.status).toBe(200)
        expect(r.body.data).toEqual({ inscripcionId: 505, kit: { incluye: true, entregado: false, entregadoEn: null, entregadoPor: null } })
        expect(m.inscripcion.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 505, kitEntregadoEn: { not: null } },
            data: { kitEntregadoEn: null, kitEntregadoPorId: null },
        })
        expect(fila(505).kitEntregadoEn).toBeNull()

        // Otro día el kit sí está: se entrega de nuevo, con la hora nueva
        const otra = await entregar(505, comision())
        expect(otra.status).toBe(200)
        expect(otra.body.data.kit.entregadoEn).not.toBe(ENTREGADO_EN.toISOString())
    })

    it('si no estaba entregado responde 409 KIT_NOT_DELIVERED', async () => {
        const r = await deshacer(500, comision())
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('KIT_NOT_DELIVERED')
    })

    it('se puede deshacer aunque el tipo ya no lleve kit (corregir un error pasado)', async () => {
        const r = await deshacer(507, comision())
        expect(r.status).toBe(200)
        expect(r.body.data.kit).toMatchObject({ incluye: false, entregado: false })
        expect(fila(507).kitEntregadoEn).toBeNull()
    })

    it('una inscripción inexistente responde 404', async () => {
        const r = await deshacer(999, admin())
        expect(r.status).toBe(404)
        expect(r.body.code).toBe('INSCRIPTION_NOT_FOUND')
    })
})

// ─── Permisos y alcance ─────────────────────────────────────────────────────

describe('quién puede entregar y deshacer (spec 037)', () => {
    it('sin asistencia.marcar responde 403 FORBIDDEN y no toca la fila (Tesorero y Comisión que solo ve)', async () => {
        for (const autorizacion of [tesorero(), comisionSoloVer()]) {
            expect((await entregar(500, autorizacion)).body.code).toBe('FORBIDDEN')
            expect((await deshacer(505, autorizacion)).status).toBe(403)
        }
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
    })

    it('sin sesión responde 401', async () => {
        expect((await request(app).put('/api/v1/inscriptions/500/kit')).status).toBe(401)
        expect((await request(app).delete('/api/v1/inscriptions/505/kit')).status).toBe(401)
    })

    it('una cuenta por evento no toca inscripciones de otro evento: 403 EVENT_NOT_ASSIGNED', async () => {
        const r = await entregar(600, comision())
        expect(r.status).toBe(403)
        expect(r.body.code).toBe('EVENT_NOT_ASSIGNED')
        expect(m.inscripcion.updateMany).not.toHaveBeenCalled()
        expect((await deshacer(600, comision())).body.code).toBe('EVENT_NOT_ASSIGNED')
    })

    it('el Administrador (global) lo hace en cualquier evento', async () => {
        const r = await entregar(600, admin())
        expect(r.status).toBe(200)
        expect(fila(600).kitEntregadoPorId).toBe(2)
    })
})

// ─── Resumen ────────────────────────────────────────────────────────────────

describe('resumen de kits del evento (spec 037)', () => {
    const resumen = (eventoId: number, autorizacion: string) => request(app).get(`/api/v1/events/${eventoId}/kits/summary`).set('Authorization', autorizacion)

    it('cuenta los aprobados presenciales con kit, los entregados y los pendientes', async () => {
        const r = await resumen(2, tesorero())
        expect(r.status).toBe(200)
        // Con kit y aprobado: 500 (pendiente) y 505 (entregado). El virtual, el sin kit y el no aprobado no cuentan.
        expect(r.body.data).toEqual({ conKit: 2, entregados: 1, pendientes: 1 })
        expect(m.inscripcion.count.mock.calls[0][0].where).toEqual({
            eventoId: 2, estado: { codigo: 'APROBADO' }, tipoInscripcion: { incluyeKit: true, modalidad: 'PRESENCIAL' },
        })
    })

    it('quien solo ve la asistencia también lo ve; sin asistencia.ver o de otro evento, no', async () => {
        expect((await resumen(2, comisionSoloVer())).status).toBe(200)
        expect((await resumen(3, comisionSoloVer())).body.code).toBe('EVENT_NOT_ASSIGNED')
        const sinVer = await resumen(2, bearer(tokenDeRol('COMISION', 46, { eventoIds: [2], permisos: ['mensajes.ver'] })))
        expect(sinVer.status).toBe(403)
    })

    it('un evento que no existe responde 404 para una cuenta global', async () => {
        expect((await resumen(999, admin())).status).toBe(404)
    })
})

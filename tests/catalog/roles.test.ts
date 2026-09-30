import request from 'supertest'
import app from '../../src/app'
import { prisma } from '../../src/database/prisma'
import { DEPENDENCIAS, ETIQUETAS_PERMISO, PERMISOS_ELEGIBLES_COMISION, PERMISOS_POR_ROL } from '../../src/core/permisos'
import { tokenDeParticipante, tokenDeRol } from '../helpers/tokens'

// GET /v1/roles (spec 013): solo los roles que el actor puede asignar, con sus permisos.
jest.mock('../../src/database/prisma', () => ({
    prisma: { rol: { findMany: jest.fn() } },
}))

const m = prisma as unknown as { rol: { findMany: jest.Mock } }
const FILAS = [
    { id: 1, codigo: 'SUPERADMIN', nombre: 'Owner' },
    { id: 2, codigo: 'ADMIN', nombre: 'Administrador del sistema' },
    { id: 3, codigo: 'TESORERO', nombre: 'Tesorero' },
    { id: 4, codigo: 'COMISION', nombre: 'Comisión tecnológica' },
    // Un código que el backend no conoce nunca se ofrece
    { id: 5, codigo: 'OWNER', nombre: 'Owner (manual)' },
]
const roles = (auth?: string) => {
    const r = request(app).get('/api/v1/roles')
    return auth ? r.set('Authorization', `Bearer ${auth}`) : r
}

beforeEach(() => {
    jest.clearAllMocks()
    m.rol.findMany.mockImplementation(async ({ where }: { where: { codigo: { in: string[] } } }) => FILAS.filter((f) => where.codigo.in.includes(f.codigo) || f.codigo === 'OWNER'))
})

describe('GET /v1/roles', () => {
    it('el Owner recibe los cuatro roles con su alcance y permisos', async () => {
        const r = await roles(tokenDeRol('SUPERADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.success).toBe(true)
        expect(r.body.data.map((rol: { codigo: string }) => rol.codigo)).toEqual(['SUPERADMIN', 'ADMIN', 'TESORERO', 'COMISION'])
        expect(m.rol.findMany).toHaveBeenCalledWith({ where: { codigo: { in: ['SUPERADMIN', 'ADMIN', 'TESORERO', 'COMISION'] } }, orderBy: { id: 'asc' } })
        const [owner, admin, tesorero] = r.body.data
        expect(owner).toEqual({ id: 1, codigo: 'SUPERADMIN', nombre: 'Owner', alcance: 'GLOBAL', permisos: [...PERMISOS_POR_ROL.SUPERADMIN] })
        expect(admin).toMatchObject({ id: 2, nombre: 'Administrador del sistema', alcance: 'GLOBAL' })
        expect(admin.permisos).not.toContain('sistema.configurar')
        expect(tesorero).toEqual({ id: 3, codigo: 'TESORERO', nombre: 'Tesorero', alcance: 'EVENTO', permisos: [...PERMISOS_POR_ROL.TESORERO] })
    })

    it('la Comisión trae los permisos elegibles con su nombre y dependencias, y el permiso por defecto', async () => {
        const r = await roles(tokenDeRol('SUPERADMIN'))
        const comision = r.body.data.find((rol: { codigo: string }) => rol.codigo === 'COMISION')
        expect(comision).toMatchObject({ id: 4, nombre: 'Comisión tecnológica', alcance: 'EVENTO', permisos: [], permisosPorDefecto: ['asistencia.marcar'] })
        expect(comision.permisosElegibles.map((p: { codigo: string }) => p.codigo)).toEqual([...PERMISOS_ELEGIBLES_COMISION])
        expect(comision.permisosElegibles).toContainEqual({ codigo: 'asistencia.marcar', nombre: ETIQUETAS_PERMISO['asistencia.marcar'], implica: [...(DEPENDENCIAS['asistencia.marcar'] ?? [])] })
        expect(comision.permisosElegibles).toContainEqual({ codigo: 'resumen.ver', nombre: ETIQUETAS_PERMISO['resumen.ver'], implica: [] })
        expect(comision.permisosElegibles.map((p: { codigo: string }) => p.codigo)).not.toContain('pagos.ver')
    })

    it('el Administrador del sistema solo recibe Tesorero y Comisión', async () => {
        const r = await roles(tokenDeRol('ADMIN'))
        expect(r.status).toBe(200)
        expect(r.body.data.map((rol: { codigo: string }) => rol.codigo)).toEqual(['TESORERO', 'COMISION'])
        expect(m.rol.findMany).toHaveBeenCalledWith({ where: { codigo: { in: ['TESORERO', 'COMISION'] } }, orderBy: { id: 'asc' } })
    })

    it('Tesorero, Comisión y participantes reciben 403; sin token, 401', async () => {
        for (const token of [tokenDeRol('TESORERO', 30, { eventoIds: [2] }), tokenDeRol('COMISION', 40, { eventoIds: [2], permisos: ['asistencia.marcar'] }), tokenDeParticipante()]) {
            const r = await roles(token)
            expect(r.status).toBe(403)
            expect(r.body.code).toBe('FORBIDDEN')
        }
        expect((await roles()).status).toBe(401)
        expect(m.rol.findMany).not.toHaveBeenCalled()
    })
})

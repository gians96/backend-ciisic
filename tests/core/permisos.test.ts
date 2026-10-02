import { ROL, ROLES, ROLES_GLOBALES } from '../../src/core/catalogos'
import {
    ALCANCE,
    DEPENDENCIAS,
    ETIQUETAS_PERMISO,
    PERMISOS,
    PERMISOS_COMISION_POR_DEFECTO,
    PERMISOS_ELEGIBLES_COMISION,
    PERMISOS_POR_ROL,
    PERMISOS_SOLO_OWNER,
    alcanceDeRol,
    cierre,
    esPermiso,
    permisosEfectivos,
    rolesGestionables,
    type Permiso,
} from '../../src/core/permisos'

const ordenados = (permisos: Iterable<Permiso>) => [...permisos].sort()
const GLOBALES = PERMISOS.filter((p) => ALCANCE[p] === 'G')

describe('catálogo de permisos (spec 013)', () => {
    it('cada permiso tiene alcance y etiqueta; esPermiso solo acepta códigos del catálogo', () => {
        expect(Object.keys(ETIQUETAS_PERMISO).sort()).toEqual([...PERMISOS].sort())
        for (const p of PERMISOS) expect(['G', 'E']).toContain(ALCANCE[p])
        expect(esPermiso('asistencia.marcar')).toBe(true)
        expect(esPermiso('ASISTENCIA_MARCAR')).toBe(false)
        expect(esPermiso('toString')).toBe(false)
        expect(esPermiso(undefined)).toBe(false)
    })

    it('las dependencias apuntan a permisos del catálogo y del mismo alcance', () => {
        for (const [permiso, implicados] of Object.entries(DEPENDENCIAS) as [Permiso, Permiso[]][]) {
            for (const implicado of implicados) {
                expect(esPermiso(implicado)).toBe(true)
                expect({ permiso, alcance: ALCANCE[implicado] }).toEqual({ permiso, alcance: ALCANCE[permiso] })
            }
        }
    })
})

describe('cierre', () => {
    it('agrega las dependencias hasta el punto fijo', () => {
        expect(ordenados(cierre(['inscripciones.validar']))).toEqual(['inscripciones.validar', 'inscripciones.ver', 'pagos.ver'])
        expect(ordenados(cierre(['asistencia.fuera_horario']))).toEqual(['asistencia.fuera_horario', 'asistencia.marcar', 'asistencia.ver'])
        expect(ordenados(cierre(['mensajes.eliminar', 'credenciales.reenviar']))).toEqual(['credenciales.reenviar', 'inscripciones.ver', 'mensajes.eliminar', 'mensajes.ver'])
        expect(ordenados(cierre(['ponencias.ver']))).toEqual(['ponencias.ver'])
    })

    it('ignora códigos desconocidos y repetidos, y es idempotente', () => {
        expect(ordenados(cierre(['asistencia.marcar', 'asistencia.marcar', 'no.existe', 'ADMIN']))).toEqual(['asistencia.marcar', 'asistencia.ver'])
        expect(cierre([]).size).toBe(0)
        for (const p of PERMISOS) expect(ordenados(cierre(cierre([p])))).toEqual(ordenados(cierre([p])))
    })
})

describe('permisosEfectivos por rol', () => {
    it('el Owner tiene todos los permisos', () => {
        expect(ordenados(permisosEfectivos(ROL.OWNER))).toEqual([...PERMISOS].sort())
    })

    it('el Administrador del sistema tiene todo menos sistema.configurar e inscripciones.eliminar', () => {
        const admin = permisosEfectivos(ROL.ADMINISTRADOR)
        expect(admin.has('sistema.configurar')).toBe(false)
        expect(admin.has('inscripciones.eliminar')).toBe(false)
        expect(ordenados(admin)).toEqual(PERMISOS.filter((p) => !PERMISOS_SOLO_OWNER.includes(p)).sort())
        expect(admin.has('correo.configurar')).toBe(true)
        expect(admin.has('eventos.eliminar')).toBe(true)
        expect(admin.has('administradores.gestionar')).toBe(true)
        expect(admin.has('inscripciones.cancelar')).toBe(true)
    })

    it.each(['sistema.configurar', 'inscripciones.eliminar'] as Permiso[])('solo el Owner tiene %s', (permiso) => {
        expect(ROLES.filter((rol) => permisosEfectivos(rol, [...PERMISOS]).has(permiso))).toEqual([ROL.OWNER])
    })

    it('el Tesorero valida pagos en sus eventos pero no cancela ni configura', () => {
        const tesorero = permisosEfectivos(ROL.TESORERO)
        expect(ordenados(tesorero)).toEqual(ordenados(cierre(PERMISOS_POR_ROL[ROL.TESORERO])))
        for (const p of ['resumen.ver', 'inscripciones.ver', 'inscripciones.exportar', 'credenciales.reenviar', 'pagos.ver', 'inscripciones.validar', 'asistencia.ver', 'ponencias.ver', 'mensajes.ver'] as Permiso[]) {
            expect(tesorero.has(p)).toBe(true)
        }
        expect(tesorero.has('inscripciones.cancelar')).toBe(false)
        expect(tesorero.has('asistencia.marcar')).toBe(false)
        expect(ordenados(tesorero).filter((p) => ALCANCE[p] === 'G')).toEqual([])
    })

    it('los permisos guardados solo cuentan para la Comisión', () => {
        expect(ordenados(permisosEfectivos(ROL.TESORERO, ['sistema.configurar', 'asistencia.marcar']))).toEqual(ordenados(permisosEfectivos(ROL.TESORERO)))
        expect(ordenados(permisosEfectivos(ROL.ADMINISTRADOR, ['sistema.configurar']))).toEqual(ordenados(permisosEfectivos(ROL.ADMINISTRADOR)))
    })

    it('la Comisión tiene solo los permisos elegidos, con sus dependencias', () => {
        expect(permisosEfectivos(ROL.COMISION).size).toBe(0)
        expect(permisosEfectivos(ROL.COMISION, []).size).toBe(0)
        expect(ordenados(permisosEfectivos(ROL.COMISION, ['asistencia.marcar']))).toEqual(['asistencia.marcar', 'asistencia.ver'])
        expect(ordenados(permisosEfectivos(ROL.COMISION, ['asistencia.fuera_horario']))).toEqual(['asistencia.fuera_horario', 'asistencia.marcar', 'asistencia.ver'])
        expect(ordenados(permisosEfectivos(ROL.COMISION, ['inscripciones.exportar']))).toEqual(['inscripciones.exportar', 'inscripciones.ver'])
    })

    it('la Comisión ignora los permisos no elegibles guardados en la BD', () => {
        const guardados = ['asistencia.marcar', 'pagos.ver', 'inscripciones.validar', 'inscripciones.cancelar', 'sistema.configurar', 'eventos.configurar', 'mensajes.eliminar', 'no.existe']
        expect(ordenados(permisosEfectivos(ROL.COMISION, guardados))).toEqual(['asistencia.marcar', 'asistencia.ver'])
        expect(permisosEfectivos(ROL.COMISION, ['pagos.ver', 'inscripciones.validar']).size).toBe(0)
    })
})

describe('permisos elegibles de la Comisión', () => {
    it('nunca incluyen pagos ni la validación de pagos', () => {
        expect(PERMISOS_ELEGIBLES_COMISION.filter((p) => p === 'pagos.ver' || p === 'inscripciones.validar')).toEqual([])
    })

    it('nunca incluyen permisos globales', () => {
        expect(PERMISOS_ELEGIBLES_COMISION.filter((p) => GLOBALES.includes(p))).toEqual([])
    })

    it('sus dependencias no salen de los elegibles (elegir todo tampoco da pagos)', () => {
        const todo = cierre(PERMISOS_ELEGIBLES_COMISION)
        expect(ordenados(todo)).toEqual(ordenados(PERMISOS_ELEGIBLES_COMISION))
        expect(ordenados(permisosEfectivos(ROL.COMISION, [...PERMISOS]))).toEqual(ordenados(PERMISOS_ELEGIBLES_COMISION))
    })

    it('por defecto, solo marcar asistencia', () => {
        expect([...PERMISOS_COMISION_POR_DEFECTO]).toEqual(['asistencia.marcar'])
        for (const p of PERMISOS_COMISION_POR_DEFECTO) expect(PERMISOS_ELEGIBLES_COMISION).toContain(p)
    })
})

describe('roles: alcance y delegación', () => {
    it('Owner y Administrador son globales; Tesorero y Comisión, por evento', () => {
        expect(ROLES.map((rol) => [rol, alcanceDeRol(rol)])).toEqual([
            [ROL.OWNER, 'GLOBAL'], [ROL.ADMINISTRADOR, 'GLOBAL'], [ROL.TESORERO, 'EVENTO'], [ROL.COMISION, 'EVENTO'],
        ])
        expect([...ROLES_GLOBALES].sort()).toEqual(ROLES.filter((rol) => alcanceDeRol(rol) === 'GLOBAL').sort())
    })

    it('un rol por evento nunca tiene permisos globales', () => {
        for (const rol of ROLES.filter((r) => alcanceDeRol(r) === 'EVENTO')) {
            expect(ordenados(permisosEfectivos(rol, [...PERMISOS])).filter((p) => ALCANCE[p] === 'G')).toEqual([])
        }
    })

    it('rolesGestionables: el Owner gestiona todos; el Administrador, solo Tesorero y Comisión', () => {
        expect(rolesGestionables(ROL.OWNER)).toEqual([ROL.OWNER, ROL.ADMINISTRADOR, ROL.TESORERO, ROL.COMISION])
        expect(rolesGestionables(ROL.ADMINISTRADOR)).toEqual([ROL.TESORERO, ROL.COMISION])
        expect(rolesGestionables(ROL.TESORERO)).toEqual([])
        expect(rolesGestionables(ROL.COMISION)).toEqual([])
    })

    it('solo quien gestiona algún rol tiene administradores.gestionar', () => {
        for (const rol of ROLES) {
            expect({ rol, gestiona: permisosEfectivos(rol, [...PERMISOS]).has('administradores.gestionar') })
                .toEqual({ rol, gestiona: rolesGestionables(rol).length > 0 })
        }
    })
})

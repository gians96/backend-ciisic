import { ALCANCE, PERMISOS_ELEGIBLES_COMISION, cierre, permisosEfectivos } from '../../src/core/permisos'
import { ROL } from '../../src/core/catalogos'

describe('permisos de reportes (spec 025)', () => {
    it('ver y descargar son por evento y cargar el padrón es global', () => {
        expect(ALCANCE['reportes.ver']).toBe('E')
        expect(ALCANCE['reportes.exportar']).toBe('E')
        expect(ALCANCE['reportes.gestionar']).toBe('G')
    })

    it('descargar implica ver, y ver implica ver inscritos', () => {
        expect([...cierre(['reportes.exportar'])].sort()).toEqual(['inscripciones.ver', 'reportes.exportar', 'reportes.ver'])
    })

    it('el Tesorero ve y descarga; el Owner y el Administrador tienen además la carga del padrón', () => {
        const tesorero = permisosEfectivos(ROL.TESORERO)
        expect(tesorero.has('reportes.ver') && tesorero.has('reportes.exportar')).toBe(true)
        expect(tesorero.has('reportes.gestionar')).toBe(false)
        expect(permisosEfectivos(ROL.OWNER).has('reportes.gestionar')).toBe(true)
        expect(permisosEfectivos(ROL.ADMINISTRADOR).has('reportes.gestionar')).toBe(true)
    })

    it('la Comisión puede recibir ver y descargar, nunca cargar el padrón, y no obtiene datos de pago por ello', () => {
        expect(PERMISOS_ELEGIBLES_COMISION).toEqual(expect.arrayContaining(['reportes.ver', 'reportes.exportar']))
        expect(PERMISOS_ELEGIBLES_COMISION).not.toContain('reportes.gestionar')
        const efectivos = permisosEfectivos(ROL.COMISION, ['reportes.exportar', 'reportes.gestionar'])
        expect([...efectivos].sort()).toEqual(['inscripciones.ver', 'reportes.exportar', 'reportes.ver'])
        expect(efectivos.has('pagos.ver')).toBe(false)
    })
})

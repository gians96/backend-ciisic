import type { Prisma } from '@prisma/client'
import { guardarPadron, type CursoPadron, type EstudiantePadron } from '../../src/api/advisory/services/importacion'

/** Transacción simulada: anota el orden de las escrituras y devuelve los ids de los cursos que se «guardaron». */
function crearTx() {
    const llamadas: string[] = []
    const registrar = (nombre: string) => jest.fn(async () => { llamadas.push(nombre); return { count: 0 } })
    const tx = {
        padronEstudiante: { deleteMany: registrar('estudiantes.borrar'), createMany: registrar('estudiantes.crear') },
        padronSeccion: { createMany: registrar('secciones.crear') },
        padronCurso: {
            deleteMany: registrar('cursos.borrar'),
            createMany: registrar('cursos.crear'),
            findMany: jest.fn(async () => { llamadas.push('cursos.leer'); return [{ id: 501, jpCargaId: 100 }, { id: 502, jpCargaId: 101 }] }),
        },
        padronMatricula: { createMany: registrar('matriculas.crear') },
    }
    return { tx, llamadas, tipado: tx as unknown as Prisma.TransactionClient }
}

const estudiante = (codigo: string, matriculas?: number[]): EstudiantePadron => ({
    documento: '60000001', codigo, correo: null, nombre: `ALUMNO ${codigo}`, celular: null, carrera: 'IS', ciclo: 'VI', turno: 'M', seccion: 'A1',
    distrito: null, provincia: null, departamento: null,
    secciones: [{ ciclo: 'VI', seccion: 'A1', turno: 'M', cursos: matriculas?.length ?? 1 }],
    ...(matriculas ? { matriculas } : {}),
})

const curso = (jpCargaId: number, asesorId: number | null): CursoPadron =>
    ({ jpCargaId, codigo: `ISES${jpCargaId}`, nombre: `CURSO ${jpCargaId}`, ciclo: 'VI', turno: 'M', seccion: 'A1', asesorId, docenteNombre: 'DOCENTE' })

describe('guardarPadron', () => {
    it('sin cursos (Excel) borra todo, deja sin cursos y no escribe matrículas', async () => {
        const { tx, llamadas, tipado } = crearTx()
        await guardarPadron(tipado, 2, '2026-2', [estudiante('A1')])
        expect(llamadas).toEqual(['estudiantes.borrar', 'cursos.borrar', 'estudiantes.crear', 'secciones.crear'])
        expect(tx.padronEstudiante.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2 } })
        expect(tx.padronCurso.deleteMany).toHaveBeenCalledWith({ where: { eventoId: 2 } })
        expect(tx.padronMatricula.createMany).not.toHaveBeenCalled()
    })

    it('con cursos guarda estudiantes, secciones, cursos y las matrículas de cada alumno con el id real de su curso', async () => {
        const { tx, llamadas, tipado } = crearTx()
        await guardarPadron(tipado, 2, '2026-2', [estudiante('A1', [100, 101]), estudiante('B1', [101]), estudiante('C1', [])], [curso(100, 70), curso(101, null)])
        expect(llamadas).toEqual(['estudiantes.borrar', 'cursos.borrar', 'estudiantes.crear', 'secciones.crear', 'cursos.crear', 'cursos.leer', 'matriculas.crear'])
        expect(tx.padronCurso.createMany).toHaveBeenCalledWith({
            data: [
                { eventoId: 2, jpCargaId: 100, codigo: 'ISES100', nombre: 'CURSO 100', ciclo: 'VI', turno: 'M', seccion: 'A1', asesorId: 70, docenteNombre: 'DOCENTE' },
                { eventoId: 2, jpCargaId: 101, codigo: 'ISES101', nombre: 'CURSO 101', ciclo: 'VI', turno: 'M', seccion: 'A1', asesorId: null, docenteNombre: 'DOCENTE' },
            ],
        })
        expect(tx.padronMatricula.createMany).toHaveBeenCalledWith({
            data: [
                { eventoId: 2, codigo: 'A1', cursoId: 501 },
                { eventoId: 2, codigo: 'A1', cursoId: 502 },
                { eventoId: 2, codigo: 'B1', cursoId: 502 },
            ],
        })
    })

    it('una matrícula a un curso que no se guardó se ignora y `secciones` no va a la tabla de estudiantes', async () => {
        const { tx, tipado } = crearTx()
        await guardarPadron(tipado, 2, '2026-2', [estudiante('A1', [100, 999])], [curso(100, 70)])
        const datos = (tx.padronMatricula.createMany.mock.calls[0] as unknown as [{ data: Array<{ cursoId: number }> }])[0].data
        expect(datos.map((d) => d.cursoId)).toEqual([501])
        const fila = (tx.padronEstudiante.createMany.mock.calls[0] as unknown as [{ data: Array<Record<string, unknown>> }])[0].data[0]
        expect(fila).not.toHaveProperty('secciones')
        expect(fila).not.toHaveProperty('matriculas')
    })
})

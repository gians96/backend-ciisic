import fs from 'fs'
import path from 'path'
import * as yup from 'yup'
import { crearPonenciaSchema } from '../../src/api/specialized-talk/validation'

const archivo = path.resolve(__dirname, '../../prisma/datos/ponencias-especializadas-2026.json')
const { ponencias } = JSON.parse(fs.readFileSync(archivo, 'utf8')) as { ponencias: unknown[] }

describe('prisma/datos/ponencias-especializadas-2026.json', () => {
    it('todas las ponencias cumplen el esquema de creación', async () => {
        await expect(yup.array().of(crearPonenciaSchema).required().validate(ponencias, { abortEarly: false })).resolves.toHaveLength(18)
    })

    it('hay 7 el martes 27 y 11 el miércoles 28, todas de 12:00 a 12:45', async () => {
        const lista = await yup.array().of(crearPonenciaSchema).required().validate(ponencias)
        const porDia = (fecha: string) => lista.filter((p) => p.fecha === fecha)
        expect(porDia('2026-10-27')).toHaveLength(7)
        expect(porDia('2026-10-28')).toHaveLength(11)
        for (const p of lista) expect([p.horaInicio, p.horaFin]).toEqual(['12:00', '12:45'])
    })

    it('no repite ambiente ni ponente el mismo día, y el cupo es 20 en laboratorios y 40 en aulas', async () => {
        const lista = await yup.array().of(crearPonenciaSchema).required().validate(ponencias)
        const vistos = new Set<string>()
        for (const p of lista) {
            for (const clave of [`${p.fecha} ${p.ambiente}`, `${p.fecha} ${p.ponente.nombre}`]) {
                expect(vistos.has(clave)).toBe(false)
                vistos.add(clave)
            }
            expect(p.cupo).toBe(p.ambiente.startsWith('Laboratorio') ? 20 : 40)
        }
    })

    it('el orden es consecutivo y sigue los ambientes de cada día', async () => {
        const lista = await yup.array().of(crearPonenciaSchema).required().validate(ponencias)
        expect(lista.map((p) => p.orden)).toEqual(lista.map((_, i) => i + 1))
    })
})

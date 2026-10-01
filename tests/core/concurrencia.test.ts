import { limitarConcurrencia } from '../../src/core/concurrencia'

/** Tarea que no termina hasta que la prueba la libera. */
function tareaControlada() {
    let liberar: (valor: string) => void = () => undefined
    let fallar: (error: Error) => void = () => undefined
    const promesa = new Promise<string>((resolve, reject) => {
        liberar = resolve
        fallar = reject
    })
    return { promesa, liberar, fallar }
}

const tic = () => new Promise((resolve) => setImmediate(resolve))

describe('limitarConcurrencia', () => {
    it('ejecuta como mucho `max` tareas a la vez y las demás en orden de llegada', async () => {
        const enTurno = limitarConcurrencia(2, 30)
        const tareas = Array.from({ length: 5 }, tareaControlada)
        const iniciadas: number[] = []
        let activas = 0
        let maximo = 0
        const resultados = tareas.map((tarea, i) => enTurno(async () => {
            iniciadas.push(i)
            activas++
            maximo = Math.max(maximo, activas)
            try {
                return await tarea.promesa
            } finally {
                activas--
            }
        }))
        await tic()
        expect(iniciadas).toEqual([0, 1])
        tareas[1].liberar('b')
        await tic()
        expect(iniciadas).toEqual([0, 1, 2])
        tareas.forEach((tarea, i) => tarea.liberar(String(i)))
        await expect(Promise.all(resultados)).resolves.toEqual(['0', 'b', '2', '3', '4'])
        expect(maximo).toBe(2)
    })

    it('con la cola llena responde 503 PDF_BUSY sin ejecutar la tarea', async () => {
        const enTurno = limitarConcurrencia(1, 2)
        const bloqueo = tareaControlada()
        const ejecutadas = jest.fn()
        const primeras = [enTurno(() => bloqueo.promesa), enTurno(async () => ejecutadas('a')), enTurno(async () => ejecutadas('b'))]
        await expect(enTurno(async () => ejecutadas('c'))).rejects.toMatchObject({ status: 503, code: 'PDF_BUSY' })
        bloqueo.liberar('listo')
        await Promise.all(primeras)
        expect(ejecutadas.mock.calls).toEqual([['a'], ['b']])
        // Con la cola vacía vuelve a aceptar
        await expect(enTurno(async () => 'otra')).resolves.toBe('otra')
    })

    it('una tarea que falla libera su turno', async () => {
        const enTurno = limitarConcurrencia(1, 5)
        const falla = tareaControlada()
        const primera = enTurno(() => falla.promesa)
        const segunda = enTurno(async () => 'siguiente')
        falla.fallar(new Error('puppeteer se cayó'))
        await expect(primera).rejects.toThrow('puppeteer se cayó')
        await expect(segunda).resolves.toBe('siguiente')
        await expect(enTurno(() => {
            throw new Error('síncrono')
        })).rejects.toThrow('síncrono')
        await expect(enTurno(async () => 'sigue libre')).resolves.toBe('sigue libre')
    })
})

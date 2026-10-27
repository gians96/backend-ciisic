import { AsyncLocalStorage } from 'async_hooks'

/**
 * Recuento de un envío masivo (spec 044): cuántos correos salieron por cada credencial y si se acabaron los envíos
 * de todas. Vive en un `AsyncLocalStorage` para que `enviarConCredencial` (que sigue devolviendo `string | null`)
 * lo anote sin que cada función intermedia tenga que pasarlo; fuera de `conRecuento` no hace nada.
 */
export interface EnviosPorCredencial {
    credencialId: number
    nombre: string
    enviados: number
}

interface Almacen {
    porCredencial: Map<number, EnviosPorCredencial>
    agotado: boolean
}

/** Lo que `recorrer` consulta entre persona y persona para saber si debe cortar. */
export interface EstadoRecuento {
    readonly agotado: boolean
}

const almacen = new AsyncLocalStorage<Almacen>()

/** Corre la tarea anotando los envíos que ocurran dentro de ella (también los de las funciones que llame). */
export async function conRecuento<T>(tarea: (estado: EstadoRecuento) => Promise<T>): Promise<{ valor: T, porCredencial: EnviosPorCredencial[], agotado: boolean }> {
    const actual: Almacen = { porCredencial: new Map(), agotado: false }
    const valor = await almacen.run(actual, () => tarea({ get agotado() { return actual.agotado } }))
    return { valor, porCredencial: [...actual.porCredencial.values()], agotado: actual.agotado }
}

/** Un correo salió por esta credencial (el proveedor confirmó que lo aceptó). */
export function anotarEnvio(credencial: { id: number, nombre: string }): void {
    const actual = almacen.getStore()
    if (!actual) return
    const previo = actual.porCredencial.get(credencial.id)
    if (previo) previo.enviados += 1
    else actual.porCredencial.set(credencial.id, { credencialId: credencial.id, nombre: credencial.nombre, enviados: 1 })
}

/** Ninguna credencial activa tiene envíos: seguir intentando con el resto de la lista sería inútil. */
export function anotarAgotado(): void {
    const actual = almacen.getStore()
    if (actual) actual.agotado = true
}

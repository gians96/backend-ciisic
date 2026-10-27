/**
 * Tipos comunes a los proveedores de correo (Brevo por API y Gmail por SMTP, spec 041): el mensaje
 * que se envía y el error con el que un proveedor dice que no pudo enviarlo.
 */
export class CorreoFallido extends Error {
    readonly status?: number
    /**
     * El fallo es de la cuenta (sin créditos, límite diario, clave o permisos inválidos) y no del
     * mensaje: no tiene sentido insistir con ella un rato (`enEspera`) y conviene pasar a la siguiente.
     */
    readonly deLaCuenta: boolean

    constructor(message: string, status?: number, deLaCuenta = false) {
        super(message)
        this.name = 'CorreoFallido'
        this.status = status
        this.deLaCuenta = deLaCuenta
    }
}

export interface CorreoSaliente {
    remitente: { email: string, name?: string }
    para: { email: string, name?: string }[]
    asunto: string
    html: string
    adjuntos?: { nombre: string, contenidoBase64: string }[]
}

/** Lo que muestra «Probar»: la cuenta y, si el proveedor lo informa, los créditos de su plan. */
export interface CuentaCorreo {
    correo: string | null
    empresa: string | null
    planes: { tipo: string, creditos: number | null, tipoCreditos: string | null }[]
}

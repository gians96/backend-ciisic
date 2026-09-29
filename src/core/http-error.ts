/**
 * Error de dominio con estado HTTP y código estable.
 * El `errorHandler` lo transforma en `{ success: false, code, message, fields? }`.
 */
export class HttpError extends Error {
    readonly status: number
    readonly code: string
    readonly fields?: Record<string, string>

    constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
        super(message)
        this.name = 'HttpError'
        this.status = status
        this.code = code
        this.fields = fields
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

export const badRequest = (code: string, message: string, fields?: Record<string, string>) => new HttpError(400, code, message, fields)
export const notFound = (code: string, message: string) => new HttpError(404, code, message)
export const conflict = (code: string, message: string) => new HttpError(409, code, message)
export const unprocessable = (code: string, message: string, fields?: Record<string, string>) => new HttpError(422, code, message, fields)

/** Convierte un parámetro de ruta en entero positivo o lanza 400. */
export function idParam(value: unknown, name = 'id'): number {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id < 1) throw badRequest('INVALID_ID', `El parámetro ${name} debe ser un número válido`)
    return id
}

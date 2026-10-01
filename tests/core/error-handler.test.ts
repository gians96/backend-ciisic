import type { NextFunction, Request, Response } from 'express'
import { errorHandler } from '../../src/middlewares/errorHandler'
import { errorPdfOcupado } from '../../src/core/concurrencia'
import { HttpError } from '../../src/core/http-error'

/** Respuesta simulada que guarda estado, encabezados y cuerpo. */
function respuesta() {
    const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: undefined as unknown,
        status(codigo: number) {
            res.statusCode = codigo
            return res
        },
        setHeader(nombre: string, valor: string) {
            res.headers[nombre.toLowerCase()] = valor
            return res
        },
        json(cuerpo: unknown) {
            res.body = cuerpo
            return res
        },
    }
    return res
}

const manejar = (error: Error) => {
    const res = respuesta()
    errorHandler(error, {} as Request, res as unknown as Response, (() => undefined) as NextFunction)
    return res
}

describe('errorHandler', () => {
    it('503 PDF_BUSY lleva Retry-After y se registra como aviso (no como error interno)', () => {
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        const res = manejar(errorPdfOcupado())
        expect(res.statusCode).toBe(503)
        expect(res.headers['retry-after']).toBe('10')
        expect(res.body).toMatchObject({ success: false, code: 'PDF_BUSY' })
        expect(aviso).toHaveBeenCalledWith('Servicio no disponible: PDF_BUSY')
        expect(error).not.toHaveBeenCalled()
        aviso.mockRestore()
        error.mockRestore()
    })

    it('redondea hacia arriba la espera y no agrega Retry-After si el error no la trae', () => {
        expect(manejar(new HttpError(429, 'X', 'espera', undefined, 2.2)).headers['retry-after']).toBe('3')
        expect(manejar(new HttpError(409, 'Y', 'conflicto')).headers).not.toHaveProperty('retry-after')
    })

    it('un error inesperado sigue siendo 500 «Error interno» sin detalles', () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        const res = manejar(new TypeError('detalle con datos'))
        expect(res.statusCode).toBe(500)
        expect(res.body).toEqual({ success: false, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' })
        expect(error).toHaveBeenCalledWith('Error interno:', 'TypeError', 'detalle con datos')
        error.mockRestore()
    })
})

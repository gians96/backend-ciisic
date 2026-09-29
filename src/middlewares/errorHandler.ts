import { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { ValidationError } from 'yup'
import { HttpError } from '../core/http-error'
import { removeUploadedFile } from './upload'

interface AppError extends Error {
    status?: number
    statusCode?: number
    code?: string
    fields?: Record<string, string>
    type?: string
}

interface Normalizado {
    status: number
    code: string
    message: string
    fields?: Record<string, string>
}

function normalizar(err: AppError): Normalizado {
    if (err instanceof HttpError) return { status: err.status, code: err.code, message: err.message, fields: err.fields }

    if (err instanceof ValidationError) {
        const fields = Object.fromEntries((err.inner.length ? err.inner : [err]).map((item) => [item.path || 'body', item.message]))
        return { status: 422, code: 'VALIDATION_ERROR', message: 'Los datos enviados no son válidos', fields }
    }

    if (err.name === 'MulterError') {
        const multerCode = (err as AppError & { code?: string }).code
        if (multerCode === 'LIMIT_FILE_SIZE') return { status: 413, code: 'UPLOAD_LIMIT_EXCEEDED', message: 'El archivo supera el límite permitido' }
        return { status: 400, code: 'UPLOAD_INVALID', message: 'El archivo enviado no es válido' }
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') return { status: 409, code: 'DUPLICATE_RECORD', message: 'Ya existe un registro con estos datos.' }
        if (err.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'El registro solicitado no existe.' }
        if (err.code === 'P2003') return { status: 409, code: 'RELATED_RECORDS', message: 'La operación no es posible porque existen registros relacionados.' }
    }

    // JSON mal formado en el cuerpo
    if (err.type === 'entity.parse.failed') return { status: 400, code: 'BAD_REQUEST', message: 'El cuerpo de la solicitud no es JSON válido' }

    const status = err.statusCode || err.status || 500
    return {
        status,
        code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
        message: status >= 500 ? 'Error interno del servidor' : err.message,
        fields: err.fields,
    }
}

export function errorHandler(err: AppError, req: Request, res: Response, next: NextFunction) {
    void next
    removeUploadedFile(req.file)
    const { status, code, message, fields } = normalizar(err)
    if (status >= 500) console.error('Error interno:', err.name, err.message)
    res.status(status).json({ success: false, code, message, ...(fields ? { fields } : {}) })
}

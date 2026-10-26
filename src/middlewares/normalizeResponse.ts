import type { NextFunction, Request, Response } from 'express'

const statusCodes: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED',
}

export function normalizeErrorResponses(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res)
  res.json = ((body: unknown) => {
    if (res.statusCode < 400 || typeof body !== 'object' || body === null) return originalJson(body)
    const value = body as { code?: string; message?: string; error?: string; fields?: Record<string, string>; data?: unknown }
    return originalJson({
      success: false,
      code: value.code || statusCodes[res.statusCode] || 'INTERNAL_ERROR',
      message: value.message || value.error || (res.statusCode >= 500 ? 'Error interno del servidor' : 'Solicitud inválida'),
      ...(value.fields ? { fields: value.fields } : {}),
      // Datos que acompañan a un error de negocio (`HttpError.datos`, spec 037)
      ...(value.data !== undefined ? { data: value.data } : {}),
    })
  }) as typeof res.json
  next()
}

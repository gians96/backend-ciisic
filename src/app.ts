import express from 'express'
import morgan from 'morgan'
import cors from 'cors'
import helmet from 'helmet'
import { errorHandler } from './middlewares/errorHandler'
import { loadRoutes } from './loaders/routesLoader'
import { env } from '../config/env'
import { normalizeErrorResponses } from './middlewares/normalizeResponse'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
app.use(helmet())
app.use(normalizeErrorResponses)

if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// API abierta a cualquier origen (spec 009): la protege el token (JWT de sesión o token de
// acceso del evento), no una lista de orígenes. Sin cookies ni credenciales de navegador.
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
    exposedHeaders: ['Content-Disposition', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy'],
    maxAge: 600,
}))

loadRoutes(app)

app.use((_req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Ruta no encontrada' })
})

app.use(errorHandler)

export default app

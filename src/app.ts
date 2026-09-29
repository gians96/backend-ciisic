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

app.use(cors({
    origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true)
        return callback(Object.assign(new Error('Origen no permitido por CORS'), { status: 403, code: 'CORS_FORBIDDEN' }))
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}))

loadRoutes(app)

app.use((_req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Ruta no encontrada' })
})

app.use(errorHandler)

export default app

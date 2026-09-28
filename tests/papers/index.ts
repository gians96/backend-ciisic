import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { env } from '../../config/env'
import { prisma } from '../../src/database/prisma'
import paperRoutes from '../../src/api/papers/routes/papers'
import { papersDirectory } from '../../src/api/papers/services/papers'
import { errorHandler } from '../../src/middlewares/errorHandler'

jest.mock('../../src/database/prisma', () => ({
  prisma: { paperSubmission: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } },
}))
jest.mock('../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-paper-secret-at-least-32-characters',
    UPLOADS_DIR: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'ciisic-paper-test-')),
  },
}))

const app = express()
app.use('/api', paperRoutes)
app.use(errorHandler)
const author = { firstName: 'Ana', lastName: 'Pérez', university: 'UNDC' }
const payload = { title: 'Investigación de prueba', mainAuthor: author, coauthors: [] }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF')
const submit = (data: unknown, buffer = pdf, filename = 'paper.pdf', contentType = 'application/pdf') => request(app)
  .post('/api/v1/papers').field('data', JSON.stringify(data)).attach('file', buffer, { filename, contentType })
const adminToken = jwt.sign({ user: { id: 1, rolId: 2 } }, env.JWT_SECRET)

beforeEach(() => jest.clearAllMocks())
afterAll(() => {
  const target = path.resolve(env.UPLOADS_DIR)
  const temp = path.resolve(os.tmpdir())
  if (path.dirname(target) !== temp || !path.basename(target).startsWith('ciisic-paper-test-')) throw new Error('Unsafe test cleanup')
  fs.rmSync(target, { recursive: true, force: true })
})

describe('registro de papers', () => {
  it('guarda autores y PDF, devuelve recibo y restringe descarga a administradores', async () => {
    let saved: Record<string, unknown> = {}
    ;(prisma.paperSubmission.create as jest.Mock).mockImplementation(({ data }) => {
      saved = data
      return Promise.resolve({ id: data.id, createdAt: new Date() })
    })
    const result = await submit({ ...payload, coauthors: [{ ...author, university: 'Otra universidad' }] })
    expect(result.status).toBe(201)
    expect(result.body.data.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.body.data).not.toHaveProperty('filename')
    expect(saved.coauthors).toEqual([{ ...author, university: 'Otra universidad' }])
    expect(fs.readFileSync(path.join(papersDirectory, String(saved.filename)))).toEqual(pdf)
    const url = `/api/v1/papers/${result.body.data.id}/file`
    expect((await request(app).get(url)).status).toBe(401)
    ;(prisma.paperSubmission.findUnique as jest.Mock).mockResolvedValue(saved)
    const download = await request(app).get(url).set('Authorization', `Bearer ${adminToken}`)
    expect(download.status).toBe(200)
    expect(download.headers['content-disposition']).toContain('attachment')
    expect(download.body).toEqual(pdf)
  })

  it('rechaza un PDF que falta', async () => {
    const result = await request(app).post('/api/v1/papers').field('data', JSON.stringify(payload))
    expect(result.status).toBe(422)
  })
  it('rechaza contenido falsamente etiquetado como PDF', async () => {
    expect((await submit(payload, Buffer.from('not pdf'))).status).toBe(422)
    expect(prisma.paperSubmission.create).not.toHaveBeenCalled()
  })
  it('rechaza archivos que no son PDF', async () => {
    expect((await submit(payload, pdf, 'paper.png', 'image/png')).status).toBe(422)
  })
  it('rechaza archivos mayores a 5 MB', async () => {
    expect((await submit(payload, Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413)
  })
  it('rechaza más de tres coautores', async () => {
    expect((await submit({ ...payload, coauthors: Array(4).fill(author) })).status).toBe(422)
    expect(prisma.paperSubmission.create).not.toHaveBeenCalled()
  })
  it('rechaza datos vacíos y no crea registros', async () => {
    expect((await submit({ ...payload, mainAuthor: { ...author, university: '   ' } })).status).toBe(422)
    expect(prisma.paperSubmission.create).not.toHaveBeenCalled()
  })
  it('elimina el PDF si falla la base de datos y no devuelve éxito', async () => {
    const previous = fs.readdirSync(papersDirectory)
    ;(prisma.paperSubmission.create as jest.Mock).mockRejectedValue(new Error('DB unavailable'))
    const result = await submit(payload)
    expect(result.status).toBe(500)
    expect(result.body.message).not.toContain('DB unavailable')
    expect(fs.readdirSync(papersDirectory)).toEqual(previous)
  })
  it('protege el listado y permite su consulta administrativa', async () => {
    expect((await request(app).get('/api/v1/papers')).status).toBe(401)
    ;(prisma.paperSubmission.findMany as jest.Mock).mockResolvedValue([])
    const result = await request(app).get('/api/v1/papers').set('Authorization', `Bearer ${adminToken}`)
    expect(result.status).toBe(200)
    expect(result.body.data).toEqual([])
  })
})

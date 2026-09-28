import { randomUUID } from 'crypto'
import { mkdir, writeFile, unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '../../../database/prisma'
import { env } from '../../../../config/env'
import type { PaperInput } from '../validation'

export const papersDirectory = path.resolve(process.cwd(), env.UPLOADS_DIR, 'papers')

export async function createPaper(data: PaperInput, file: { buffer: Buffer; originalname: string; size: number }) {
  const id = randomUUID()
  const filename = `${id}.pdf`
  const destination = path.join(papersDirectory, filename)
  await mkdir(papersDirectory, { recursive: true })
  await writeFile(destination, file.buffer, { flag: 'wx' })
  try {
    return await prisma.paperSubmission.create({
      data: {
        id, title: data.title, mainAuthor: data.mainAuthor, coauthors: data.coauthors,
        filename, originalFilename: path.basename(file.originalname).slice(0, 255), size: file.size,
      },
      select: { id: true, createdAt: true },
    })
  } catch (error) {
    await unlink(destination).catch(() => undefined)
    throw error
  }
}

export function listPapers(page: number) {
  return prisma.paperSubmission.findMany({
    orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50,
    select: { id: true, title: true, mainAuthor: true, coauthors: true, originalFilename: true, size: true, createdAt: true },
  })
}

export function findPaper(id: string) {
  return prisma.paperSubmission.findUnique({ where: { id } })
}

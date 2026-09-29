import { randomUUID } from 'crypto'
import { mkdir, writeFile, unlink } from 'fs/promises'
import path from 'path'
import { prisma } from '../../../database/prisma'
import { env } from '../../../../config/env'
import type { PaperInput } from '../validation'

export const papersDirectory = path.resolve(process.cwd(), env.UPLOADS_DIR, 'papers')
export const PAPERS_POR_PAGINA = 50

export async function createPaper(eventoId: number, data: PaperInput, file: { buffer: Buffer; originalname: string; size: number }) {
    const id = randomUUID()
    const filename = `${id}.pdf`
    const destination = path.join(papersDirectory, filename)
    await mkdir(papersDirectory, { recursive: true })
    await writeFile(destination, file.buffer, { flag: 'wx' })
    try {
        const ponencia = await prisma.ponencia.create({
            data: {
                id,
                eventoId,
                titulo: data.title,
                autorPrincipal: data.mainAuthor,
                coautores: data.coauthors,
                archivo: filename,
                archivoOriginal: path.basename(file.originalname).slice(0, 255),
                tamanoBytes: file.size,
            },
            select: { id: true, creadoEn: true },
        })
        return { id: ponencia.id, creadoEn: ponencia.creadoEn, createdAt: ponencia.creadoEn }
    } catch (error) {
        await unlink(destination).catch(() => undefined)
        throw error
    }
}

export async function listPapers(eventoId: number, page: number) {
    const [total, ponencias] = await Promise.all([
        prisma.ponencia.count({ where: { eventoId } }),
        prisma.ponencia.findMany({
            where: { eventoId },
            orderBy: { creadoEn: 'desc' },
            skip: (page - 1) * PAPERS_POR_PAGINA,
            take: PAPERS_POR_PAGINA,
            select: { id: true, titulo: true, autorPrincipal: true, coautores: true, archivoOriginal: true, tamanoBytes: true, creadoEn: true },
        }),
    ])
    return { total, ponencias }
}

export function findPaper(id: string) {
    return prisma.ponencia.findUnique({ where: { id } })
}

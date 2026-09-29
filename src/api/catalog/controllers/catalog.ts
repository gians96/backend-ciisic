import { Request, Response } from 'express'
import { prisma } from '../../../database/prisma'
import { conflict, idParam, notFound } from '../../../core/http-error'

/**
 * Catálogos globales: clasificaciones, tipos de documento, estados de inscripción y roles.
 * Las lecturas son públicas (las usa la landing) salvo roles; responden arreglos simples
 * para mantener la forma anterior.
 */

// Clasificaciones (ciclos)
export async function listClassifications(_req: Request, res: Response) {
    res.json(await prisma.clasificacion.findMany({ orderBy: { id: 'asc' } }))
}

export async function findClassification(req: Request, res: Response) {
    const item = await prisma.clasificacion.findUnique({ where: { id: idParam(req.params.id) } })
    if (!item) throw notFound('CLASSIFICATION_NOT_FOUND', 'Clasificación no encontrada')
    res.json(item)
}

export async function createClassification(req: Request, res: Response) {
    res.status(201).json(await prisma.clasificacion.create({ data: { nombre: req.body.nombre } }))
}

export async function updateClassification(req: Request, res: Response) {
    const id = idParam(req.params.id)
    if (!await prisma.clasificacion.findUnique({ where: { id } })) throw notFound('CLASSIFICATION_NOT_FOUND', 'Clasificación no encontrada')
    res.json(await prisma.clasificacion.update({ where: { id }, data: { ...(req.body.nombre ? { nombre: req.body.nombre } : {}) } }))
}

export async function removeClassification(req: Request, res: Response) {
    const id = idParam(req.params.id)
    if (await prisma.inscripcion.count({ where: { clasificacionId: id } })) throw conflict('CLASSIFICATION_IN_USE', 'La clasificación está en uso.')
    await prisma.clasificacion.delete({ where: { id } })
    res.json({ success: true, data: null })
}

// Tipos de documento
export async function listDocumentTypes(_req: Request, res: Response) {
    res.json(await prisma.tipoDocumento.findMany({ orderBy: { id: 'asc' } }))
}

// Estados de inscripción
export async function listInscriptionStates(_req: Request, res: Response) {
    res.json(await prisma.estadoInscripcion.findMany({ orderBy: { id: 'asc' } }))
}

// Roles (solo SuperAdmin)
export async function listRoles(_req: Request, res: Response) {
    res.json({ success: true, data: await prisma.rol.findMany({ orderBy: { id: 'asc' } }) })
}

// API del sitio: catálogos que necesita el formulario de inscripción de la landing
export async function siteCatalogs(_req: Request, res: Response) {
    const [clasificaciones, tiposDocumento] = await Promise.all([
        prisma.clasificacion.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true } }),
        prisma.tipoDocumento.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true, abreviatura: true } }),
    ])
    res.json({ success: true, data: { clasificaciones, tiposDocumento } })
}

// Legacy: la landing anterior consulta estos catálogos al cargar; ya no existen en BD.
export function emptyList(_req: Request, res: Response) {
    res.json([])
}

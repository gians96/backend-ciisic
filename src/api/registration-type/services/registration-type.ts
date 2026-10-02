import { Prisma } from '@prisma/client'
import type { CategoriaInscripcion, TipoInscripcion } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound } from '../../../core/http-error'
import { aNumero, monto } from '../../../core/catalogos'
import { obtenerEventoPorId } from '../../event/services/public-event'
import type { ActualizarCategoriaInput, ActualizarTipoInput, CrearCategoriaInput, CrearTipoInput } from '../validation'

type Json = Prisma.InputJsonValue | typeof Prisma.JsonNull

const json = (value: unknown): Json => (value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue)

export function aTipo(tipo: TipoInscripcion, totalInscripciones?: number) {
    return {
        id: tipo.id,
        categoriaId: tipo.categoriaId,
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        etiqueta: tipo.etiqueta,
        descripcion: tipo.descripcion,
        caracteristicas: tipo.caracteristicas ?? null,
        precio: monto(tipo.precio),
        precioInstitucional: monto(tipo.precioInstitucional),
        disponiblePara: tipo.disponiblePara,
        activo: tipo.activo,
        orden: tipo.orden,
        ...(totalInscripciones !== undefined ? { totalInscripciones } : {}),
    }
}

export function aCategoria(categoria: CategoriaInscripcion) {
    return {
        id: categoria.id,
        eventoId: categoria.eventoId,
        codigo: categoria.codigo,
        nombre: categoria.nombre,
        descripcion: categoria.descripcion,
        caracteristicas: categoria.caracteristicas ?? null,
        precioDesde: aNumero(categoria.precioDesde),
        esEstudiantil: categoria.esEstudiantil,
        orden: categoria.orden,
    }
}

// ─── Público ────────────────────────────────────────────────────────────────

/** Categorías con tipos activos de un evento (landing). */
export async function tiposPublicos(eventoId: number, categoria?: string) {
    const categorias = await prisma.categoriaInscripcion.findMany({
        where: { eventoId, ...(categoria ? { codigo: categoria.toUpperCase() } : {}) },
        include: { tipos: { where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    })
    return categorias.map((cat) => ({
        codigo: cat.codigo,
        nombre: cat.nombre,
        descripcion: cat.descripcion,
        esEstudiantil: cat.esEstudiantil,
        precioDesde: aNumero(cat.precioDesde),
        caracteristicas: cat.caracteristicas ?? null,
        tipos: cat.tipos.map((tipo) => ({
            id: tipo.id,
            codigo: tipo.codigo,
            nombre: tipo.nombre,
            etiqueta: tipo.etiqueta,
            descripcion: tipo.descripcion,
            caracteristicas: tipo.caracteristicas ?? null,
            precio: monto(tipo.precio),
            precioInstitucional: monto(tipo.precioInstitucional),
            // Spec 016: la landing oculta el tipo a quien no corresponde (el backend igual lo rechaza)
            disponiblePara: tipo.disponiblePara,
        })),
    }))
}

/** Forma anterior de `GET /v1/registration-types` (landing actual). */
export function aTipoLegacy(tipo: TipoInscripcion) {
    return {
        id: tipo.id,
        nombre: tipo.nombre,
        precio: monto(tipo.precio),
        descripcion: tipo.descripcion,
        activo: tipo.activo,
        badge: tipo.etiqueta,
        caracteristicas: tipo.caracteristicas ?? null,
        value: tipo.codigo,
        institutionalPrice: monto(tipo.precioInstitucional),
        tipoPlanId: tipo.categoriaId,
    }
}

export async function tiposLegacy(eventoId: number) {
    const tipos = await prisma.tipoInscripcion.findMany({
        where: { categoria: { eventoId } },
        orderBy: [{ categoria: { orden: 'asc' } }, { orden: 'asc' }, { id: 'asc' }],
    })
    return tipos.map(aTipoLegacy)
}

export async function tipoLegacy(eventoId: number, id: number) {
    const tipo = await prisma.tipoInscripcion.findFirst({ where: { id, categoria: { eventoId } } })
    if (!tipo) throw notFound('REGISTRATION_TYPE_NOT_FOUND', `Tipo de inscripción con id ${id} no encontrado`)
    return aTipoLegacy(tipo)
}

// ─── Administración ─────────────────────────────────────────────────────────

/** Categorías y tipos del evento para el panel. Sin `conPago` los precios van en null (mismas claves). */
export async function categoriasDeEvento(eventoId: number, conPago = true) {
    await obtenerEventoPorId(eventoId)
    const [categorias, conteos] = await Promise.all([
        prisma.categoriaInscripcion.findMany({
            where: { eventoId },
            include: { tipos: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] } },
            orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        }),
        prisma.inscripcion.groupBy({ by: ['tipoInscripcionId'], where: { eventoId }, _count: { _all: true } }),
    ])
    const totalPorTipo = new Map(conteos.map((fila) => [fila.tipoInscripcionId, fila._count._all]))
    return categorias.map((categoria) => ({
        ...aCategoria(categoria),
        ...(conPago ? {} : { precioDesde: null }),
        tipos: categoria.tipos.map((tipo) => ({
            ...aTipo(tipo, totalPorTipo.get(tipo.id) ?? 0),
            ...(conPago ? {} : { precio: null, precioInstitucional: null }),
        })),
    }))
}

async function obtenerCategoria(id: number) {
    const categoria = await prisma.categoriaInscripcion.findUnique({ where: { id } })
    if (!categoria) throw notFound('CATEGORY_NOT_FOUND', 'La categoría no existe.')
    return categoria
}

async function verificarCodigoCategoria(eventoId: number, codigo: string, exceptoId?: number) {
    const existente = await prisma.categoriaInscripcion.findUnique({ where: { eventoId_codigo: { eventoId, codigo } } })
    if (existente && existente.id !== exceptoId) throw conflict('CATEGORY_CODE_TAKEN', `Ya existe la categoría "${codigo}" en este evento.`)
}

async function verificarCodigoTipo(categoriaId: number, codigo: string, exceptoId?: number) {
    const existente = await prisma.tipoInscripcion.findUnique({ where: { categoriaId_codigo: { categoriaId, codigo } } })
    if (existente && existente.id !== exceptoId) throw conflict('REGISTRATION_TYPE_CODE_TAKEN', `Ya existe el tipo "${codigo}" en esta categoría.`)
}

export async function crearCategoria(eventoId: number, input: CrearCategoriaInput) {
    await obtenerEventoPorId(eventoId)
    await verificarCodigoCategoria(eventoId, input.codigo)
    const categoria = await prisma.categoriaInscripcion.create({
        data: {
            eventoId,
            codigo: input.codigo,
            nombre: input.nombre,
            descripcion: input.descripcion ?? null,
            caracteristicas: json(input.caracteristicas ?? null),
            precioDesde: input.precioDesde ?? null,
            esEstudiantil: input.esEstudiantil ?? false,
            orden: input.orden ?? 0,
        },
    })
    return { ...aCategoria(categoria), tipos: [] }
}

export async function actualizarCategoria(id: number, input: ActualizarCategoriaInput) {
    const actual = await obtenerCategoria(id)
    if (input.codigo && input.codigo !== actual.codigo) await verificarCodigoCategoria(actual.eventoId, input.codigo, id)
    const data: Prisma.CategoriaInscripcionUpdateInput = {}
    if (input.codigo !== undefined) data.codigo = input.codigo
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.descripcion !== undefined) data.descripcion = input.descripcion
    if (input.caracteristicas !== undefined) data.caracteristicas = json(input.caracteristicas)
    if (input.precioDesde !== undefined) data.precioDesde = input.precioDesde
    if (input.esEstudiantil !== undefined) data.esEstudiantil = input.esEstudiantil
    if (input.orden !== undefined) data.orden = input.orden
    return aCategoria(await prisma.categoriaInscripcion.update({ where: { id }, data }))
}

export async function eliminarCategoria(id: number) {
    await obtenerCategoria(id)
    const tipos = await prisma.tipoInscripcion.count({ where: { categoriaId: id } })
    if (tipos) throw conflict('CATEGORY_IN_USE', 'La categoría tiene tipos de inscripción; elimínelos o muévalos primero.')
    await prisma.categoriaInscripcion.delete({ where: { id } })
}

export async function crearTipo(categoriaId: number, input: CrearTipoInput) {
    await obtenerCategoria(categoriaId)
    await verificarCodigoTipo(categoriaId, input.codigo)
    const tipo = await prisma.tipoInscripcion.create({
        data: {
            categoriaId,
            codigo: input.codigo,
            nombre: input.nombre,
            etiqueta: input.etiqueta ?? null,
            descripcion: input.descripcion ?? null,
            caracteristicas: json(input.caracteristicas ?? null),
            precio: input.precio,
            precioInstitucional: input.precioInstitucional,
            disponiblePara: input.disponiblePara ?? 'TODOS',
            activo: input.activo ?? true,
            orden: input.orden ?? 0,
        },
    })
    return aTipo(tipo, 0)
}

export async function actualizarTipo(id: number, input: ActualizarTipoInput) {
    const actual = await prisma.tipoInscripcion.findUnique({ where: { id } })
    if (!actual) throw notFound('REGISTRATION_TYPE_NOT_FOUND', 'El tipo de inscripción no existe.')
    if (input.codigo && input.codigo !== actual.codigo) await verificarCodigoTipo(actual.categoriaId, input.codigo, id)
    const precio = input.precio ?? monto(actual.precio)
    const precioInstitucional = input.precioInstitucional ?? monto(actual.precioInstitucional)
    if (precioInstitucional > precio) throw conflict('INVALID_PRICES', 'El precio institucional no puede ser mayor que el precio regular.')
    const data: Prisma.TipoInscripcionUpdateInput = {}
    if (input.codigo !== undefined) data.codigo = input.codigo
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.etiqueta !== undefined) data.etiqueta = input.etiqueta
    if (input.descripcion !== undefined) data.descripcion = input.descripcion
    if (input.caracteristicas !== undefined) data.caracteristicas = json(input.caracteristicas)
    if (input.precio !== undefined) data.precio = input.precio
    if (input.precioInstitucional !== undefined) data.precioInstitucional = input.precioInstitucional
    if (input.disponiblePara !== undefined) data.disponiblePara = input.disponiblePara
    if (input.activo !== undefined) data.activo = input.activo
    if (input.orden !== undefined) data.orden = input.orden
    const tipo = await prisma.tipoInscripcion.update({ where: { id }, data })
    return aTipo(tipo, await prisma.inscripcion.count({ where: { tipoInscripcionId: id } }))
}

export async function eliminarTipo(id: number) {
    const tipo = await prisma.tipoInscripcion.findUnique({ where: { id } })
    if (!tipo) throw notFound('REGISTRATION_TYPE_NOT_FOUND', 'El tipo de inscripción no existe.')
    const usos = await prisma.inscripcion.count({ where: { tipoInscripcionId: id } })
    if (usos) throw conflict('REGISTRATION_TYPE_IN_USE', 'El tipo tiene inscripciones; desactívelo en lugar de eliminarlo.')
    await prisma.tipoInscripcion.delete({ where: { id } })
}

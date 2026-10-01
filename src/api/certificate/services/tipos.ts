import { Prisma, type TipoCertificado } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, notFound, unprocessable } from '../../../core/http-error'
import type { ActualizarTipoInput, CrearTipoInput } from '../validation/tipos'

/**
 * Tipos de certificado (spec 015): catálogo global. La migración siembra PARTICIPANTE, ORGANIZADOR
 * y PONENTE; el administrador agrega otros. El código no cambia (lo usan la emisión y las listas) y
 * no se borran: se desactivan (`activo = false`), y un tipo inactivo ya no se puede emitir.
 */
export function aTipo(tipo: TipoCertificado) {
    return {
        id: tipo.id,
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        textoImpreso: tipo.textoImpreso,
        activo: tipo.activo,
        orden: tipo.orden,
    }
}

export type TipoPublico = ReturnType<typeof aTipo>

export async function listarTipos(filtro: { activo?: boolean } = {}): Promise<TipoPublico[]> {
    const tipos = await prisma.tipoCertificado.findMany({
        where: filtro.activo === undefined ? {} : { activo: filtro.activo },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    })
    return tipos.map(aTipo)
}

const tipoNoEncontrado = () => notFound('CERTIFICATE_TYPE_NOT_FOUND', 'El tipo de certificado no existe.')

async function obtenerTipo(id: number): Promise<TipoCertificado> {
    const tipo = await prisma.tipoCertificado.findUnique({ where: { id } })
    if (!tipo) throw tipoNoEncontrado()
    return tipo
}

/** Tipo por código (vista previa, emisión). `null` si no existe. */
export async function tipoPorCodigo(codigo: string): Promise<TipoCertificado | null> {
    return prisma.tipoCertificado.findUnique({ where: { codigo: codigo.trim().toUpperCase() } })
}

const codigoRepetido = (codigo: string) => conflict('DUPLICATE_RECORD', `Ya existe un tipo de certificado con el código ${codigo}.`)

export async function crearTipo(input: CrearTipoInput, adminId?: number): Promise<TipoPublico> {
    const codigo = input.codigo
    try {
        const tipo = await prisma.tipoCertificado.create({
            data: {
                codigo,
                nombre: input.nombre,
                textoImpreso: input.textoImpreso || input.nombre.toLocaleUpperCase('es'),
                activo: input.activo ?? true,
                orden: input.orden ?? 0,
            },
        })
        console.log(`Tipo de certificado ${tipo.id} (${tipo.codigo}) creado por el administrador ${adminId ?? '?'}`)
        return aTipo(tipo)
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw codigoRepetido(codigo)
        throw error
    }
}

export async function actualizarTipo(id: number, input: ActualizarTipoInput, adminId?: number): Promise<TipoPublico> {
    const actual = await obtenerTipo(id)
    if (input.codigo !== undefined && input.codigo !== actual.codigo) {
        throw unprocessable('CERTIFICATE_TYPE_CODE_LOCKED', 'El código de un tipo no se puede cambiar: crea otro tipo y desactiva este.', { codigo: 'El código no se puede cambiar' })
    }
    const data: Prisma.TipoCertificadoUpdateInput = {}
    if (input.nombre !== undefined) data.nombre = input.nombre
    if (input.textoImpreso !== undefined) data.textoImpreso = input.textoImpreso
    if (input.activo !== undefined) data.activo = input.activo
    if (input.orden !== undefined) data.orden = input.orden
    if (!Object.keys(data).length) return aTipo(actual)

    try {
        const tipo = await prisma.tipoCertificado.update({ where: { id }, data })
        console.log(`Tipo de certificado ${id} (${tipo.codigo}) actualizado por el administrador ${adminId ?? '?'}: ${Object.keys(data).join(', ')}`)
        return aTipo(tipo)
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw tipoNoEncontrado()
        throw error
    }
}

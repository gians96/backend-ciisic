import { prisma } from '../database/prisma'

/**
 * Consulta de la cuenta de staff con todo lo que decide su acceso (spec 013). Está aislada en su
 * propio módulo para que las pruebas la simulen sin tocar el resto de `prisma`.
 */
export async function consultarActor(id: number) {
    return prisma.administrador.findUnique({
        where: { id },
        include: {
            rol: true,
            asignacionesEvento: { select: { eventoId: true } },
            permisos: { select: { permiso: true } },
        },
    })
}

export type FilaActor = NonNullable<Awaited<ReturnType<typeof consultarActor>>>

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

/** Crea el SuperAdmin inicial si no existe (no modifica uno existente). */
async function bootstrapAdmin() {
    const correo = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
    const contrasena = process.env.BOOTSTRAP_ADMIN_PASSWORD
    if (!correo || !contrasena || contrasena.length < 12) {
        throw new Error('BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD (mínimo 12 caracteres) son obligatorios')
    }

    const existing = await prisma.administrador.findUnique({ where: { correo } })
    if (existing) {
        console.log('El administrador inicial ya existe; no se modificó su contraseña.')
        return
    }

    const rol = await prisma.rol.findUnique({ where: { codigo: 'SUPERADMIN' } })
    if (!rol) throw new Error('No existe el rol SUPERADMIN; ejecute primero las migraciones y los seeds')

    await prisma.administrador.create({
        data: {
            nombres: process.env.BOOTSTRAP_ADMIN_NAMES || 'Administrador',
            apellidos: process.env.BOOTSTRAP_ADMIN_SURNAMES || 'CIISIC',
            correo,
            contrasenaHash: await bcrypt.hash(contrasena, 12),
            rolId: rol.id,
        },
    })
    console.log('Administrador inicial creado correctamente.')
}

bootstrapAdmin().catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudo crear el administrador inicial')
    process.exitCode = 1
}).finally(() => prisma.$disconnect())

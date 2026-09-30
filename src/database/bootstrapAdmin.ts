import 'dotenv/config'
import crypto from 'crypto'
import { parseArgs } from 'util'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { ROL } from '../core/catalogos'

/**
 * Crea el Owner inicial si no existe (no modifica uno existente). Se ejecuta una sola vez:
 *   npm run bootstrap:admin -- --correo admin@undc.edu.pe --nombres "Nombre" --apellidos "Apellidos"
 * La contraseña temporal se genera y se muestra una única vez; luego se puede entrar con Google
 * (si el correo es de Google) o cambiarla en Equipo y administradores.
 */
function argumentos() {
    const { values } = parseArgs({
        options: {
            correo: { type: 'string' },
            nombres: { type: 'string', default: 'Administrador' },
            apellidos: { type: 'string', default: 'CIISIC' },
        },
        allowPositionals: false,
    })
    const correo = values.correo?.trim().toLowerCase()
    if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        throw new Error('Uso: npm run bootstrap:admin -- --correo admin@undc.edu.pe [--nombres "…"] [--apellidos "…"]')
    }
    return { correo, nombres: values.nombres?.trim() || 'Administrador', apellidos: values.apellidos?.trim() || 'CIISIC' }
}

async function bootstrapAdmin() {
    const { correo, nombres, apellidos } = argumentos()

    const existing = await prisma.administrador.findUnique({ where: { correo } })
    if (existing) {
        console.log('El administrador ya existe; no se modificó.')
        return
    }

    const rol = await prisma.rol.findUnique({ where: { codigo: ROL.OWNER } })
    if (!rol) throw new Error('No existe el rol Owner; ejecute primero las migraciones y los seeds')

    const contrasena = crypto.randomBytes(18).toString('base64url')
    await prisma.administrador.create({
        data: { nombres, apellidos, correo, contrasenaHash: await bcrypt.hash(contrasena, 12), rolId: rol.id },
    })
    console.log(`Owner ${correo} creado. Contraseña temporal (se muestra una sola vez): ${contrasena}`)
}

bootstrapAdmin().catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudo crear el Owner inicial')
    process.exitCode = 1
}).finally(() => prisma.$disconnect())

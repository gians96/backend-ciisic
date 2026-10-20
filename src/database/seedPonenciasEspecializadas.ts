import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { parseArgs } from 'util'
import * as yup from 'yup'
import { prisma } from './prisma'
import { aColumnaFecha, instanteLima } from '../core/fechas'
import { crearPonencia } from '../api/specialized-talk/services/talks'
import { crearPonenciaSchema } from '../api/specialized-talk/validation'

/**
 * Carga las ponencias especializadas de un evento desde un JSON (por defecto, las del VIII CIISIC en
 * `prisma/datos/ponencias-especializadas-2026.json`). Idempotente: solo crea las que faltan (misma
 * fecha, hora de inicio y ambiente) y nunca modifica ni borra las que ya existen.
 *   npm run seed:ponencias-especializadas -- --evento ciisic-viii [--archivo ruta.json]
 */
const ARCHIVO_POR_DEFECTO = 'prisma/datos/ponencias-especializadas-2026.json'

function argumentos() {
    const { values } = parseArgs({
        options: { evento: { type: 'string' }, archivo: { type: 'string', default: ARCHIVO_POR_DEFECTO } },
        allowPositionals: false,
    })
    const evento = values.evento?.trim()
    if (!evento) throw new Error('Uso: npm run seed:ponencias-especializadas -- --evento <código del evento> [--archivo ruta.json]')
    return { evento, archivo: path.resolve(process.cwd(), values.archivo ?? ARCHIVO_POR_DEFECTO) }
}

async function seedPonenciasEspecializadas() {
    const { evento: codigo, archivo } = argumentos()
    const evento = await prisma.evento.findUnique({ where: { codigo } })
    if (!evento) throw new Error(`No existe el evento «${codigo}»`)

    const contenido = JSON.parse(fs.readFileSync(archivo, 'utf8')) as { ponencias?: unknown[] }
    const ponencias = await yup.array().of(crearPonenciaSchema).required().validate(contenido.ponencias, { abortEarly: false })

    let creadas = 0
    for (const ponencia of ponencias) {
        const existente = await prisma.ponenciaEspecializada.findFirst({
            where: { eventoId: evento.id, fecha: aColumnaFecha(ponencia.fecha), horaInicio: instanteLima(ponencia.fecha, ponencia.horaInicio), ambiente: ponencia.ambiente },
            select: { id: true },
        })
        if (existente) continue
        await crearPonencia(evento.id, ponencia)
        creadas++
    }
    console.log(`✅ Ponencias especializadas de ${evento.nombreCorto}: ${creadas} creadas, ${ponencias.length - creadas} ya existían`)
}

seedPonenciasEspecializadas().catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudieron cargar las ponencias especializadas')
    process.exitCode = 1
}).finally(() => prisma.$disconnect())

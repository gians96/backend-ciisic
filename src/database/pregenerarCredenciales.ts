import 'dotenv/config'
import { parseArgs } from 'util'
import { prisma } from './prisma'
import { archivoCredencial } from '../api/inscription/services/inscription'

/**
 * Genera, de una en una, las credenciales PDF de las inscripciones aprobadas de un evento (spec 014).
 * Al desplegar la 014 los PDF guardados cambian de nombre (`<id>-<huella>.pdf`, con el QR nuevo) y se
 * regeneran al pedirlos: correr esto fuera de horario evita que el día del evento cada primera
 * descarga o reenvío abra un navegador (2 a la vez y 30 en cola; si no, 503 PDF_BUSY). Los que ya
 * están al día se reutilizan, así que se puede repetir.
 *   npm run credenciales:pregenerar -- --evento ciisic-viii-2026
 * En la imagen: node dist/src/database/pregenerarCredenciales.js --evento ciisic-viii-2026
 * Solo registra ids y conteos (nunca datos de las personas).
 */
function argumentos(): string {
    const { values } = parseArgs({ options: { evento: { type: 'string' } }, allowPositionals: false })
    const codigo = values.evento?.trim()
    if (!codigo) throw new Error('Uso: npm run credenciales:pregenerar -- --evento <código del evento>')
    return codigo
}

async function pregenerar() {
    const codigo = argumentos()
    const evento = await prisma.evento.findUnique({ where: { codigo }, select: { id: true } })
    if (!evento) throw new Error(`No existe el evento ${codigo}`)
    const aprobadas = await prisma.inscripcion.findMany({
        where: { eventoId: evento.id, estado: { codigo: 'APROBADO' } },
        select: { id: true },
        orderBy: { id: 'asc' },
    })
    const fallidas: number[] = []
    for (const [indice, { id }] of aprobadas.entries()) {
        try {
            await archivoCredencial(id)
        } catch {
            fallidas.push(id)
        }
        if ((indice + 1) % 25 === 0) console.log(`${indice + 1}/${aprobadas.length} credenciales revisadas`)
    }
    console.log(`Listo: ${aprobadas.length - fallidas.length} de ${aprobadas.length} credenciales al día.`)
    if (fallidas.length) {
        console.error(`No se pudieron generar las de las inscripciones ${fallidas.join(', ')}; vuelve a ejecutarlo.`)
        process.exitCode = 1
    }
}

pregenerar().catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudieron pregenerar las credenciales')
    process.exitCode = 1
}).finally(() => prisma.$disconnect())

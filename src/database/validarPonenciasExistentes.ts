import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { parseArgs } from 'util'
import type { ModalidadAsistencia } from '@prisma/client'
import { prisma } from './prisma'
import { resolverElegibilidad, variantesDocumento, type MotivoSinAcceso } from '../core/ponencias-especializadas'
import { enmascararDocumento } from '../api/activity/services/activity'

/**
 * Valida las inscripciones a ponencias especializadas hechas antes de exigir el pago del congreso
 * (spec 030). Empareja a cada persona inscrita **sin validar** con su inscripción al congreso por el
 * documento (en el DNI también prueba sin los ceros a la izquierda, que Excel suele perder). Si el pago está
 * aprobado, sella la inscripción con esa inscripción y su modo (virtual = sin aforo); las demás quedan «Sin
 * validar» y se listan con el motivo, para que el staff las contacte o las cancele desde el panel.
 *
 * Por defecto solo simula. Idempotente: no toca lo ya validado ni cancela a nadie.
 *   npm run ponencias-especializadas:validar-existentes -- --evento ciisic-viii [--aplicar] [--csv ruta.csv]
 *
 * `--csv` guarda el contacto completo de quienes no se pudieron validar (dato personal: no lo subas al repo).
 */
function argumentos() {
    const { values } = parseArgs({
        options: { evento: { type: 'string' }, aplicar: { type: 'boolean', default: false }, csv: { type: 'string' } },
        allowPositionals: false,
    })
    const evento = values.evento?.trim()
    if (!evento) throw new Error('Uso: npm run ponencias-especializadas:validar-existentes -- --evento <código del evento> [--aplicar] [--csv ruta.csv]')
    return { evento, aplicar: values.aplicar === true, csv: values.csv ? path.resolve(process.cwd(), values.csv) : null }
}

const TEXTO_MOTIVO: Record<MotivoSinAcceso, string> = {
    NO_ENCONTRADA: 'no está inscrito al congreso',
    PAGO_PENDIENTE: 'pago pendiente o en revisión',
    RECHAZADA: 'inscripción rechazada o cancelada',
}

/** Para que Excel abra el CSV en UTF-8. */
const BOM = String.fromCharCode(0xfeff)
const celdaCsv = (valor: string | null) => `"${(valor ?? '').replace(/"/g, '""')}"`

async function validarPonenciasExistentes() {
    const { evento: codigo, aplicar, csv } = argumentos()
    const evento = await prisma.evento.findUnique({ where: { codigo } })
    if (!evento) throw new Error(`No existe el evento «${codigo}»`)

    const filas = await prisma.inscripcionPonencia.findMany({
        where: { estado: 'INSCRITO', inscripcionCongresoId: null, ponencia: { eventoId: evento.id } },
        select: {
            id: true,
            asistenteId: true,
            ponencia: { select: { tema: true } },
            asistente: { select: { tipoDocumentoId: true, numeroDocumento: true, nombres: true, apellidos: true, correo: true, celular: true } },
        },
        orderBy: { id: 'asc' },
    })

    const porAsistente = new Map<number, typeof filas>()
    for (const fila of filas) porAsistente.set(fila.asistenteId, [...(porAsistente.get(fila.asistenteId) ?? []), fila])

    const validables: { asistenteId: number, inscripcionCongresoId: number, modo: ModalidadAsistencia, inscripciones: number }[] = []
    const sinValidar: { documento: string, enmascarado: string, nombre: string, motivo: MotivoSinAcceso, ponencias: string[], correo: string | null, celular: string | null }[] = []

    for (const [asistenteId, delAsistente] of porAsistente) {
        const { asistente } = delAsistente[0]
        const inscripciones = (await Promise.all(variantesDocumento(asistente.tipoDocumentoId, asistente.numeroDocumento).map((numero) =>
            prisma.participante.findUnique({
                where: { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: asistente.tipoDocumentoId, numeroDocumento: numero } },
                select: { inscripciones: { where: { eventoId: evento.id }, take: 1, select: { id: true, estado: { select: { codigo: true } }, tipoInscripcion: { select: { modalidad: true } } } } },
            }),
        ))).flatMap((participante) => participante?.inscripciones ?? [])
        // Si hubiera más de una coincidencia, la aprobada gana
        const elegida = inscripciones.find((i) => i.estado.codigo === 'APROBADO') ?? inscripciones[0] ?? null
        const veredicto = resolverElegibilidad(elegida ? { estado: elegida.estado.codigo, modalidadTipo: elegida.tipoInscripcion?.modalidad } : null)
        if (veredicto.ok && elegida) {
            validables.push({ asistenteId, inscripcionCongresoId: elegida.id, modo: veredicto.modo, inscripciones: delAsistente.length })
        } else if (!veredicto.ok) {
            sinValidar.push({
                documento: `${asistente.tipoDocumentoId.toUpperCase()} ${asistente.numeroDocumento}`,
                enmascarado: `${asistente.tipoDocumentoId.toUpperCase()} ${enmascararDocumento(asistente.numeroDocumento)}`,
                nombre: `${asistente.nombres} ${asistente.apellidos}`.trim(),
                motivo: veredicto.motivo,
                ponencias: delAsistente.map((f) => f.ponencia.tema),
                correo: asistente.correo,
                celular: asistente.celular,
            })
        }
    }

    if (aplicar) {
        for (const v of validables) {
            await prisma.inscripcionPonencia.updateMany({
                where: { asistenteId: v.asistenteId, estado: 'INSCRITO', inscripcionCongresoId: null, ponencia: { eventoId: evento.id } },
                data: { inscripcionCongresoId: v.inscripcionCongresoId, modoAsistencia: v.modo },
            })
        }
    }

    const virtuales = validables.filter((v) => v.modo === 'VIRTUAL')
    console.log(`${aplicar ? '✅ Aplicado' : '🔎 Simulación (no se escribió nada; usa --aplicar)'} — ${evento.nombreCorto}`)
    console.log(`  Personas con inscripciones sin validar: ${porAsistente.size} (${filas.length} inscripciones)`)
    console.log(`  Se validan (pago aprobado): ${validables.length} personas, ${validables.reduce((n, v) => n + v.inscripciones, 0)} inscripciones — ${virtuales.length} personas son virtuales y liberan su aforo`)
    console.log(`  Quedan sin validar: ${sinValidar.length} personas`)
    for (const motivo of Object.keys(TEXTO_MOTIVO) as MotivoSinAcceso[]) {
        const grupo = sinValidar.filter((p) => p.motivo === motivo)
        if (!grupo.length) continue
        console.log(`\n  ${TEXTO_MOTIVO[motivo]} (${grupo.length}):`)
        for (const p of grupo) console.log(`    ${p.enmascarado} · ${p.nombre} · ${p.ponencias.length} ponencia(s)`)
    }

    if (csv && sinValidar.length) {
        const encabezado = ['documento', 'nombre', 'motivo', 'correo', 'celular', 'ponencias']
        const lineas = sinValidar.map((p) => [p.documento, p.nombre, TEXTO_MOTIVO[p.motivo], p.correo, p.celular, p.ponencias.join(' | ')].map(celdaCsv).join(','))
        fs.writeFileSync(csv, `${BOM}${encabezado.join(',')}\n${lineas.join('\n')}\n`, 'utf8')
        console.log(`\n  Contacto de los ${sinValidar.length} sin validar guardado en ${csv} (dato personal: no lo subas al repositorio)`)
    }
}

validarPonenciasExistentes().catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudieron validar las inscripciones a ponencias')
    process.exitCode = 1
}).finally(() => prisma.$disconnect())

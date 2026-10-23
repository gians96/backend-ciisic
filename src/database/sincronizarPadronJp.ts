import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { parseArgs } from 'util'
import { createConnection, type RowDataPacket } from 'mysql2/promise'
import { prisma } from './prisma'
import { leerDesignacion, planearAsesores, type AsesorExistente } from '../api/advisory/services/designacion'
import { guardarPadron, type EstudiantePadron } from '../api/advisory/services/importacion'
import { consolidarPadron, type MatriculaJp } from '../api/advisory/services/matriculas-jp'
import { claveSeccion, etiquetaSeccion } from '../api/advisory/services/seguimiento'

/**
 * Reparte a los estudiantes del padrón de seguimiento en las secciones en que cursan según JP (programación académica,
 * sincronizada con SIVIRENO) y deja a cada docente con su DNI y los grupos de la designación de asesores (spec 033).
 *
 * - Los estudiantes son **los del padrón actual** (todos son de la matrícula del semestre y se quedan); JP solo dice en qué secciones
 *   cursa cada uno, por código de estudiante. Quien no tenga matrícula en JP conserva su sección anterior.
 * - JP se lee **solo con SELECT** (la sesión se abre en solo lectura) desde `JP_DATABASE_URL`, una variable de esta consola y no del API.
 * - La designación (grupos, docentes y DNI) viene de un JSON fuera del repositorio: ver `services/designacion.ts`.
 * - Por defecto solo simula. `--aplicar` reemplaza el padrón y las secciones y actualiza a los docentes (DNI y grupos) en una transacción,
 *   conservando el enlace de cada docente; los docentes que no están en la designación no se tocan.
 *
 *   JP_DATABASE_URL=mysql://usuario:clave@host:3306/jp \
 *   npm run padron:desde-jp:dev -- --evento ciisic-viii --asesores ruta/asesores.json [--semestre 2026-2] [--carrera IS] [--aplicar] [--csv ruta.csv]
 *
 * `--csv` guarda quién quedó fuera de JP (dato personal: no lo subas al repositorio). Antes de aplicar en producción, respaldo con `mysqldump`.
 */
function argumentos() {
    const { values } = parseArgs({
        options: {
            evento: { type: 'string' },
            asesores: { type: 'string' },
            semestre: { type: 'string' },
            carrera: { type: 'string', default: 'IS' },
            aplicar: { type: 'boolean', default: false },
            csv: { type: 'string' },
        },
        allowPositionals: false,
    })
    const evento = values.evento?.trim()
    const asesores = values.asesores?.trim()
    if (!evento || !asesores) {
        throw new Error('Uso: npm run padron:desde-jp:dev -- --evento <código del evento> --asesores <designacion.json> [--semestre 2026-2] [--carrera IS] [--aplicar] [--csv ruta.csv]')
    }
    return {
        evento,
        asesores: path.resolve(process.cwd(), asesores),
        semestre: values.semestre?.trim() || null,
        carrera: (values.carrera ?? 'IS').trim().toUpperCase(),
        aplicar: values.aplicar === true,
        csv: values.csv ? path.resolve(process.cwd(), values.csv) : null,
    }
}

interface FilaJp extends RowDataPacket {
    codigo: string
    correo: string | null
    nombre: string
    ciclo: string
    turno: string | null
    seccion: string
}

/** Matrículas vigentes (de la carrera y el semestre) de JP: una por alumno y curso. Solo `SELECT`, en una sesión de solo lectura. */
async function leerMatriculasJp(carrera: string, semestre: string): Promise<{ matriculas: MatriculaJp[], nombres: Map<string, string> }> {
    const url = process.env.JP_DATABASE_URL?.trim()
    if (!url) throw new Error('Define JP_DATABASE_URL (mysql://usuario:clave@host:3306/jp) en esta consola; no se guarda en ningún archivo.')
    const conexion = await createConnection({ uri: url, charset: 'utf8mb4' })
    try {
        await conexion.query('SET SESSION TRANSACTION READ ONLY')
        const [filas] = await conexion.query<FilaJp[]>(
            `SELECT m.codigo_estudiante AS codigo, m.email AS correo, m.nombre_completo AS nombre, c.ciclo, c.turno, c.seccion
               FROM sivireno_matricula m
               JOIN sivireno_carga_lectiva c ON c.id_carga_lectiva = m.id_carga_lectiva
               JOIN sivireno_carrera k ON k.id_carrera = c.id_carrera
              WHERE k.abreviatura_carrera = ? AND c.nombre_semestre = ? AND c.remoto_activo = 1 AND m.remoto_activo = 1`,
            [carrera, semestre],
        )
        const nombres = new Map(filas.map((f) => [f.codigo.trim().toUpperCase(), f.nombre]))
        return { matriculas: filas.map((f) => ({ codigo: f.codigo, correo: f.correo, ciclo: f.ciclo, turno: f.turno, seccion: f.seccion })), nombres }
    } finally {
        await conexion.end()
    }
}

/** Para que Excel abra el CSV en UTF-8. */
const BOM = String.fromCharCode(0xfeff)
const celdaCsv = (valor: string | null) => `"${(valor ?? '').replace(/"/g, '""')}"`

async function sincronizarPadronJp() {
    const { evento: codigo, asesores: rutaAsesores, semestre: semestrePedido, carrera, aplicar, csv } = argumentos()
    const designacion = leerDesignacion(JSON.parse(fs.readFileSync(rutaAsesores, 'utf8')))

    const evento = await prisma.evento.findUnique({ where: { codigo } })
    if (!evento) throw new Error(`No existe el evento «${codigo}»`)

    const filasPadron = await prisma.padronEstudiante.findMany({ where: { eventoId: evento.id }, orderBy: { id: 'asc' } })
    if (!filasPadron.length) throw new Error('El evento no tiene padrón: cárgalo primero con el Excel de la facultad.')
    const semestre = semestrePedido ?? filasPadron[0].semestre
    const padron: EstudiantePadron[] = filasPadron.map(({ documento, codigo: cod, correo, nombre, celular, carrera: carr, ciclo, turno, seccion, distrito, provincia, departamento }) => ({
        documento, codigo: cod, correo, nombre, celular, carrera: carr, ciclo, turno, seccion, distrito, provincia, departamento, secciones: [],
    }))

    const { matriculas, nombres } = await leerMatriculasJp(carrera, semestre)
    if (!matriculas.length) throw new Error(`JP no tiene matrículas de la carrera ${carrera} en ${semestre}.`)
    const consolidado = consolidarPadron(padron, matriculas, designacion.grupos)

    const existentes: AsesorExistente[] = (await prisma.asesor.findMany({ where: { eventoId: evento.id }, include: { secciones: true } }))
        .map((a) => ({ id: a.id, nombre: a.nombre, documento: a.documento, secciones: a.secciones.map(({ ciclo, seccion }) => ({ ciclo, seccion })) }))
    const plan = planearAsesores(designacion, existentes)

    const conAsesor = new Set(designacion.grupos.map((g) => claveSeccion(g.ciclo, g.seccion)))
    const sinAsesor = consolidado.estudiantes.filter((e) => !e.secciones.some((s) => conAsesor.has(claveSeccion(s.ciclo, s.seccion))))
    const conDni = plan.cambios.filter((c) => c.designado.documento !== null).length

    console.log(`${aplicar ? '⏳ Aplicando' : '🔎 Simulación (no se escribe nada; usa --aplicar)'} — ${evento.nombreCorto} · ${carrera} ${semestre}`)
    console.log(`  Matrículas de JP: ${matriculas.length} (${new Set(matriculas.map((m) => m.codigo.trim().toUpperCase())).size} alumnos)`)
    console.log(`  Estudiantes del padrón (se quedan todos): ${consolidado.estudiantes.length}`)
    console.log(`    con sus secciones de JP: ${consolidado.estudiantes.length - consolidado.sinMatriculaEnJp.length}`)
    console.log(`    sin matrícula en JP (conservan su sección anterior): ${consolidado.sinMatriculaEnJp.length}`)
    console.log(`    en más de un grupo: ${consolidado.enVariosGrupos}`)
    console.log(`    con alguna sección de JP sin grupo de asesoría: ${consolidado.conSeccionSinGrupo.length}`)
    console.log(`    sin ningún asesor: ${sinAsesor.length}`)
    console.log(`  Alumnos de JP que no están en el padrón (no se agregan): ${consolidado.soloEnJp.length}`)
    console.log('\n  Alumnos por grupo (uno cuenta en cada grupo en que cursa):')
    for (const g of consolidado.porGrupo) {
        const asesoresDelGrupo = designacion.asesores.filter((a) => a.grupos.some((x) => claveSeccion(x.ciclo, x.seccion) === claveSeccion(g.ciclo, g.seccion))).length
        console.log(`    ${etiquetaSeccion(g.ciclo, g.seccion).padEnd(8)} ${String(g.alumnos).padStart(4)} alumnos · ${asesoresDelGrupo} asesor(es)${asesoresDelGrupo ? '' : ' ← SIN ASESOR'}`)
    }
    for (const s of consolidado.conSeccionSinGrupo.slice(0, 10)) console.log(`    ⚠ sección sin grupo: ${s.secciones.join(', ')} (${s.codigo})`)

    console.log(`\n  Asesores de la designación: ${plan.cambios.length} · con DNI: ${conDni}`)
    console.log(`    nuevos: ${plan.cambios.filter((c) => !c.existente).length}`)
    console.log(`    con DNI por asignar o cambiar: ${plan.cambios.filter((c) => c.cambiaDocumento).length}`)
    console.log(`    con secciones distintas a las de hoy: ${plan.cambios.filter((c) => c.cambiaSecciones).length}`)
    console.log(`    que no están en la designación (no se tocan): ${plan.noDesignados.length}${plan.noDesignados.length ? ` — ${plan.noDesignados.map((a) => a.nombre).join('; ')}` : ''}`)
    for (const c of plan.cambios.filter((x) => x.cambiaSecciones)) {
        console.log(`    ${c.designado.nombre}: ${c.seccionesAntes.join(' ') || '(nuevo)'} → ${c.seccionesDespues.join(' ')}`)
    }
    for (const conflicto of plan.conflictos) console.error(`  ✗ ${conflicto}`)

    if (csv) {
        const nombrePadron = new Map(consolidado.estudiantes.map((e) => [e.codigo, e]))
        const lineas = [
            ...consolidado.sinMatriculaEnJp.map((c) => ['SIN_MATRICULA_EN_JP', c, nombrePadron.get(c)?.nombre ?? '', `${nombrePadron.get(c)?.ciclo ?? ''}-${nombrePadron.get(c)?.seccion ?? ''}`]),
            ...consolidado.soloEnJp.map((c) => ['SOLO_EN_JP', c, nombres.get(c) ?? '', '']),
        ].map((fila) => fila.map(celdaCsv).join(','))
        fs.writeFileSync(csv, `${BOM}motivo,codigo,nombre,seccion_en_el_padron\n${lineas.join('\n')}\n`, 'utf8')
        console.log(`\n  Detalle de quienes no coinciden guardado en ${csv} (dato personal: no lo subas al repositorio)`)
    }

    if (plan.conflictos.length) throw new Error('Hay conflictos con los DNI: corrígelos y vuelve a correr.')
    if (!aplicar) return

    await prisma.$transaction(async (tx) => {
        await guardarPadron(tx, evento.id, semestre, consolidado.estudiantes)
        // Se sueltan los DNI de los docentes que ya existen y se reasignan: así un cambio de dueño no choca con el índice único
        await tx.asesor.updateMany({ where: { id: { in: plan.cambios.flatMap((c) => (c.existente ? [c.existente.id] : [])) } }, data: { documento: null } })
        for (const { designado, existente } of plan.cambios) {
            const secciones = designado.grupos.map(({ ciclo, seccion }) => ({ ciclo, seccion }))
            if (existente) {
                await tx.asesor.update({ where: { id: existente.id }, data: { documento: designado.documento ?? existente.documento } })
                await tx.asesorSeccion.deleteMany({ where: { asesorId: existente.id } })
                await tx.asesorSeccion.createMany({ data: secciones.map((s) => ({ asesorId: existente.id, eventoId: evento.id, ...s })) })
            } else {
                await tx.asesor.create({
                    data: { eventoId: evento.id, nombre: designado.nombre, documento: designado.documento, secciones: { create: secciones.map((s) => ({ eventoId: evento.id, ...s })) } },
                })
            }
        }
    }, { maxWait: 10_000, timeout: 120_000 })
    console.log('\n✅ Aplicado: padrón, secciones, DNI y grupos de los docentes actualizados. Sus enlaces no cambiaron.')
}

sincronizarPadronJp()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : 'No se pudo sincronizar el padrón con JP')
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())

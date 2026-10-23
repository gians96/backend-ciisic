import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { parseArgs } from 'util'
import { createConnection, type RowDataPacket } from 'mysql2/promise'
import { prisma } from './prisma'
import {
    construirPadronDeCursos,
    cursosParaGuardar,
    etiquetaDeCurso,
    leerDocentesDni,
    planearDocentes,
    seccionesDelDocente,
    type AsesorExistente,
    type CursoJp,
    type DocenteDni,
    type MatriculaJp,
} from '../api/advisory/services/cursos-jp'
import { guardarPadron } from '../api/advisory/services/importacion'
import type { EstudianteLeido } from '../api/advisory/services/lector-excel'

/**
 * Carga en el seguimiento los **cursos, matrículas y docentes de SIVIRENO** (programación académica, sincronizada en JP) (spec 034):
 * cada curso con su docente y sus alumnos, para ver quién pagó por curso y por docente.
 *
 * - Los estudiantes son **los del padrón actual** (con su DNI, que SIVIRENO no trae) más los matriculados que falten; se cruzan por código de
 *   estudiante y, si no, por correo. Quien no tiene matrícula en SIVIRENO se queda con su sección anterior.
 * - Cada docente de SIVIRENO es un asesor del evento (`asesores.jp_docente_id`): los que ya existen se enlazan por su id, su DNI o su nombre y
 *   conservan nombre, DNI y enlace; los demás se crean. Sus secciones salen de sus cursos.
 * - SIVIRENO se lee **solo con SELECT** (la sesión se abre en solo lectura) desde `JP_DATABASE_URL`, una variable de esta consola y no del API.
 * - `--docentes` es un JSON fuera del repositorio con el DNI de cada docente (`[{ "dni": "…", "nombre": "APELLIDOS NOMBRES" }]`).
 * - Por defecto solo simula. `--aplicar` reemplaza el padrón, las secciones, los cursos y las matrículas y actualiza a los docentes en una transacción.
 *
 *   JP_DATABASE_URL=mysql://usuario:clave@host:3306/jp \
 *   npm run padron:desde-jp:dev -- --evento ciisic-viii-2026 --docentes ruta/docentes.json [--semestre 2026-2] [--carrera IS] [--aplicar] [--csv ruta.csv]
 *
 * `--csv` guarda quién no coincide (dato personal: no lo subas al repositorio). Antes de aplicar en producción, respaldo con `mysqldump`.
 */
function argumentos() {
    const { values } = parseArgs({
        options: {
            evento: { type: 'string' },
            docentes: { type: 'string' },
            semestre: { type: 'string' },
            carrera: { type: 'string', default: 'IS' },
            aplicar: { type: 'boolean', default: false },
            csv: { type: 'string' },
        },
        allowPositionals: false,
    })
    const evento = values.evento?.trim()
    if (!evento) {
        throw new Error('Uso: npm run padron:desde-jp:dev -- --evento <código del evento> [--docentes <docentes.json>] [--semestre 2026-2] [--carrera IS] [--aplicar] [--csv ruta.csv]')
    }
    return {
        evento,
        docentes: values.docentes ? path.resolve(process.cwd(), values.docentes.trim()) : null,
        semestre: values.semestre?.trim() || null,
        carrera: (values.carrera ?? 'IS').trim().toUpperCase(),
        aplicar: values.aplicar === true,
        csv: values.csv ? path.resolve(process.cwd(), values.csv) : null,
    }
}

interface FilaCurso extends RowDataPacket {
    idCarga: number
    codigo: string
    nombre: string
    ciclo: string
    turno: string | null
    seccion: string
    idDocente: number | null
    docente: string | null
    declarados: number | null
}

interface FilaMatricula extends RowDataPacket {
    idCarga: number
    codigo: string
    nombre: string
    correo: string | null
    celular: string | null
}

/** Cursos y matrículas vigentes (de la carrera y el semestre) de JP. Solo `SELECT`, en una sesión de solo lectura. */
async function leerSivireno(carrera: string, semestre: string): Promise<{ cursos: CursoJp[], matriculas: MatriculaJp[], nombres: Map<string, string> }> {
    const url = process.env.JP_DATABASE_URL?.trim()
    if (!url) throw new Error('Define JP_DATABASE_URL (mysql://usuario:clave@host:3306/jp) en esta consola; no se guarda en ningún archivo.')
    const conexion = await createConnection({ uri: url, charset: 'utf8mb4' })
    try {
        await conexion.query('SET SESSION TRANSACTION READ ONLY')
        const [filasCursos] = await conexion.query<FilaCurso[]>(
            `SELECT c.id_carga_lectiva AS idCarga, c.codigo_asignatura AS codigo, c.nombre_asignatura AS nombre, c.ciclo, c.turno, c.seccion,
                    c.id_docente AS idDocente, c.docente, c.cantidad_estudiantes AS declarados
               FROM sivireno_carga_lectiva c
               JOIN sivireno_carrera k ON k.id_carrera = c.id_carrera
              WHERE k.abreviatura_carrera = ? AND c.nombre_semestre = ? AND c.remoto_activo = 1`,
            [carrera, semestre],
        )
        const [filasMatriculas] = await conexion.query<FilaMatricula[]>(
            `SELECT m.id_carga_lectiva AS idCarga, m.codigo_estudiante AS codigo, m.nombre_completo AS nombre, m.email AS correo, m.telefono AS celular
               FROM sivireno_matricula m
               JOIN sivireno_carga_lectiva c ON c.id_carga_lectiva = m.id_carga_lectiva
               JOIN sivireno_carrera k ON k.id_carrera = c.id_carrera
              WHERE k.abreviatura_carrera = ? AND c.nombre_semestre = ? AND c.remoto_activo = 1 AND m.remoto_activo = 1`,
            [carrera, semestre],
        )
        const cursos = filasCursos.map((f): CursoJp => ({
            idCarga: f.idCarga, codigo: f.codigo, nombre: f.nombre, ciclo: f.ciclo, turno: f.turno, seccion: f.seccion, idDocente: f.idDocente, docente: f.docente, declarados: f.declarados,
        }))
        const matriculas = filasMatriculas.map((f): MatriculaJp => ({ idCarga: f.idCarga, codigo: f.codigo, nombre: f.nombre, correo: f.correo, celular: f.celular }))
        return { cursos, matriculas, nombres: new Map(matriculas.map((m) => [m.codigo.trim().toUpperCase(), m.nombre])) }
    } finally {
        await conexion.end()
    }
}

/** Para que Excel abra el CSV en UTF-8. */
const BOM = String.fromCharCode(0xfeff)
const celdaCsv = (valor: string | null) => `"${(valor ?? '').replace(/"/g, '""')}"`

async function sincronizarPadronJp() {
    const { evento: codigo, docentes: rutaDocentes, semestre: semestrePedido, carrera, aplicar, csv } = argumentos()
    const docentesDni: DocenteDni[] = rutaDocentes ? leerDocentesDni(JSON.parse(fs.readFileSync(rutaDocentes, 'utf8'))) : []

    const evento = await prisma.evento.findUnique({ where: { codigo } })
    if (!evento) throw new Error(`No existe el evento «${codigo}»`)

    const filasPadron = await prisma.padronEstudiante.findMany({ where: { eventoId: evento.id }, orderBy: { id: 'asc' } })
    if (!filasPadron.length) throw new Error('El evento no tiene padrón: cárgalo primero con el Excel de la facultad.')
    const semestre = semestrePedido ?? filasPadron[0].semestre
    const padron: EstudianteLeido[] = filasPadron.map(({ documento, codigo: cod, correo, nombre, celular, carrera: carr, ciclo, turno, seccion, distrito, provincia, departamento }) => ({
        documento, codigo: cod, correo, nombre, celular, carrera: carr, ciclo, turno, seccion, distrito, provincia, departamento,
    }))

    const { cursos, matriculas, nombres } = await leerSivireno(carrera, semestre)
    if (!cursos.length) throw new Error(`SIVIRENO no tiene cursos de la carrera ${carrera} en ${semestre}.`)

    const resultado = construirPadronDeCursos(padron, cursos, matriculas, filasPadron[0].carrera)
    const existentes: AsesorExistente[] = await prisma.asesor.findMany({ where: { eventoId: evento.id }, select: { id: true, nombre: true, documento: true, jpDocenteId: true } })
    const plan = planearDocentes(cursos, docentesDni, existentes)

    // Alumnos distintos de cada docente, comparados con lo que SIVIRENO dice de cada curso
    const docenteDeCurso = new Map(cursos.map((c) => [c.idCarga, c.idDocente]))
    const alumnosDeDocente = new Map<number, Set<string>>()
    for (const e of resultado.estudiantes) {
        for (const idCarga of e.matriculas ?? []) {
            const jpId = docenteDeCurso.get(idCarga)
            if (jpId === null || jpId === undefined) continue
            alumnosDeDocente.set(jpId, (alumnosDeDocente.get(jpId) ?? new Set<string>()).add(e.codigo))
        }
    }
    const cursosConOtraCantidad = cursos.filter((c) => c.declarados !== null && c.declarados !== undefined && c.declarados !== (resultado.alumnosPorCurso.get(c.idCarga) ?? 0))
    const sinDocente = cursos.filter((c) => c.idDocente === null)
    const sinDni = plan.docentes.filter((d) => !(d.dni ?? d.existente?.documento))

    console.log(`${aplicar ? '⏳ Aplicando' : '🔎 Simulación (no se escribe nada; usa --aplicar)'} — ${evento.nombreCorto} · ${carrera} ${semestre}`)
    console.log(`  Cursos de SIVIRENO: ${cursos.length} (${new Set(cursos.map((c) => c.codigo)).size} asignaturas) · matrículas: ${matriculas.length - resultado.matriculasHuerfanas}`)
    console.log(`  Estudiantes: ${resultado.estudiantes.length} (los ${padron.length} del padrón se quedan)`)
    console.log(`    con cursos en SIVIRENO: ${resultado.estudiantes.filter((e) => (e.matriculas ?? []).length).length}`)
    console.log(`    sin curso en SIVIRENO (conservan su sección anterior): ${resultado.sinCursos.length}`)
    console.log(`    de SIVIRENO que no estaban en el padrón (se agregan sin DNI): ${resultado.agregados.length}`)
    console.log(`    matriculados en más de una sección: ${resultado.enVariasSecciones}`)
    console.log(`  Cursos con otra cantidad de alumnos que la que dice SIVIRENO: ${cursosConOtraCantidad.length}${sinDocente.length ? ` · cursos sin docente: ${sinDocente.length}` : ''}`)

    console.log(`\n  Docentes de SIVIRENO: ${plan.docentes.length} · con DNI: ${plan.docentes.length - sinDni.length} · sin DNI: ${sinDni.length}`)
    console.log(`    ya existían (se enlazan): ${plan.docentes.filter((d) => d.existente).length} · nuevos: ${plan.docentes.filter((d) => !d.existente).length}`)
    console.log(`    con DNI por asignar o cambiar: ${plan.docentes.filter((d) => d.cambiaDocumento).length}`)
    for (const d of plan.docentes) {
        const alumnos = alumnosDeDocente.get(d.jpId)?.size ?? 0
        console.log(`    ${d.nombre.padEnd(46)} ${String(d.cursos).padStart(2)} curso(s) ${String(alumnos).padStart(4)} alumnos  ${(d.dni ?? d.existente?.documento) ? 'DNI sí' : 'DNI NO'}  ${d.existente ? 'existe' : 'se crea'}`)
    }
    if (sinDni.length) console.log(`    Sin DNI (se les agrega desde el panel): ${sinDni.map((d) => d.nombre).join('; ')}`)
    if (plan.dniSinDocente.length) console.log(`    ⚠ DNI de la lista sin docente en SIVIRENO: ${plan.dniSinDocente.map((d) => d.nombre).join('; ')}`)
    if (plan.noEnlazados.length) console.log(`    Docentes que ya existían y no dictan cursos en SIVIRENO (no se tocan): ${plan.noEnlazados.map((a) => a.nombre).join('; ')}`)
    for (const conflicto of plan.conflictos) console.error(`  ✗ ${conflicto}`)

    if (csv) {
        const delPadron = new Map(padron.map((e) => [e.codigo, e]))
        const lineas = [
            ...resultado.sinCursos.map((c) => ['SIN_CURSO_EN_SIVIRENO', c, delPadron.get(c)?.nombre ?? '', `${delPadron.get(c)?.ciclo ?? ''}-${delPadron.get(c)?.seccion ?? ''}`]),
            ...resultado.agregados.map((c) => ['AGREGADO_DE_SIVIRENO', c, nombres.get(c) ?? '', '']),
            ...cursosConOtraCantidad.map((c) => ['CURSO_CON_OTRA_CANTIDAD', String(c.idCarga), `${c.nombre} (${etiquetaDeCurso(c)})`, `SIVIRENO ${c.declarados} · padrón ${resultado.alumnosPorCurso.get(c.idCarga) ?? 0}`]),
        ].map((fila) => fila.map(celdaCsv).join(','))
        fs.writeFileSync(csv, `${BOM}motivo,codigo,nombre,detalle\n${lineas.join('\n')}\n`, 'utf8')
        console.log(`\n  Detalle de quienes no coinciden guardado en ${csv} (dato personal: no lo subas al repositorio)`)
    }

    if (plan.conflictos.length) throw new Error('Hay conflictos con los DNI: corrígelos y vuelve a correr.')
    if (!aplicar) return

    await prisma.$transaction(async (tx) => {
        // 1) Docentes: se sueltan los DNI que van a cambiar y se reasignan, así un cambio de dueño no choca con el índice único
        await tx.asesor.updateMany({ where: { id: { in: plan.docentes.flatMap((d) => (d.existente && d.cambiaDocumento ? [d.existente.id] : [])) } }, data: { documento: null } })
        const asesorIdPorDocenteJp = new Map<number, number>()
        for (const d of plan.docentes) {
            if (d.existente) {
                await tx.asesor.update({ where: { id: d.existente.id }, data: { jpDocenteId: d.jpId, documento: d.dni ?? d.existente.documento } })
                asesorIdPorDocenteJp.set(d.jpId, d.existente.id)
            } else {
                const creado = await tx.asesor.create({ data: { eventoId: evento.id, nombre: d.nombre, documento: d.dni, jpDocenteId: d.jpId } })
                asesorIdPorDocenteJp.set(d.jpId, creado.id)
            }
        }
        // 2) Padrón, secciones, cursos y matrículas
        await guardarPadron(tx, evento.id, semestre, resultado.estudiantes, cursosParaGuardar(cursos, asesorIdPorDocenteJp))
        // 3) Secciones de cada docente, derivadas de sus cursos
        for (const d of plan.docentes) {
            const asesorId = asesorIdPorDocenteJp.get(d.jpId)
            if (asesorId === undefined) continue
            await tx.asesorSeccion.deleteMany({ where: { asesorId } })
            const secciones = seccionesDelDocente(cursos, d.jpId)
            if (secciones.length) await tx.asesorSeccion.createMany({ data: secciones.map((s) => ({ asesorId, eventoId: evento.id, ...s })) })
        }
    }, { maxWait: 10_000, timeout: 180_000 })
    console.log('\n✅ Aplicado: cursos, matrículas, padrón, secciones y docentes actualizados. Los enlaces de los docentes no cambiaron.')
}

sincronizarPadronJp()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : 'No se pudo sincronizar el padrón con SIVIRENO')
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())

import { Prisma } from '@prisma/client'
import { ValidationError } from 'yup'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { configuracionCertificados } from '../../../core/configuracion-sistema'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { crearParticipante } from '../../participant/services/participant'
import { crearParticipanteSchema, type CrearParticipanteInput } from '../../participant/validation'
import { leerCache } from '../../document-lookup/services/cache'
import {
    claveVigente,
    conReintentoDeNumeracion,
    crearConNumeroYCodigo,
    esCertificadoDuplicado,
    generarCodigo,
    siguienteNumero,
} from '../codigos/codigo'
import { aCertificado, INCLUDE_CERTIFICADO, plantillaDelEvento } from './certificados'
import {
    MAX_HORAS_CERTIFICADO,
    type DesdeInscripcionesInput,
    type EmitirCertificadoInput,
    type FilaImportacion,
    type ImportarCertificadosInput,
} from '../validation/certificados'

/**
 * Emisión de certificados (spec 015): individual, desde los inscritos aprobados y por lista. Emitir
 * crea el certificado en PENDIENTE con su código fijo (`<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>`) y una
 * copia del nombre y el documento; el PDF se genera después, en tandas. Un certificado vigente es
 * único por evento, persona, tipo y ponencia (`clave_vigente`): repetir la emisión lo omite
 * (idempotente) y, tras anularlo, se puede volver a emitir.
 *
 * Las personas nuevas se registran con el servicio de participantes (spec 014): correo
 * obligatorio, nombres oficiales por la consulta DNI del panel. Si la persona ya existe con otro
 * correo, se conserva el registrado (solo Participantes lo cambia) y se avisa.
 */

/** Consultas DNI a proveedores (sin caché) por solicitud de importación. */
export const MAX_CONSULTAS_DNI_IMPORTACION = 50
/** Certificados por INSERT al emitir en bloque. */
const TAMANO_LOTE = 100
/** Filas de ejemplo en la simulación desde inscritos. */
const MAX_MUESTRA = 100

interface ContextoEmision {
    eventoId: number
    anio: number
    prefijo: string
    tipo: { id: number, codigo: string }
    plantilla: { id: number, horasPorDefecto: number | null }
    fechaEmision: Date
}

/** Evento, tipo activo, plantilla del evento y activa, prefijo vigente y fecha de emisión. */
async function contextoEmision(eventoId: number, tipoCodigo: string, plantillaId: number, fechaEmision?: string | null): Promise<ContextoEmision> {
    const evento = await obtenerEventoPorId(eventoId)
    const tipo = await prisma.tipoCertificado.findUnique({ where: { codigo: tipoCodigo }, select: { id: true, codigo: true, activo: true } })
    if (!tipo) throw unprocessable('CERTIFICATE_TYPE_NOT_FOUND', 'El tipo de certificado no existe.', { tipoCodigo: 'Elige un tipo del catálogo' })
    if (!tipo.activo) throw unprocessable('CERTIFICATE_TYPE_INACTIVE', 'El tipo de certificado está desactivado.', { tipoCodigo: 'Elige un tipo activo' })
    const plantilla = await plantillaDelEvento(eventoId, plantillaId)
    const { prefijo } = await configuracionCertificados()
    return {
        eventoId,
        anio: evento.fechaInicio.getUTCFullYear(),
        prefijo,
        tipo: { id: tipo.id, codigo: tipo.codigo },
        plantilla: { id: plantilla.id, horasPorDefecto: plantilla.horasPorDefecto },
        fechaEmision: aColumnaFecha(fechaEmision || fechaLima()),
    }
}

async function ponenciaDelEvento(eventoId: number, ponenciaId: string): Promise<string> {
    const ponencia = await prisma.ponencia.findUnique({ where: { id: ponenciaId }, select: { id: true, eventoId: true } })
    if (!ponencia) throw notFound('PAPER_NOT_FOUND', 'La ponencia no existe.')
    if (ponencia.eventoId !== eventoId) throw unprocessable('PAPER_OTHER_EVENT', 'La ponencia es de otro evento.', { ponenciaId: 'Elige una ponencia de este evento' })
    return ponencia.id
}

interface Persona {
    id: number
    nombres: string
    apellidos: string
    tipoDocumentoId: string
    numeroDocumento: string
    correo: string
}

const DATOS_PERSONA = { id: true, nombres: true, apellidos: true, tipoDocumentoId: true, numeroDocumento: true, correo: true } as const

/** Lo que se copia al certificado (nombre y documento quedan fijos desde la emisión). */
interface Destinatario {
    participante: Persona
    inscripcionId: number | null
    ponenciaId: string | null
    detalle: string | null
    horas: number | null
}

function nombreDe(persona: Pick<Persona, 'nombres' | 'apellidos'>): string {
    return `${persona.nombres} ${persona.apellidos}`.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function claveDe(ctx: ContextoEmision, d: Pick<Destinatario, 'participante' | 'ponenciaId'>): string {
    return claveVigente({ eventoId: ctx.eventoId, participanteId: d.participante.id, tipoCertificadoId: ctx.tipo.id, ponenciaId: d.ponenciaId })
}

function filaCertificado(ctx: ContextoEmision, d: Destinatario, actorId: number, numerado: { numero: number, codigo: string }): Prisma.CertificadoUncheckedCreateInput {
    return {
        eventoId: ctx.eventoId,
        participanteId: d.participante.id,
        tipoCertificadoId: ctx.tipo.id,
        plantillaId: ctx.plantilla.id,
        inscripcionId: d.inscripcionId,
        ponenciaId: d.ponenciaId,
        numero: numerado.numero,
        codigo: numerado.codigo,
        claveVigente: claveDe(ctx, d),
        estado: 'PENDIENTE',
        nombreImpreso: nombreDe(d.participante),
        tipoDocumento: d.participante.tipoDocumentoId.slice(0, 10),
        numeroDocumento: d.participante.numeroDocumento,
        detalle: d.detalle,
        horas: d.horas ?? ctx.plantilla.horasPorDefecto,
        fechaEmision: ctx.fechaEmision,
        emitidoPorId: actorId,
    }
}

const certificadoExistente = () => conflict('CERTIFICATE_EXISTS', 'La persona ya tiene un certificado vigente de este tipo en el evento.')

/** Crea un certificado con el siguiente número del evento. P2002 de la clave vigente → 409 `CERTIFICATE_EXISTS`. */
async function crearUno(ctx: ContextoEmision, d: Destinatario, actorId: number) {
    try {
        return await crearConNumeroYCodigo({ eventoId: ctx.eventoId, prefijo: ctx.prefijo, anio: ctx.anio }, (tx, numerado) =>
            tx.certificado.create({ data: filaCertificado(ctx, d, actorId, numerado), include: INCLUDE_CERTIFICADO }))
    } catch (error) {
        if (esCertificadoDuplicado(error)) throw certificadoExistente()
        throw error
    }
}

/**
 * Crea en bloques de 100 (un INSERT por bloque, números consecutivos desde `max + 1`). Si otra
 * emisión simultánea creó alguno de los mismos, ese bloque se repite uno por uno y los repetidos se
 * devuelven aparte (se informan como ya emitidos).
 */
async function crearEnBloque(ctx: ContextoEmision, destinatarios: Destinatario[], actorId: number): Promise<{ creados: Destinatario[], repetidos: Destinatario[] }> {
    const creados: Destinatario[] = []
    const repetidos: Destinatario[] = []
    for (let inicio = 0; inicio < destinatarios.length; inicio += TAMANO_LOTE) {
        const bloque = destinatarios.slice(inicio, inicio + TAMANO_LOTE)
        try {
            await conReintentoDeNumeracion(() => prisma.$transaction(async (tx) => {
                const primero = await siguienteNumero(tx, ctx.eventoId)
                const data = bloque.map((d, i) => {
                    const numero = primero + i
                    return filaCertificado(ctx, d, actorId, { numero, codigo: generarCodigo({ prefijo: ctx.prefijo, anio: ctx.anio, numero }) })
                })
                await tx.certificado.createMany({ data })
            }))
            creados.push(...bloque)
        } catch (error) {
            if (!esCertificadoDuplicado(error)) throw error
            for (const d of bloque) {
                try {
                    await crearUno(ctx, d, actorId)
                    creados.push(d)
                } catch (unoError) {
                    if (!(unoError instanceof HttpError && unoError.code === 'CERTIFICATE_EXISTS')) throw unoError
                    repetidos.push(d)
                }
            }
        }
    }
    return { creados, repetidos }
}

/** Claves vigentes que ya existen (para omitir lo ya emitido). */
async function clavesExistentes(claves: string[]): Promise<Set<string>> {
    const existentes = new Set<string>()
    for (let i = 0; i < claves.length; i += 500) {
        const filas = await prisma.certificado.findMany({ where: { claveVigente: { in: claves.slice(i, i + 500) } }, select: { claveVigente: true } })
        for (const fila of filas) if (fila.claveVigente) existentes.add(fila.claveVigente)
    }
    return existentes
}

export interface AvisoEmision {
    codigo: 'CORREO_CONSERVADO'
    mensaje: string
}

const AVISO_CORREO_CONSERVADO: AvisoEmision = {
    codigo: 'CORREO_CONSERVADO',
    mensaje: 'La persona ya estaba registrada con otro correo: se conserva el registrado (se cambia en Participantes).',
}

// ─── Individual ─────────────────────────────────────────────────────────────

/**
 * Persona por documento: la existente (sin tocar su correo) o una nueva con `crearParticipante`
 * (consulta DNI, correo único: 409 `EMAIL_IN_USE`; sin nombres: 422 `NAMES_REQUIRED`).
 */
async function personaPorDocumento(persona: CrearParticipanteInput): Promise<{ participante: Persona, nuevo: boolean, avisos: AvisoEmision[] }> {
    const porDocumento = { tipoDocumentoId_numeroDocumento: { tipoDocumentoId: persona.tipoDocumento, numeroDocumento: persona.numeroDocumento } }
    const existente = await prisma.participante.findUnique({ where: porDocumento, select: DATOS_PERSONA })
    if (existente) {
        return { participante: existente, nuevo: false, avisos: existente.correo.toLowerCase() === persona.correo.toLowerCase() ? [] : [AVISO_CORREO_CONSERVADO] }
    }
    try {
        const creado = await crearParticipante(persona)
        return {
            participante: { id: creado.id, nombres: creado.nombres, apellidos: creado.apellidos, tipoDocumentoId: creado.tipoDocumento, numeroDocumento: creado.numeroDocumento, correo: creado.correo },
            nuevo: true,
            avisos: [],
        }
    } catch (error) {
        // Otra alta con el mismo documento ganó la carrera: se usa la persona registrada
        if (error instanceof HttpError && error.code === 'PARTICIPANT_EXISTS') {
            const ganador = await prisma.participante.findUnique({ where: porDocumento, select: DATOS_PERSONA })
            if (ganador) return { participante: ganador, nuevo: false, avisos: ganador.correo.toLowerCase() === persona.correo.toLowerCase() ? [] : [AVISO_CORREO_CONSERVADO] }
        }
        throw error
    }
}

/**
 * `POST /v1/events/:eventId/certificates`: un certificado para un participante existente
 * (`participanteId`) o para una persona por documento (`persona`, se registra si no existe).
 * Se valida todo lo del certificado antes de registrar a nadie.
 */
export async function emitirIndividual(eventoId: number, input: EmitirCertificadoInput, actorId: number) {
    const ctx = await contextoEmision(eventoId, input.tipoCodigo, input.plantillaId, input.fechaEmision)
    const ponenciaId = input.ponenciaId ? await ponenciaDelEvento(eventoId, input.ponenciaId) : null

    let destino: { participante: Persona, nuevo: boolean, avisos: AvisoEmision[] }
    if (input.participanteId) {
        const encontrado = await prisma.participante.findUnique({ where: { id: input.participanteId }, select: DATOS_PERSONA })
        if (!encontrado) throw notFound('PARTICIPANT_NOT_FOUND', 'El participante no existe.')
        destino = { participante: encontrado, nuevo: false, avisos: [] }
    } else {
        destino = await personaPorDocumento(input.persona as CrearParticipanteInput)
    }
    const { participante, nuevo, avisos } = destino
    const destinatario: Destinatario = { participante, inscripcionId: null, ponenciaId, detalle: input.detalle ?? null, horas: input.horas ?? null }
    // Quien ya estaba registrado puede tener el certificado: 409 sin gastar un número
    if (!nuevo && (await clavesExistentes([claveDe(ctx, destinatario)])).size) throw certificadoExistente()

    const certificado = await crearUno(ctx, destinatario, actorId)
    return { certificado: aCertificado(certificado, true), participante: { id: participante.id, nuevo }, avisos }
}

// ─── Desde los inscritos ────────────────────────────────────────────────────

export type ResultadoInscrito = 'CREAR' | 'YA_EMITIDO' | 'EXCLUIDO'

interface Asistencia {
    marcadas: number
    total: number
    porcentaje: number
}

/** Actividades sobre las que se mide la asistencia: las elegidas (del evento) o todas las del evento. */
async function actividadesParaAsistencia(eventoId: number, actividadIds: number[] | undefined): Promise<number[]> {
    const elegidas = actividadIds?.length ? [...new Set(actividadIds)] : null
    const actividades = await prisma.actividad.findMany({ where: { eventoId, ...(elegidas ? { id: { in: elegidas } } : {}) }, select: { id: true } })
    if (elegidas && actividades.length !== elegidas.length) {
        throw unprocessable('ACTIVITY_OTHER_EVENT', 'Alguna actividad no existe o es de otro evento.', { 'filtro.actividadIds': 'Elige actividades de este evento' })
    }
    if (!actividades.length) throw unprocessable('NO_ACTIVITIES', 'El evento no tiene actividades para medir la asistencia.', { 'filtro.asistenciaMinima': 'Crea las actividades o quita la asistencia mínima' })
    return actividades.map((a) => a.id)
}

/**
 * `POST /v1/events/:eventId/certificates/from-inscriptions`: inscritos APROBADOS del evento (con
 * filtro opcional por tipo de inscripción y por asistencia mínima, en % de las actividades, sin las
 * anuladas). Con `simular` solo cuenta (y devuelve una muestra); si no, crea lo que falta y omite lo
 * ya emitido.
 */
export async function emitirDesdeInscripciones(eventoId: number, input: DesdeInscripcionesInput, actorId: number) {
    const ctx = await contextoEmision(eventoId, input.tipoCodigo, input.plantillaId, input.fechaEmision)
    const filtro = input.filtro ?? {}
    const minima = filtro.asistenciaMinima ?? null
    if (minima === null && filtro.actividadIds?.length) {
        throw unprocessable('VALIDATION_ERROR', 'Los datos enviados no son válidos', { 'filtro.asistenciaMinima': 'Indica la asistencia mínima para filtrar por actividades' })
    }
    const actividadIds = minima === null ? null : await actividadesParaAsistencia(eventoId, filtro.actividadIds)

    const inscripciones = await prisma.inscripcion.findMany({
        where: {
            eventoId,
            estado: { codigo: 'APROBADO' },
            ...(filtro.tipoInscripcionIds?.length ? { tipoInscripcionId: { in: [...new Set(filtro.tipoInscripcionIds)] } } : {}),
        },
        select: { id: true, participante: { select: DATOS_PERSONA } },
        orderBy: [{ participante: { apellidos: 'asc' } }, { participante: { nombres: 'asc' } }, { id: 'asc' }],
    })

    const marcadas = new Map<number, number>()
    if (actividadIds) {
        const grupos = await prisma.asistencia.groupBy({
            by: ['participanteId'],
            where: { actividadId: { in: actividadIds }, anuladoEn: null },
            _count: { _all: true },
        })
        for (const grupo of grupos) marcadas.set(grupo.participanteId, grupo._count._all)
    }

    const destinatarios = inscripciones.map((i): Destinatario => ({
        participante: i.participante, inscripcionId: i.id, ponenciaId: null, detalle: null, horas: input.horas ?? null,
    }))
    const existentes = await clavesExistentes(destinatarios.map((d) => claveDe(ctx, d)))

    const clasificados = destinatarios.map((d) => {
        let asistencia: Asistencia | null = null
        if (actividadIds) {
            const cuantas = marcadas.get(d.participante.id) ?? 0
            asistencia = { marcadas: cuantas, total: actividadIds.length, porcentaje: Math.round((cuantas * 1000) / actividadIds.length) / 10 }
        }
        let resultado: ResultadoInscrito = 'CREAR'
        if (existentes.has(claveDe(ctx, d))) resultado = 'YA_EMITIDO'
        // Comparación exacta, sin redondeo: marcadas / total ≥ mínima / 100
        else if (asistencia && minima !== null && asistencia.marcadas * 100 < minima * asistencia.total) resultado = 'EXCLUIDO'
        return { destinatario: d, asistencia, resultado }
    })
    const contar = (r: ResultadoInscrito) => clasificados.filter((c) => c.resultado === r).length
    const resumen = { candidatos: clasificados.length, crear: contar('CREAR'), yaEmitidos: contar('YA_EMITIDO'), excluidos: contar('EXCLUIDO') }

    if (input.simular) {
        return {
            simular: true as const,
            ...resumen,
            muestra: clasificados.slice(0, MAX_MUESTRA).map(({ destinatario: d, asistencia, resultado }) => ({
                inscripcionId: d.inscripcionId,
                participanteId: d.participante.id,
                nombre: nombreDe(d.participante),
                tipoDocumento: d.participante.tipoDocumentoId,
                numeroDocumento: d.participante.numeroDocumento,
                asistencia,
                resultado,
            })),
        }
    }
    const { creados, repetidos } = await crearEnBloque(ctx, clasificados.filter((c) => c.resultado === 'CREAR').map((c) => c.destinatario), actorId)
    return { simular: false as const, candidatos: resumen.candidatos, creados: creados.length, yaEmitidos: resumen.yaEmitidos + repetidos.length, excluidos: resumen.excluidos }
}

// ─── Por lista ──────────────────────────────────────────────────────────────

export type ResultadoFila = 'CREAR' | 'CREADO' | 'YA_EMITIDO' | 'ERROR'

export interface FilaResultado {
    fila: number
    resultado: ResultadoFila
    participante: { id: number | null, nuevo: boolean } | null
    /** Código del error (`EMAIL_IN_USE`, `NAMES_REQUIRED`…) o del aviso (`CORREO_CONSERVADO`). */
    codigo: string | null
    mensaje: string | null
}

interface FilaEnCurso {
    resultado: FilaResultado
    persona: CrearParticipanteInput | null
    existente: Persona | null
    detalle: string | null
    horas: number | null
}

function errorDeFila(f: FilaEnCurso, codigo: string, mensaje: string) {
    f.resultado.resultado = 'ERROR'
    f.resultado.codigo = codigo
    f.resultado.mensaje = mensaje
}

/** Horas de la fila: vacío → las de la plantilla; si no, entero de 0 a 10 000. */
function horasDeFila(valor: unknown): number | null | undefined {
    if (valor === undefined || valor === null || valor === '') return null
    const horas = typeof valor === 'number' ? valor : Number(String(valor).trim())
    return Number.isInteger(horas) && horas >= 0 && horas <= MAX_HORAS_CERTIFICADO ? horas : undefined
}

/** Valida la persona de la fila con las reglas del alta de participantes. */
function personaDeFila(entrada: FilaImportacion): { persona: CrearParticipanteInput } | { error: string } {
    try {
        const persona = crearParticipanteSchema.validateSync({
            tipoDocumento: entrada.tipoDocumento,
            numeroDocumento: entrada.numeroDocumento,
            correo: entrada.correo,
            nombres: entrada.nombres || undefined,
            apellidos: entrada.apellidos || undefined,
        }, { abortEarly: false, stripUnknown: true })
        return { persona }
    } catch (error) {
        if (error instanceof ValidationError) {
            const mensajes = (error.inner.length ? error.inner : [error]).map((e) => `${e.path ?? 'fila'}: ${e.message}`)
            return { error: mensajes.join('; ') }
        }
        throw error
    }
}

const claveDocumento = (p: { tipoDocumento: string, numeroDocumento: string }) => `${p.tipoDocumento}:${p.numeroDocumento.toUpperCase()}`

/**
 * `POST /v1/events/:eventId/certificates/import`: lista de hasta 300 filas (organizadores,
 * ponentes…). Resultado por fila: CREAR (simulación), CREADO, YA_EMITIDO o ERROR (documento o correo
 * inválidos, repetidos en la lista, correo de otra persona, nombres que no se pudieron obtener…).
 * Volver a enviar la lista es seguro: lo ya emitido se omite. Como mucho 50 consultas DNI a los
 * proveedores por solicitud (las de la caché no cuentan); las filas que pasen el tope quedan en
 * ERROR `LOOKUP_LIMIT` para el siguiente envío.
 */
export async function importarCertificados(eventoId: number, input: ImportarCertificadosInput, actorId: number) {
    const ctx = await contextoEmision(eventoId, input.tipoCodigo, input.plantillaId, input.fechaEmision)
    const filas: FilaEnCurso[] = input.filas.map((entrada, indice) => {
        const f: FilaEnCurso = {
            resultado: { fila: indice + 1, resultado: 'CREAR', participante: null, codigo: null, mensaje: null },
            persona: null,
            existente: null,
            detalle: entrada.detalle?.trim() || null,
            horas: null,
        }
        const validada = personaDeFila(entrada)
        const horas = horasDeFila(entrada.horas)
        if ('error' in validada) errorDeFila(f, 'INVALID_ROW', validada.error)
        else if (horas === undefined) errorDeFila(f, 'INVALID_ROW', `horas: deben ser un entero de 0 a ${MAX_HORAS_CERTIFICADO}`)
        else {
            f.persona = validada.persona
            f.horas = horas
        }
        return f
    })
    const vivas = () => filas.filter((f) => f.resultado.resultado !== 'ERROR' && f.persona)

    // Repetidos dentro de la lista: vale la primera aparición
    const primeraPorDocumento = new Map<string, number>()
    for (const f of vivas()) {
        const clave = claveDocumento(f.persona as CrearParticipanteInput)
        const primera = primeraPorDocumento.get(clave)
        if (primera) errorDeFila(f, 'DUPLICATE_ROW', `Documento repetido en la lista (fila ${primera}).`)
        else primeraPorDocumento.set(clave, f.resultado.fila)
    }

    // Personas ya registradas (por documento)
    const documentos = vivas().map((f) => ({ tipoDocumentoId: (f.persona as CrearParticipanteInput).tipoDocumento, numeroDocumento: (f.persona as CrearParticipanteInput).numeroDocumento }))
    const registradas = documentos.length
        ? await prisma.participante.findMany({ where: { OR: documentos }, select: DATOS_PERSONA })
        : []
    const porDocumento = new Map(registradas.map((p) => [claveDocumento({ tipoDocumento: p.tipoDocumentoId, numeroDocumento: p.numeroDocumento }), p]))
    for (const f of vivas()) {
        const persona = f.persona as CrearParticipanteInput
        const existente = porDocumento.get(claveDocumento(persona))
        if (existente) {
            f.existente = existente
            f.resultado.participante = { id: existente.id, nuevo: false }
            if (existente.correo.toLowerCase() !== persona.correo.toLowerCase()) {
                f.resultado.codigo = AVISO_CORREO_CONSERVADO.codigo
                f.resultado.mensaje = AVISO_CORREO_CONSERVADO.mensaje
            }
        } else {
            f.resultado.participante = { id: null, nuevo: true }
        }
    }

    // Personas nuevas: el correo no puede ser de otra persona ni repetirse en la lista
    const nuevas = vivas().filter((f) => !f.existente)
    const correosEnUso = new Set(
        nuevas.length
            ? (await prisma.participante.findMany({ where: { correo: { in: nuevas.map((f) => (f.persona as CrearParticipanteInput).correo) } }, select: { correo: true } }))
                .map((p) => p.correo.toLowerCase())
            : [],
    )
    const primeraPorCorreo = new Map<string, number>()
    for (const f of nuevas) {
        const correo = (f.persona as CrearParticipanteInput).correo.toLowerCase()
        const primera = primeraPorCorreo.get(correo)
        if (correosEnUso.has(correo)) errorDeFila(f, 'EMAIL_IN_USE', 'El correo ya está registrado por otra persona.')
        else if (primera) errorDeFila(f, 'DUPLICATE_ROW', `Correo repetido en la lista (fila ${primera}).`)
        else primeraPorCorreo.set(correo, f.resultado.fila)
        const persona = f.persona as CrearParticipanteInput
        if (f.resultado.resultado !== 'ERROR' && persona.tipoDocumento !== 'dni' && !(persona.nombres && persona.apellidos)) {
            errorDeFila(f, 'NAMES_REQUIRED', 'Con carné de extranjería indica los nombres y apellidos.')
        }
    }

    // Lo ya emitido (solo puede tenerlo quien ya estaba registrado)
    const destinatarioDe = (f: FilaEnCurso, participante: Persona): Destinatario => ({ participante, inscripcionId: null, ponenciaId: null, detalle: f.detalle, horas: f.horas })
    const conPersona = vivas().filter((f) => f.existente)
    const existentes = await clavesExistentes(conPersona.map((f) => claveDe(ctx, destinatarioDe(f, f.existente as Persona))))
    for (const f of conPersona) {
        if (existentes.has(claveDe(ctx, destinatarioDe(f, f.existente as Persona)))) {
            f.resultado.resultado = 'YA_EMITIDO'
            f.resultado.codigo = null
            f.resultado.mensaje = 'Ya tiene un certificado vigente de este tipo.'
        }
    }

    if (!input.simular) {
        // Alta de las personas nuevas, una por una (consulta DNI con tope por solicitud)
        let consultas = 0
        for (const f of vivas().filter((fila) => fila.resultado.resultado === 'CREAR' && !fila.existente)) {
            const persona = f.persona as CrearParticipanteInput
            if (persona.tipoDocumento === 'dni' && !(await leerCache(persona.numeroDocumento))) {
                if (consultas >= MAX_CONSULTAS_DNI_IMPORTACION) {
                    errorDeFila(f, 'LOOKUP_LIMIT', `Se alcanzó el tope de ${MAX_CONSULTAS_DNI_IMPORTACION} consultas DNI por envío: vuelve a enviar la lista (lo ya emitido se omite).`)
                    continue
                }
                consultas++
            }
            try {
                const { participante, nuevo, avisos } = await personaPorDocumento(persona)
                f.existente = participante
                f.resultado.participante = { id: participante.id, nuevo }
                if (avisos.length) {
                    f.resultado.codigo = avisos[0].codigo
                    f.resultado.mensaje = avisos[0].mensaje
                }
            } catch (error) {
                if (!(error instanceof HttpError) || error.status >= 500) throw error
                errorDeFila(f, error.code, error.message)
            }
        }

        const porCrear = vivas().filter((f) => f.resultado.resultado === 'CREAR' && f.existente)
        const destinatarios = new Map(porCrear.map((f) => [f, destinatarioDe(f, f.existente as Persona)]))
        const { repetidos } = await crearEnBloque(ctx, [...destinatarios.values()], actorId)
        const repetidosSet = new Set(repetidos)
        for (const [f, d] of destinatarios) {
            if (repetidosSet.has(d)) {
                f.resultado.resultado = 'YA_EMITIDO'
                f.resultado.codigo = null
                f.resultado.mensaje = 'Ya tiene un certificado vigente de este tipo.'
            } else {
                f.resultado.resultado = 'CREADO'
            }
        }
    }

    const resultados = filas.map((f) => f.resultado)
    const contar = (r: ResultadoFila) => resultados.filter((x) => x.resultado === r).length
    return {
        simular: Boolean(input.simular),
        resumen: { total: resultados.length, porCrear: contar('CREAR'), creados: contar('CREADO'), yaEmitidos: contar('YA_EMITIDO'), errores: contar('ERROR') },
        filas: resultados,
    }
}

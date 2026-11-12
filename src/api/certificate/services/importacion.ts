import { Prisma } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { esCodigoCertificado, esDni, normalizarDocumento, variantesDeDocumento } from './codigos'
import type { FilaExcelCertificado } from './lector-excel'

/**
 * Importación del Excel de certificados (spec 015). Empareja cada fila con una persona por su **DNI** (con y sin
 * los ceros que Excel se come) y la registra con el **código** que trae el Excel, que es el que lleva el PDF firmado.
 *
 * - Quien no existe se crea con los datos del Excel (tipo de documento DNI), aunque no haya pagado: el certificado
 *   queda «sin inscripción pagada» y el staff lo ve. Nunca se modifican los datos de una persona que ya existe.
 * - Un correo del Excel que ya usa otra persona no se toca: la fila sale con error.
 * - Reimportar el mismo Excel no duplica nada (mismo código y misma persona = sin cambios).
 * - Simular (`aplicar: false`) responde lo mismo sin escribir.
 */

export type ResultadoFila = 'CREAR' | 'CREADO' | 'ACTUALIZAR' | 'ACTUALIZADO' | 'SIN_CAMBIOS' | 'ERROR'

export interface FilaImportada {
    fila: number
    documento: string
    nombre: string
    codigo: string
    tipo: string
    resultado: ResultadoFila
    /** Tiene una inscripción APROBADO en el evento (pagó). */
    conInscripcion: boolean
    /** La persona no existía y se crea con los datos del Excel. */
    personaNueva: boolean
    mensaje: string | null
}

export interface ResumenImportacion {
    total: number
    crear: number
    actualizar: number
    sinCambios: number
    errores: number
    sinInscripcion: number
    personasNuevas: number
}

export interface ResultadoImportacion {
    simulado: boolean
    resumen: ResumenImportacion
    filas: FilaImportada[]
}

const LARGO = { nombres: 191, apellidos: 191, correo: 191, celular: 20, tipo: 40, nombre: 200, observacion: 500 }
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const recortar = (valor: string, largo: number) => (valor.length > largo ? valor.slice(0, largo) : valor)

/** Clave que impide dos certificados vigentes del mismo tipo para la misma persona en el evento. */
export function claveVigente(eventoId: number, participanteId: number, tipo: string): string {
    return `${eventoId}:${participanteId}:${tipo}`
}

/** «asistente » → `ASISTENTE`; vacío → `ASISTENTE`. */
export function tipoDe(valor: string): string {
    const tipo = valor.trim().replace(/\s+/g, ' ').toUpperCase()
    return recortar(tipo || 'ASISTENTE', LARGO.tipo)
}

interface FilaValida {
    origen: FilaExcelCertificado
    documento: string
    variantes: string[]
    codigo: string
    tipo: string
    nombres: string
    apellidos: string
    nombreImpreso: string
    correo: string | null
    celular: string
    observacion: string | null
}

function validar(fila: FilaExcelCertificado): FilaValida | string {
    const documento = normalizarDocumento(fila.documento)
    if (!documento) return 'Falta el DNI o no es válido.'
    if (!fila.codigo) return 'Falta el código del certificado.'
    if (!esCodigoCertificado(fila.codigo)) return `El código «${fila.codigo.slice(0, 50)}» no es válido (solo letras y números, de 4 a 40).`
    const nombres = recortar(fila.nombres, LARGO.nombres)
    const apellidos = recortar(fila.apellidos, LARGO.apellidos)
    if (!nombres || !apellidos) return 'Faltan los nombres o los apellidos.'
    const correo = fila.correo.trim().toLowerCase()
    return {
        origen: fila,
        documento,
        variantes: variantesDeDocumento(documento),
        codigo: fila.codigo,
        tipo: tipoDe(fila.tipo),
        nombres,
        apellidos,
        nombreImpreso: recortar(`${nombres} ${apellidos}`, LARGO.nombre),
        correo: correo && REGEX_CORREO.test(correo) ? recortar(correo, LARGO.correo) : null,
        celular: recortar(fila.celular.replace(/[^\d+]/g, ''), LARGO.celular),
        observacion: fila.observacion ? recortar(fila.observacion, LARGO.observacion) : null,
    }
}

type ParticipanteBase = { id: number, tipoDocumentoId: string, numeroDocumento: string, correo: string }

/** La persona de la fila: la del DNI (prefiere el tipo «dni») entre las formas del documento. */
function personaDe(variantes: string[], personas: ParticipanteBase[]): ParticipanteBase | null {
    const candidatas = personas.filter((persona) => variantes.includes(persona.numeroDocumento))
    return candidatas.find((persona) => persona.tipoDocumentoId === 'dni') ?? candidatas[0] ?? null
}

function esUnico(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Valida las filas contra la BD y, con `aplicar`, crea las personas y certificados que faltan. Las filas se
 * escriben de una en una (no en una sola transacción): un error en una no deshace las demás y el resultado dice
 * qué pasó con cada una.
 */
export async function importarCertificados(
    eventoId: number,
    filas: readonly FilaExcelCertificado[],
    opciones: { aplicar: boolean, actorId: number },
): Promise<ResultadoImportacion> {
    const resultados: FilaImportada[] = []
    const validas: FilaValida[] = []
    const codigosVistos = new Set<string>()
    const clavesVistas = new Set<string>()

    const conError = (fila: FilaExcelCertificado, mensaje: string, extra: Partial<FilaImportada> = {}) => {
        resultados.push({
            fila: fila.fila,
            documento: normalizarDocumento(fila.documento) ?? fila.documento.slice(0, 20),
            nombre: `${fila.nombres} ${fila.apellidos}`.trim().slice(0, 200),
            codigo: fila.codigo.slice(0, 40),
            tipo: tipoDe(fila.tipo),
            resultado: 'ERROR',
            conInscripcion: false,
            personaNueva: false,
            mensaje,
            ...extra,
        })
    }

    for (const fila of filas) {
        const valida = validar(fila)
        if (typeof valida === 'string') {
            conError(fila, valida)
            continue
        }
        if (codigosVistos.has(valida.codigo)) {
            conError(fila, `El código ${valida.codigo} está repetido en el Excel; se tomó la primera aparición.`)
            continue
        }
        const repetida = `${valida.documento}:${valida.tipo}`
        if (clavesVistas.has(repetida)) {
            conError(fila, `El DNI ${valida.documento} ya tiene otra fila de tipo ${valida.tipo} en el Excel.`)
            continue
        }
        codigosVistos.add(valida.codigo)
        clavesVistas.add(repetida)
        validas.push(valida)
    }

    // Lo que ya existe, en pocas consultas
    const documentos = [...new Set(validas.flatMap((fila) => fila.variantes))]
    const correos = [...new Set(validas.map((fila) => fila.correo).filter((correo): correo is string => Boolean(correo)))]
    const [personas, personasPorCorreo, certificadosPorCodigo] = await Promise.all([
        documentos.length
            ? prisma.participante.findMany({ where: { numeroDocumento: { in: documentos } }, select: { id: true, tipoDocumentoId: true, numeroDocumento: true, correo: true } })
            : Promise.resolve([] as ParticipanteBase[]),
        correos.length
            ? prisma.participante.findMany({ where: { correo: { in: correos } }, select: { id: true, tipoDocumentoId: true, numeroDocumento: true, correo: true } })
            : Promise.resolve([] as ParticipanteBase[]),
        validas.length
            ? prisma.certificado.findMany({ where: { codigo: { in: validas.map((fila) => fila.codigo) } } })
            : Promise.resolve([]),
    ])
    const idsPersonas = personas.map((persona) => persona.id)
    const [inscripciones, vigentes] = await Promise.all([
        idsPersonas.length
            ? prisma.inscripcion.findMany({ where: { eventoId, participanteId: { in: idsPersonas }, estado: { codigo: 'APROBADO' } }, select: { id: true, participanteId: true } })
            : Promise.resolve([] as Array<{ id: number, participanteId: number }>),
        idsPersonas.length
            ? prisma.certificado.findMany({ where: { eventoId, participanteId: { in: idsPersonas }, NOT: { estado: 'ANULADO' } }, select: { id: true, participanteId: true, tipo: true, codigo: true } })
            : Promise.resolve([] as Array<{ id: number, participanteId: number, tipo: string, codigo: string }>),
    ])
    // `codigo` usa la collation binaria: el `in` ya distingue mayúsculas, pero se compara igual por si acaso
    const porCodigo = new Map(certificadosPorCodigo.filter((c) => validas.some((f) => f.codigo === c.codigo)).map((c) => [c.codigo, c]))
    const inscripcionDe = new Map(inscripciones.map((inscripcion) => [inscripcion.participanteId, inscripcion.id]))
    const correoDe = new Map(personasPorCorreo.map((persona) => [persona.correo.toLowerCase(), persona]))

    for (const fila of validas) {
        const persona = personaDe(fila.variantes, personas)
        const inscripcionId = persona ? inscripcionDe.get(persona.id) ?? null : null
        const base = {
            fila: fila.origen.fila,
            documento: fila.documento,
            nombre: fila.nombreImpreso,
            codigo: fila.codigo,
            tipo: fila.tipo,
            conInscripcion: inscripcionId !== null,
            personaNueva: !persona,
        }
        const existente = porCodigo.get(fila.codigo)

        if (existente) {
            if (existente.eventoId !== eventoId || !persona || existente.participanteId !== persona.id) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: `El código ${fila.codigo} ya pertenece a otro certificado.` })
                continue
            }
            if (existente.estado === 'ANULADO') {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: 'Ese certificado está anulado.' })
                continue
            }
            const otroDelTipo = vigentes.find((c) => c.participanteId === persona.id && c.tipo === fila.tipo && c.id !== existente.id)
            if (otroDelTipo) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: `La persona ya tiene otro certificado ${fila.tipo} (código ${otroDelTipo.codigo}).` })
                continue
            }
            const cambios = {
                ...(existente.tipo !== fila.tipo ? { tipo: fila.tipo, claveVigente: claveVigente(eventoId, persona.id, fila.tipo) } : {}),
                ...(existente.nombreImpreso !== fila.nombreImpreso ? { nombreImpreso: fila.nombreImpreso } : {}),
                ...(existente.observacion !== fila.observacion ? { observacion: fila.observacion } : {}),
                ...(existente.inscripcionId !== inscripcionId && inscripcionId !== null ? { inscripcionId } : {}),
            }
            if (!Object.keys(cambios).length) {
                resultados.push({ ...base, conInscripcion: existente.inscripcionId !== null || inscripcionId !== null, resultado: 'SIN_CAMBIOS', mensaje: null })
                continue
            }
            if (!opciones.aplicar) {
                resultados.push({ ...base, resultado: 'ACTUALIZAR', mensaje: null })
                continue
            }
            try {
                await prisma.certificado.update({ where: { id: existente.id }, data: cambios })
                resultados.push({ ...base, resultado: 'ACTUALIZADO', mensaje: null })
            } catch (error) {
                if (!esUnico(error)) throw error
                resultados.push({ ...base, resultado: 'ERROR', mensaje: `La persona ya tiene otro certificado ${fila.tipo}.` })
            }
            continue
        }

        if (persona) {
            const delTipo = vigentes.find((c) => c.participanteId === persona.id && c.tipo === fila.tipo)
            if (delTipo) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: `Ya tiene un certificado ${fila.tipo} con el código ${delTipo.codigo}. Anúlalo si el código cambió.` })
                continue
            }
        } else {
            if (!esDni(fila.documento)) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: 'La persona no está registrada y el documento no es un DNI de 8 dígitos: regístrala primero en Participantes.' })
                continue
            }
            if (!fila.correo) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: 'La persona no está registrada y la fila no tiene un correo válido para crearla.' })
                continue
            }
            if (correoDe.has(fila.correo)) {
                resultados.push({ ...base, resultado: 'ERROR', mensaje: 'La persona no está registrada y su correo ya lo usa otro participante.' })
                continue
            }
        }

        if (!opciones.aplicar) {
            resultados.push({ ...base, resultado: 'CREAR', mensaje: null })
            if (!persona && fila.correo) correoDe.set(fila.correo, { id: 0, tipoDocumentoId: 'dni', numeroDocumento: fila.documento, correo: fila.correo })
            continue
        }

        try {
            let participanteId = persona?.id
            if (!participanteId) {
                const creada = await prisma.participante.create({
                    data: { tipoDocumentoId: 'dni', numeroDocumento: fila.documento, nombres: fila.nombres, apellidos: fila.apellidos, correo: fila.correo as string, celular: fila.celular },
                    select: { id: true, tipoDocumentoId: true, numeroDocumento: true, correo: true },
                })
                participanteId = creada.id
                personas.push(creada)
                correoDe.set(creada.correo.toLowerCase(), creada)
            }
            await prisma.certificado.create({
                data: {
                    eventoId,
                    participanteId,
                    inscripcionId,
                    codigo: fila.codigo,
                    claveVigente: claveVigente(eventoId, participanteId, fila.tipo),
                    tipo: fila.tipo,
                    nombreImpreso: fila.nombreImpreso,
                    numeroDocumento: persona?.numeroDocumento ?? fila.documento,
                    observacion: fila.observacion,
                    importadoPorId: opciones.actorId,
                },
            })
            vigentes.push({ id: -1, participanteId, tipo: fila.tipo, codigo: fila.codigo })
            resultados.push({ ...base, resultado: 'CREADO', mensaje: null })
        } catch (error) {
            if (!esUnico(error)) throw error
            resultados.push({ ...base, resultado: 'ERROR', mensaje: 'Otra carga registró este código, este DNI o este correo al mismo tiempo. Vuelve a importar.' })
        }
    }

    resultados.sort((a, b) => a.fila - b.fila)
    const resumen: ResumenImportacion = {
        total: resultados.length,
        crear: resultados.filter((r) => r.resultado === 'CREAR' || r.resultado === 'CREADO').length,
        actualizar: resultados.filter((r) => r.resultado === 'ACTUALIZAR' || r.resultado === 'ACTUALIZADO').length,
        sinCambios: resultados.filter((r) => r.resultado === 'SIN_CAMBIOS').length,
        errores: resultados.filter((r) => r.resultado === 'ERROR').length,
        sinInscripcion: resultados.filter((r) => r.resultado !== 'ERROR' && !r.conInscripcion).length,
        personasNuevas: resultados.filter((r) => r.resultado !== 'ERROR' && r.personaNueva).length,
    }
    if (opciones.aplicar) {
        console.info(`[certificados] La cuenta ${opciones.actorId} importó ${resumen.crear} certificado(s) nuevos y actualizó ${resumen.actualizar} en el evento ${eventoId} (${resumen.errores} con error)`)
    }
    return { simulado: !opciones.aplicar, resumen, filas: resultados }
}

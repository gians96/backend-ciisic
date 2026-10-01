import path from 'path'
import { Prisma, type PlantillaCertificado } from '@prisma/client'
import { prisma } from '../../../database/prisma'
import { conflict, HttpError, notFound, unprocessable } from '../../../core/http-error'
import { aColumnaFecha, fechaLima } from '../../../core/fechas'
import { limitarConcurrencia } from '../../../core/concurrencia'
import { configuracionCertificados, urlVerificacionCertificado } from '../../../core/configuracion-sistema'
import {
    borrarArchivo,
    escribirArchivoAtomico,
    leerArchivoServido,
    nuevoNombrePlantilla,
    rutaPlantilla,
} from '../../../core/almacenamiento'
import { obtenerEventoPorId } from '../../event/services/public-event'
import { nuevaGeneracion } from '../codigos/codigo'
import { estampar } from '../pdf/estampar'
import { validarDiseno } from '../pdf/validar-diseno'
import type { AvisoEstampado, CampoPlantilla, DatosCertificado } from '../pdf/tipos'
import {
    validarCampos,
    mismosCampos,
    type ActualizarPlantillaInput,
    type CrearPlantillaInput,
    type VistaPreviaInput,
} from '../validation/plantillas'
import { tipoPorCodigo } from './tipos'

/**
 * Plantillas de certificado por evento (spec 015): un PDF de diseño (1–2 páginas, ≤5 MB, sin
 * cifrar ni rotar) y sus campos posicionados en puntos PDF. El diseño se guarda como
 * `uploads/certificados/plantillas/plantilla-<uuid>.pdf` (escritura atómica; la BD guarda solo el
 * nombre). `version` sube cuando cambian los campos o el diseño: cada certificado guarda la versión
 * con la que se generó. Una plantilla con certificados no se borra (409 `TEMPLATE_IN_USE`): se desactiva.
 */

const INCLUIR = {
    creadoPor: { select: { id: true, nombres: true, apellidos: true } },
    _count: { select: { certificados: true } },
} satisfies Prisma.PlantillaCertificadoInclude

type FilaPlantilla = Prisma.PlantillaCertificadoGetPayload<{ include: typeof INCLUIR }>

/** Archivo subido (multer en memoria). */
export interface ArchivoSubido {
    buffer: Buffer
    originalname: string
}

export function camposDe(plantilla: Pick<PlantillaCertificado, 'campos'>): CampoPlantilla[] {
    return Array.isArray(plantilla.campos) ? (plantilla.campos as unknown as CampoPlantilla[]) : []
}

export function aPlantilla(plantilla: FilaPlantilla) {
    const totalCertificados = plantilla._count.certificados
    return {
        id: plantilla.id,
        eventoId: plantilla.eventoId,
        nombre: plantilla.nombre,
        archivoOriginal: plantilla.archivoOriginal,
        tamanoBytes: plantilla.tamanoBytes,
        paginas: plantilla.paginas,
        anchoPt: plantilla.anchoPt,
        altoPt: plantilla.altoPt,
        campos: camposDe(plantilla),
        horasPorDefecto: plantilla.horasPorDefecto,
        firmasRequeridas: plantilla.firmasRequeridas,
        version: plantilla.version,
        activa: plantilla.activa,
        totalCertificados,
        enUso: totalCertificados > 0,
        creadoPor: plantilla.creadoPor,
        creadoEn: plantilla.creadoEn,
        actualizadoEn: plantilla.actualizadoEn,
    }
}

export type PlantillaPublica = ReturnType<typeof aPlantilla>

const plantillaNoEncontrada = () => notFound('TEMPLATE_NOT_FOUND', 'La plantilla de certificado no existe.')
const plantillaCambiada = () => conflict('TEMPLATE_CHANGED', 'La plantilla cambió mientras la editabas: vuelve a cargarla e inténtalo de nuevo.')

async function obtenerFila(id: number): Promise<FilaPlantilla> {
    const plantilla = await prisma.plantillaCertificado.findUnique({ where: { id }, include: INCLUIR })
    if (!plantilla) throw plantillaNoEncontrada()
    return plantilla
}

export async function obtenerPlantilla(id: number): Promise<PlantillaPublica> {
    return aPlantilla(await obtenerFila(id))
}

export async function listarPlantillas(eventoId: number): Promise<PlantillaPublica[]> {
    await obtenerEventoPorId(eventoId)
    const plantillas = await prisma.plantillaCertificado.findMany({
        where: { eventoId },
        include: INCLUIR,
        orderBy: [{ activa: 'desc' }, { id: 'asc' }],
    })
    return plantillas.map(aPlantilla)
}

/** Nombre original del archivo, solo para mostrarlo: sin ruta ni caracteres de control. */
function nombreOriginal(archivo: ArchivoSubido): string {
    // eslint-disable-next-line no-control-regex
    const limpio = path.basename(String(archivo.originalname ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim()
    return (limpio || 'diseno.pdf').slice(-255)
}

/** Nombre por defecto: el del archivo sin la extensión. */
function nombreDesdeArchivo(original: string): string {
    const base = original.replace(/\.pdf$/i, '').trim()
    return (base.length >= 2 ? base : `Plantilla ${fechaLima()}`).slice(0, 120)
}

/** Lee el diseño de una plantilla (lo usan la vista previa y la generación). 404 si el archivo falta. */
export function leerDisenoDePlantilla(archivoDiseno: string): Buffer {
    const ruta = rutaPlantilla(archivoDiseno)
    if (!ruta) throw notFound('TEMPLATE_DESIGN_NOT_FOUND', 'No se encontró el PDF de diseño de la plantilla.')
    return leerArchivoServido(ruta, () => notFound('TEMPLATE_DESIGN_NOT_FOUND', 'No se encontró el PDF de diseño de la plantilla.'))
}

export async function crearPlantilla(eventoId: number, archivo: ArchivoSubido, input: CrearPlantillaInput, adminId?: number): Promise<PlantillaPublica> {
    await obtenerEventoPorId(eventoId)
    const info = await validarDiseno(archivo.buffer)
    const campos = input.campos === undefined || input.campos === '' ? [] : await validarCampos(input.campos, info.paginas)
    const original = nombreOriginal(archivo)

    const archivoDiseno = nuevoNombrePlantilla()
    const ruta = rutaPlantilla(archivoDiseno) as string
    await escribirArchivoAtomico(ruta, archivo.buffer)
    try {
        const plantilla = await prisma.plantillaCertificado.create({
            data: {
                eventoId,
                nombre: input.nombre ?? nombreDesdeArchivo(original),
                archivoDiseno,
                archivoOriginal: original,
                tamanoBytes: info.tamanoBytes,
                paginas: info.paginas,
                anchoPt: info.anchoPt,
                altoPt: info.altoPt,
                campos: campos as unknown as Prisma.InputJsonValue,
                horasPorDefecto: input.horasPorDefecto ?? null,
                firmasRequeridas: input.firmasRequeridas ?? 1,
                creadoPorId: adminId ?? null,
            },
            include: INCLUIR,
        })
        console.log(`Plantilla de certificado ${plantilla.id} creada en el evento ${eventoId} por el administrador ${adminId ?? '?'}`)
        return aPlantilla(plantilla)
    } catch (error) {
        await borrarArchivo(ruta).catch(() => undefined)
        throw error
    }
}

/**
 * Actualización parcial. La versión sube si cambian los campos. La escritura exige que la versión
 * no haya cambiado desde que se leyó (otro editor, un diseño nuevo): si cambió, 409 `TEMPLATE_CHANGED`.
 * El panel puede enviar la `version` que tiene para detectar ediciones cruzadas.
 */
export async function actualizarPlantilla(id: number, input: ActualizarPlantillaInput, adminId?: number): Promise<PlantillaPublica> {
    const actual = await obtenerFila(id)
    if (input.version !== undefined && input.version !== actual.version) throw plantillaCambiada()

    const data: Prisma.PlantillaCertificadoUpdateManyMutationInput = {}
    const cambios: string[] = []
    if (input.campos !== undefined) {
        const campos = await validarCampos(input.campos, actual.paginas)
        if (!mismosCampos(campos, camposDe(actual))) {
            data.campos = campos as unknown as Prisma.InputJsonValue
            data.version = { increment: 1 }
            cambios.push('campos')
        }
    }
    if (input.nombre !== undefined && input.nombre !== actual.nombre) { data.nombre = input.nombre; cambios.push('nombre') }
    if (input.horasPorDefecto !== undefined && input.horasPorDefecto !== actual.horasPorDefecto) { data.horasPorDefecto = input.horasPorDefecto; cambios.push('horasPorDefecto') }
    if (input.firmasRequeridas !== undefined && input.firmasRequeridas !== actual.firmasRequeridas) { data.firmasRequeridas = input.firmasRequeridas; cambios.push('firmasRequeridas') }
    if (input.activa !== undefined && input.activa !== actual.activa) { data.activa = input.activa; cambios.push('activa') }
    if (!cambios.length) return aPlantilla(actual)

    const resultado = await prisma.plantillaCertificado.updateMany({ where: { id, version: actual.version }, data })
    if (resultado.count === 0) throw plantillaCambiada()
    console.log(`Plantilla de certificado ${id} actualizada por el administrador ${adminId ?? '?'}: ${cambios.join(', ')}`)
    if (data.firmasRequeridas !== undefined && input.firmasRequeridas !== undefined && input.firmasRequeridas < actual.firmasRequeridas) {
        // Bajaron las firmas requeridas: los parciales que ya las tienen quedan FIRMADO (si no, nadie los
        // vería en el portal ni en la verificación hasta quitar y volver a subir el firmado)
        const { count } = await prisma.certificado.updateMany({
            where: { plantillaId: id, estado: 'EN_FIRMA', firmasDetectadas: { gte: input.firmasRequeridas } },
            data: { estado: 'FIRMADO', firmadoEn: new Date() },
        })
        if (count) console.log(`Plantilla ${id}: ${count} certificado(s) en firma pasaron a FIRMADO al bajar las firmas requeridas`)
    }
    return aPlantilla(await obtenerFila(id))
}

/**
 * Reemplaza el PDF de diseño (versión +1). Los campos se conservan: si alguno está en una página
 * que el nuevo diseño no tiene, 422 `INVALID_TEMPLATE_FIELDS`. El archivo anterior se borra después
 * de guardar el nuevo.
 */
export async function reemplazarDiseno(id: number, archivo: ArchivoSubido, adminId?: number): Promise<PlantillaPublica> {
    const actual = await obtenerFila(id)
    const info = await validarDiseno(archivo.buffer)
    const fields: Record<string, string> = {}
    camposDe(actual).forEach((campo, i) => {
        if (campo.pagina > info.paginas) fields[`campos[${i}].pagina`] = `El nuevo diseño tiene ${info.paginas} ${info.paginas === 1 ? 'página' : 'páginas'}`
    })
    if (Object.keys(fields).length) {
        throw unprocessable('INVALID_TEMPLATE_FIELDS', 'Hay campos en páginas que el nuevo diseño no tiene: muévelos o quítalos antes de reemplazarlo.', fields)
    }

    const archivoDiseno = nuevoNombrePlantilla()
    const ruta = rutaPlantilla(archivoDiseno) as string
    await escribirArchivoAtomico(ruta, archivo.buffer)
    try {
        const resultado = await prisma.plantillaCertificado.updateMany({
            where: { id, version: actual.version, archivoDiseno: actual.archivoDiseno },
            data: {
                archivoDiseno,
                archivoOriginal: nombreOriginal(archivo),
                tamanoBytes: info.tamanoBytes,
                paginas: info.paginas,
                anchoPt: info.anchoPt,
                altoPt: info.altoPt,
                version: { increment: 1 },
            },
        })
        if (resultado.count === 0) throw plantillaCambiada()
    } catch (error) {
        await borrarArchivo(ruta).catch(() => undefined)
        throw error
    }
    await borrarArchivo(rutaPlantilla(actual.archivoDiseno)).catch((error: unknown) => {
        console.warn(`No se pudo borrar el diseño anterior de la plantilla ${id}:`, error instanceof Error ? error.message : error)
    })
    console.log(`Diseño de la plantilla de certificado ${id} reemplazado por el administrador ${adminId ?? '?'}`)
    return aPlantilla(await obtenerFila(id))
}

/**
 * Borra una plantilla sin certificados (de ningún estado). Bloquea su fila (`FOR UPDATE`): una
 * emisión simultánea que la use espera y luego falla por la FK, en vez de quedar sin plantilla.
 */
export async function eliminarPlantilla(id: number, adminId?: number): Promise<void> {
    const archivo = await prisma.$transaction(async (tx) => {
        const filas = await tx.$queryRaw<{ archivo: string }[]>`
            SELECT archivo_diseno AS archivo FROM plantillas_certificado WHERE id = ${id} FOR UPDATE`
        if (!filas.length) throw plantillaNoEncontrada()
        const certificados = await tx.certificado.count({ where: { plantillaId: id } })
        if (certificados > 0) {
            throw conflict('TEMPLATE_IN_USE', `La plantilla tiene ${certificados} ${certificados === 1 ? 'certificado' : 'certificados'}: desactívala en lugar de borrarla.`)
        }
        await tx.plantillaCertificado.delete({ where: { id } })
        return filas[0].archivo
    })
    await borrarArchivo(rutaPlantilla(archivo)).catch((error: unknown) => {
        console.warn(`No se pudo borrar el diseño de la plantilla ${id}:`, error instanceof Error ? error.message : error)
    })
    console.log(`Plantilla de certificado ${id} eliminada por el administrador ${adminId ?? '?'}`)
}

/**
 * PDF de diseño para el editor. Si otra petición lo reemplaza justo entre leer la fila y leer el
 * archivo, se vuelve a leer la fila una vez.
 */
export async function disenoDePlantilla(id: number): Promise<{ bytes: Buffer, plantilla: PlantillaPublica }> {
    for (let intento = 0; ; intento++) {
        const fila = await obtenerFila(id)
        try {
            return { bytes: leerDisenoDePlantilla(fila.archivoDiseno), plantilla: aPlantilla(fila) }
        } catch (error) {
            if (intento > 0 || !(error instanceof HttpError) || error.status !== 404) throw error
        }
    }
}

// ─── Vista previa ────────────────────────────────────────────────────────────

/**
 * Aviso de la vista previa: los del estampado, más la configuración incompleta y, si no entran
 * todos en el encabezado, uno final `MAS_AVISOS`.
 */
export interface AvisoVistaPrevia {
    campo: string | null
    codigo: AvisoEstampado['codigo'] | 'URL_VERIFICACION_NO_CONFIGURADA' | 'MAS_AVISOS'
    mensaje: string
}

/** Datos de ejemplo: nombre largo con tildes y ñ para comprobar fuentes y cajas. */
export const DATOS_EJEMPLO = {
    nombre: 'María José Ñahuinlla Güemes',
    documento: 'DNI 12345678',
    detalle: 'Ponencia: «Inteligencia artificial aplicada a la agricultura familiar»',
    horas: 40,
} as const

const NUMERO_EJEMPLO = '000123'
const ALEATORIO_EJEMPLO = '7KQ2XM'

/** Como mucho 2 vistas previas a la vez en el proceso (pdf-lib ocupa la CPU) y 10 esperando. */
const limitarVistaPrevia = limitarConcurrencia(2, 10, () => new HttpError(503, 'PDF_BUSY', 'Hay muchas vistas previas generándose. Intenta nuevamente en unos segundos.', undefined, 5))

/**
 * PDF de vista previa con datos de ejemplo (o los que envíe el panel) y los campos guardados o los
 * que se están editando (sin guardarlos). El código y la URL del QR son de ejemplo con el prefijo y
 * la URL del panel vigentes; el PDF no corresponde a ningún certificado.
 */
export async function vistaPrevia(id: number, input: VistaPreviaInput): Promise<{ bytes: Uint8Array, avisos: AvisoVistaPrevia[] }> {
    const plantilla = await prisma.plantillaCertificado.findUnique({ where: { id }, include: { evento: true } })
    if (!plantilla) throw plantillaNoEncontrada()
    const campos = input.campos === undefined ? camposDe(plantilla) : await validarCampos(input.campos, plantilla.paginas)

    let textoTipo: string
    if (input.tipoCodigo) {
        const tipo = await tipoPorCodigo(input.tipoCodigo)
        if (!tipo) throw unprocessable('CERTIFICATE_TYPE_NOT_FOUND', `No existe el tipo de certificado ${input.tipoCodigo}.`, { tipoCodigo: 'Tipo desconocido' })
        textoTipo = tipo.textoImpreso
    } else {
        const tipo = await prisma.tipoCertificado.findFirst({ where: { activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] })
        textoTipo = tipo?.textoImpreso ?? 'PARTICIPANTE'
    }

    const configuracion = await configuracionCertificados()
    const codigo = `${configuracion.prefijo}-${plantilla.evento.fechaInicio.getUTCFullYear()}-${NUMERO_EJEMPLO}-${ALEATORIO_EJEMPLO}`
    const avisos: AvisoVistaPrevia[] = []
    let urlVerificacion: string
    if (configuracion.baseVerificacion) {
        urlVerificacion = urlVerificacionCertificado(configuracion.baseVerificacion, codigo)
    } else {
        urlVerificacion = `https://ejemplo.invalid/verificar/${codigo}`
        if (campos.some((campo) => campo.tipo === 'QR')) {
            avisos.push({ campo: null, codigo: 'URL_VERIFICACION_NO_CONFIGURADA', mensaje: 'Falta la URL del panel (Sistema): el QR de la vista previa es de ejemplo y no se podrán generar certificados hasta configurarla.' })
        }
    }

    const datosEnviados = input.datos ?? {}
    const datos: DatosCertificado = {
        nombre: datosEnviados.nombre || DATOS_EJEMPLO.nombre,
        tipo: textoTipo,
        codigo,
        fechaEmision: aColumnaFecha(datosEnviados.fechaEmision || fechaLima()),
        horas: datosEnviados.horas !== undefined ? datosEnviados.horas : plantilla.horasPorDefecto ?? DATOS_EJEMPLO.horas,
        evento: plantilla.evento.nombre,
        eventoCorto: plantilla.evento.nombreCorto,
        documento: datosEnviados.documento || DATOS_EJEMPLO.documento,
        detalle: datosEnviados.detalle !== undefined ? datosEnviados.detalle : DATOS_EJEMPLO.detalle,
        urlVerificacion,
    }

    const diseno = leerDisenoDePlantilla(plantilla.archivoDiseno)
    const resultado = await limitarVistaPrevia(() => estampar({ diseno, campos, datos, codigo, generacion: nuevaGeneracion() }))
    return { bytes: resultado.bytes, avisos: [...avisos, ...resultado.avisos] }
}

/** Tope del encabezado `X-Avisos` (los proxies y el BFF limitan el tamaño de los encabezados). */
const MAX_ENCABEZADO_AVISOS = 3500

/**
 * `X-Avisos` = `encodeURIComponent(JSON)` (Node rechaza caracteres fuera de latin1 en los
 * encabezados). Si no entran todos, se recortan y el último dice cuántos faltan.
 */
export function encabezadoAvisos(avisos: readonly AvisoVistaPrevia[]): string {
    const codificar = (lista: readonly AvisoVistaPrevia[]) => encodeURIComponent(JSON.stringify(lista))
    const completo = codificar(avisos)
    if (completo.length <= MAX_ENCABEZADO_AVISOS) return completo
    const masAvisos = (faltan: number): AvisoVistaPrevia => ({ campo: null, codigo: 'MAS_AVISOS', mensaje: `Y ${faltan} avisos más.` })
    const incluidos: AvisoVistaPrevia[] = []
    for (const aviso of avisos) {
        const prueba = [...incluidos, aviso, masAvisos(avisos.length - incluidos.length - 1)]
        if (codificar(prueba).length > MAX_ENCABEZADO_AVISOS) break
        incluidos.push(aviso)
    }
    return codificar([...incluidos, masAvisos(avisos.length - incluidos.length)])
}

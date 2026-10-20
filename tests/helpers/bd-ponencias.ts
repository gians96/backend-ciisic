/**
 * BD en memoria de las ponencias especializadas (spec 019): implementa justo las consultas de Prisma
 * que usa el módulo (igualdad, `in`, `not`, `lt`, `gt`, `contains`, `AND`, `OR` y filtros por
 * relación) para probar cupos, cruces y liberaciones con el comportamiento real y no con respuestas
 * fijas. `$transaction` restaura el estado si la función lanza, como un rollback.
 */
type Fila = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

type Modelo = 'ponencias' | 'asistentes' | 'inscripciones'

export interface EstadoBd {
    ponencias: Fila[]
    asistentes: Fila[]
    inscripciones: Fila[]
    secuencia: Record<Modelo, number>
}

const COMPUESTAS = ['ponenciaId_asistenteId', 'tipoDocumentoId_numeroDocumento']

function coincide(valor: unknown, condicion: unknown): boolean {
    if (condicion === null) return valor === null || valor === undefined
    if (condicion instanceof Date) return valor instanceof Date && valor.getTime() === condicion.getTime()
    if (typeof condicion === 'object') {
        return Object.entries(condicion as Fila).every(([operador, esperado]) => {
            const v = valor as never
            switch (operador) {
                case 'in': return (esperado as unknown[]).includes(valor)
                case 'not': return esperado === null ? valor !== null && valor !== undefined : valor !== esperado
                case 'lt': return v < (esperado as never)
                case 'gt': return v > (esperado as never)
                case 'contains': return String(valor ?? '').toLowerCase().includes(String(esperado).toLowerCase())
                case 'equals': return valor === esperado
                default: throw new Error(`Operador no soportado por la BD de pruebas: ${operador}`)
            }
        })
    }
    return valor === condicion
}

export function crearBdPonencias() {
    const bd: EstadoBd = { ponencias: [], asistentes: [], inscripciones: [], secuencia: { ponencias: 0, asistentes: 0, inscripciones: 0 } }
    const tabla = (modelo: Modelo) => bd[modelo]

    const relacion = (modelo: Modelo, fila: Fila, campo: string): { fila: Fila | undefined, modelo: Modelo } | null => {
        if (modelo === 'inscripciones' && campo === 'ponencia') return { fila: bd.ponencias.find((p) => p.id === fila.ponenciaId), modelo: 'ponencias' }
        if (modelo === 'inscripciones' && campo === 'asistente') return { fila: bd.asistentes.find((a) => a.id === fila.asistenteId), modelo: 'asistentes' }
        return null
    }

    function cumple(modelo: Modelo, fila: Fila, where: Fila = {}): boolean {
        return Object.entries(where).every(([campo, condicion]) => {
            if (campo === 'AND') return [condicion].flat().every((c) => cumple(modelo, fila, c as Fila))
            if (campo === 'OR') return [condicion].flat().some((c) => cumple(modelo, fila, c as Fila))
            const rel = relacion(modelo, fila, campo)
            if (rel) return Boolean(rel.fila) && cumple(rel.modelo, rel.fila as Fila, condicion as Fila)
            return coincide(fila[campo], condicion)
        })
    }

    const aplanar = (where: Fila): Fila =>
        Object.entries(where).reduce<Fila>((acc, [clave, valor]) => (COMPUESTAS.includes(clave) ? { ...acc, ...(valor as Fila) } : { ...acc, [clave]: valor }), {})

    /** Las respuestas llevan siempre las relaciones que el módulo pide con `include` o `select`. */
    function conRelaciones(modelo: Modelo, fila: Fila | undefined): Fila | null {
        if (!fila) return null
        if (modelo !== 'inscripciones') return { ...fila }
        return {
            ...fila,
            ponencia: bd.ponencias.find((p) => p.id === fila.ponenciaId),
            asistente: bd.asistentes.find((a) => a.id === fila.asistenteId),
            registradoPor: null,
            asistenciaPor: null,
        }
    }

    const ahora = () => new Date()
    function crear(modelo: Modelo, data: Fila, porDefecto: Fila = {}): Fila {
        const fila = { id: ++bd.secuencia[modelo], creadoEn: ahora(), actualizadoEn: ahora(), ...porDefecto, ...data }
        tabla(modelo).push(fila)
        return fila
    }

    function delegado(modelo: Modelo, porDefecto: Fila = {}, unicas: string[][] = []) {
        const buscar = (where: Fila) => tabla(modelo).find((f) => cumple(modelo, f, aplanar(where)))
        return {
            findUnique: jest.fn(async ({ where }: { where: Fila }) => conRelaciones(modelo, buscar(where))),
            findFirst: jest.fn(async ({ where }: { where?: Fila } = {}) => conRelaciones(modelo, tabla(modelo).find((f) => cumple(modelo, f, where)))),
            findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: { where?: Fila, orderBy?: Fila | Fila[], skip?: number, take?: number } = {}) => {
                let filas = tabla(modelo).filter((f) => cumple(modelo, f, where))
                const criterios = [orderBy ?? []].flat() as Fila[]
                filas = [...filas].sort((a, b) => {
                    for (const criterio of criterios) {
                        const [campo, sentido] = Object.entries(criterio)[0] as [string, string]
                        const x = a[campo] as never, y = b[campo] as never
                        if (x < y) return sentido === 'asc' ? -1 : 1
                        if (x > y) return sentido === 'asc' ? 1 : -1
                    }
                    return 0
                })
                return filas.slice(skip, take === undefined ? undefined : skip + take).map((f) => conRelaciones(modelo, f))
            }),
            count: jest.fn(async ({ where }: { where?: Fila } = {}) => tabla(modelo).filter((f) => cumple(modelo, f, where)).length),
            groupBy: jest.fn(async ({ by, where }: { by: string[], where?: Fila }) => {
                const grupos = new Map<unknown, number>()
                for (const f of tabla(modelo).filter((x) => cumple(modelo, x, where))) grupos.set(f[by[0]], (grupos.get(f[by[0]]) ?? 0) + 1)
                return [...grupos.entries()].map(([clave, total]) => ({ [by[0]]: clave, _count: { _all: total } }))
            }),
            create: jest.fn(async ({ data }: { data: Fila }) => {
                for (const columnas of unicas) {
                    if (tabla(modelo).some((f) => columnas.every((c) => f[c] === data[c]))) {
                        const { Prisma } = jest.requireActual('@prisma/client')
                        throw new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' })
                    }
                }
                return conRelaciones(modelo, crear(modelo, data, porDefecto))
            }),
            update: jest.fn(async ({ where, data }: { where: Fila, data: Fila }) => {
                const fila = buscar(where)
                if (!fila) throw new Error(`${modelo}: fila no encontrada`)
                Object.assign(fila, data, { actualizadoEn: ahora() })
                return conRelaciones(modelo, fila)
            }),
            updateMany: jest.fn(async ({ where, data }: { where?: Fila, data: Fila }) => {
                const filas = tabla(modelo).filter((f) => cumple(modelo, f, where))
                filas.forEach((f) => Object.assign(f, data, { actualizadoEn: ahora() }))
                return { count: filas.length }
            }),
            delete: jest.fn(async ({ where }: { where: Fila }) => {
                const i = tabla(modelo).findIndex((f) => cumple(modelo, f, aplanar(where)))
                if (i >= 0) bd[modelo].splice(i, 1)
                return {}
            }),
            deleteMany: jest.fn(async ({ where }: { where?: Fila } = {}) => {
                const quedan = tabla(modelo).filter((f) => !cumple(modelo, f, where))
                const count = tabla(modelo).length - quedan.length
                bd[modelo] = quedan
                return { count }
            }),
        }
    }

    const cliente: Fila = {
        ponenciaEspecializada: delegado('ponencias', { publicada: true, modalidad: 'PRESENCIAL', precio: 0, cupo: null, orden: 0, ponenteBio: null, ponenteFoto: null, ponenteExterno: false }),
        asistentePonencia: delegado('asistentes', { correo: null, celular: null, procedencia: null }, [['tipoDocumentoId', 'numeroDocumento']]),
        inscripcionPonencia: delegado('inscripciones', { estado: 'INSCRITO', asistioEn: null, asistenciaPorId: null, registradoPorId: null, esFueraDeHorario: false, canceladoEn: null, motivoCancelacion: null }, [['ponenciaId', 'asistenteId']]),
        $queryRaw: jest.fn(async () => []),
    }
    // Las transacciones se ejecutan de una en una: equivale al `SELECT … FOR UPDATE` de la fila de la ponencia
    let cola: Promise<unknown> = Promise.resolve()
    cliente.$transaction = jest.fn((operaciones: ((tx: Fila) => Promise<unknown>) | Promise<unknown>[]) => {
        if (Array.isArray(operaciones)) return Promise.all(operaciones)
        const ejecutar = async () => {
            const respaldo = JSON.parse(JSON.stringify(bd), (_clave, valor) => (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(valor) ? new Date(valor) : valor)) as EstadoBd
            try {
                return await operaciones(cliente)
            } catch (error) {
                Object.assign(bd, respaldo)
                throw error
            }
        }
        const resultado = cola.then(ejecutar)
        cola = resultado.catch(() => undefined)
        return resultado
    })
    return { bd, cliente }
}

const MINUTO = 60_000
/** Instante relativo a ahora (las reglas de tiempo del servicio usan el reloj real). */
export const desdeAhora = (minutos: number) => new Date(Date.now() + minutos * MINUTO)

function sembrar(bd: EstadoBd, modelo: Modelo, fila: Fila): Fila {
    const completa = { id: ++bd.secuencia[modelo], creadoEn: new Date(), actualizadoEn: new Date(), ...fila }
    bd[modelo].push(completa)
    return completa
}

/** Ponencia del evento 2, en una hora y de 45 minutos (hora de Lima), publicada, gratuita y sin cupo. */
export function sembrarPonencia(bd: EstadoBd, datos: Fila = {}): Fila {
    const inicio = (datos.horaInicio as Date | undefined) ?? desdeAhora(60)
    const fin = (datos.horaFin as Date | undefined) ?? new Date(inicio.getTime() + 45 * MINUTO)
    const dia = inicio.toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
    return sembrar(bd, 'ponencias', {
        eventoId: 2, tema: 'Tema', fecha: new Date(`${dia}T00:00:00.000Z`), ambiente: 'Laboratorio 1', modalidad: 'PRESENCIAL', precio: 0, cupo: null,
        ponenteNombre: 'Ponente', ponenteBio: null, ponenteFoto: null, ponenteExterno: false, publicada: true, orden: 0,
        ...datos, horaInicio: inicio, horaFin: fin,
    })
}

export function sembrarAsistente(bd: EstadoBd, datos: Fila = {}): Fila {
    return sembrar(bd, 'asistentes', { tipoDocumentoId: 'dni', numeroDocumento: '12345678', nombres: 'Ana', apellidos: 'Pérez', correo: null, celular: null, procedencia: null, ...datos })
}

export function sembrarInscripcion(bd: EstadoBd, datos: Fila): Fila {
    return sembrar(bd, 'inscripciones', {
        estado: 'INSCRITO', origen: 'LANDING', registradoPorId: null, asistioEn: null, asistenciaPorId: null, esFueraDeHorario: false, canceladoEn: null, motivoCancelacion: null, ...datos,
    })
}

export function reiniciar(bd: EstadoBd) {
    Object.assign(bd, { ponencias: [], asistentes: [], inscripciones: [], secuencia: { ponencias: 0, asistentes: 0, inscripciones: 0 } })
}

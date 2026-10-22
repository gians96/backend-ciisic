import {
    asesoresPorSeccion,
    claveDeTexto,
    compararCiclos,
    construirFilas,
    contar,
    filtrarAlcance,
    filtrarFilas,
    normalizarDocumento,
    opcionesDeFiltro,
    resumir,
    situacionDe,
    type AsesorConSecciones,
    type EstudianteBase,
    type InscripcionBase,
} from '../../src/api/advisory/services/seguimiento'

const estudiante = (id: number, extra: Partial<EstudianteBase> = {}): EstudianteBase => ({
    id,
    documento: `6000000${id}`,
    codigo: `262101000${id}`,
    correo: `262101000${id}@undc.edu.pe`,
    nombre: `ALUMNO ${id}`,
    celular: null,
    carrera: 'INGENIERÍA DE SISTEMAS',
    ciclo: 'I',
    turno: 'M',
    seccion: 'A',
    ...extra,
})

const inscripcion = (id: number, estado: string, extra: Partial<InscripcionBase> = {}): InscripcionBase => ({
    id,
    estado,
    monto: 40,
    fechaPago: new Date('2026-10-19T00:00:00.000Z'),
    documento: null,
    correo: null,
    codigoEstudiante: null,
    ...extra,
})

const ASESORES: AsesorConSecciones[] = [
    { id: 1, nombre: 'DRA. ANGOMA ASTUCURI MIRIAM', secciones: [{ ciclo: 'I', seccion: 'A' }] },
    { id: 2, nombre: 'MG. MARIA LAURA BARRERA CAJACHAGUA', secciones: [{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }] },
    { id: 3, nombre: 'MG. SIN ALUMNOS', secciones: [{ ciclo: 'X', seccion: 'Z' }] },
]
const SECCIONES = asesoresPorSeccion(ASESORES)

describe('situación y normalización', () => {
    it('solo una inscripción aprobada es «pagó»', () => {
        expect(situacionDe('APROBADO')).toBe('PAGADO')
        expect(situacionDe('PENDIENTE')).toBe('EN_REVISION')
        expect(situacionDe('EN_REVISION')).toBe('EN_REVISION')
        expect(situacionDe('RECHAZADO')).toBe('RECHAZADO')
        expect(situacionDe('CANCELADO')).toBe('RECHAZADO')
        expect(situacionDe(null)).toBe('SIN_INSCRIPCION')
        expect(situacionDe(undefined)).toBe('SIN_INSCRIPCION')
    })

    it('completa a ocho dígitos el DNI al que Excel le quitó el cero', () => {
        expect(normalizarDocumento(2442123)).toBe('02442123')
        expect(normalizarDocumento(' 60344947 ')).toBe('60344947')
        expect(normalizarDocumento('x123')).toBe('X123')
        expect(normalizarDocumento(null)).toBe('')
    })

    it('compara textos sin acentos ni mayúsculas', () => {
        expect(claveDeTexto('  MG.  CÁRDENAS   Lino ')).toBe('mg. cardenas lino')
    })

    it('ordena los ciclos como en la carrera y deja los desconocidos al final', () => {
        expect(['X', 'II', 'VIII', 'I', 'IV', 'ZZ', 'VI'].sort(compararCiclos)).toEqual(['I', 'II', 'IV', 'VI', 'VIII', 'X', 'ZZ'])
    })
})

describe('construirFilas', () => {
    it('busca la inscripción por documento, luego por código y por último por correo', () => {
        const alumnos = [
            estudiante(1, { documento: '02442123' }),
            estudiante(2, { codigo: '2621010002' }),
            estudiante(3, { correo: 'ana@undc.edu.pe' }),
            estudiante(4),
        ]
        const filas = construirFilas(alumnos, SECCIONES, [
            inscripcion(10, 'APROBADO', { documento: '2442123' }), // sin el cero
            inscripcion(11, 'PENDIENTE', { codigoEstudiante: '2621010002' }),
            inscripcion(12, 'RECHAZADO', { correo: 'ANA@undc.edu.pe' }),
        ], true)
        const porId = Object.fromEntries(filas.map((f) => [f.id, f]))
        expect(porId[1]).toMatchObject({ situacion: 'PAGADO', coincidencia: 'DOCUMENTO', inscripcionId: 10, monto: 40, fechaPago: '2026-10-19' })
        expect(porId[2]).toMatchObject({ situacion: 'EN_REVISION', coincidencia: 'CODIGO', inscripcionId: 11 })
        expect(porId[3]).toMatchObject({ situacion: 'RECHAZADO', coincidencia: 'CORREO', inscripcionId: 12 })
        expect(porId[4]).toMatchObject({ situacion: 'SIN_INSCRIPCION', coincidencia: null, inscripcionId: null, monto: null, fechaPago: null })
    })

    it('sin «pagos.ver» conserva la situación pero oculta montos y fechas', () => {
        const [fila] = construirFilas([estudiante(1)], SECCIONES, [inscripcion(10, 'APROBADO', { codigoEstudiante: '2621010001' })], false)
        expect(fila).toMatchObject({ situacion: 'PAGADO', monto: null, fechaPago: null })
        expect(contar([fila], false).recaudado).toBeNull()
    })

    it('si dos inscripciones comparten un dato gana la de mejor situación', () => {
        const [fila] = construirFilas([estudiante(1)], SECCIONES, [
            inscripcion(20, 'RECHAZADO', { codigoEstudiante: '2621010001' }),
            inscripcion(21, 'APROBADO', { codigoEstudiante: '2621010001' }),
            inscripcion(22, 'PENDIENTE', { codigoEstudiante: '2621010001' }),
        ], true)
        expect(fila.inscripcionId).toBe(21)
    })

    it('agrega los asesores de la sección y ordena por ciclo, sección y nombre', () => {
        const filas = construirFilas([
            estudiante(1, { ciclo: 'II', seccion: 'B', nombre: 'ZETA' }),
            estudiante(2, { ciclo: 'I', seccion: 'A', nombre: 'BETA' }),
            estudiante(3, { ciclo: 'I', seccion: 'A', nombre: 'ALFA' }),
            estudiante(4, { ciclo: 'III', seccion: 'C' }),
        ], SECCIONES, [], true)
        expect(filas.map((f) => f.id)).toEqual([3, 2, 1, 4])
        expect(filas[0].asesores.map((a) => a.id)).toEqual([1, 2])
        expect(filas[2].asesores.map((a) => a.id)).toEqual([2])
        expect(filas[3].asesores).toEqual([])
    })
})

describe('filtros y resúmenes', () => {
    const filas = construirFilas([
        estudiante(1, { nombre: 'ÁLVAREZ PÉREZ ANA' }),
        estudiante(2, { nombre: 'BRAVO LUNA CARLOS' }),
        estudiante(3, { nombre: 'CÁRDENAS RÍOS DIEGO', ciclo: 'II', seccion: 'B', turno: 'T' }),
        estudiante(4, { nombre: 'DÍAZ SOTO ELENA', ciclo: 'III', seccion: 'C' }),
    ], SECCIONES, [
        inscripcion(10, 'APROBADO', { codigoEstudiante: '2621010001', monto: 40 }),
        inscripcion(11, 'PENDIENTE', { codigoEstudiante: '2621010002', monto: 40 }),
        inscripcion(12, 'APROBADO', { codigoEstudiante: '2621010003', monto: 100 }),
    ], true)

    it('filtra por asesor, ciclo, sección y turno', () => {
        expect(filtrarAlcance(filas, { asesorId: 1 }).map((f) => f.id)).toEqual([1, 2])
        expect(filtrarAlcance(filas, { asesorId: 2 }).map((f) => f.id)).toEqual([1, 2, 3])
        expect(filtrarAlcance(filas, { ciclo: 'ii', seccion: 'b' }).map((f) => f.id)).toEqual([3])
        expect(filtrarAlcance(filas, { turno: 't' }).map((f) => f.id)).toEqual([3])
        expect(filtrarAlcance(filas, {})).toHaveLength(4)
    })

    it('filtra por situación y «no pagaron» incluye todo menos lo aprobado', () => {
        expect(filtrarFilas(filas, { situacion: 'PAGADO' }).map((f) => f.id)).toEqual([1, 3])
        expect(filtrarFilas(filas, { situacion: 'EN_REVISION' }).map((f) => f.id)).toEqual([2])
        expect(filtrarFilas(filas, { situacion: 'NO_PAGADO' }).map((f) => f.id)).toEqual([2, 4])
        expect(filtrarFilas(filas, { situacion: 'SIN_INSCRIPCION' }).map((f) => f.id)).toEqual([4])
    })

    it('la búsqueda ignora acentos y mayúsculas y pide todas las palabras', () => {
        expect(filtrarFilas(filas, { q: 'alvarez ana' }).map((f) => f.id)).toEqual([1])
        expect(filtrarFilas(filas, { q: 'cardenas' }).map((f) => f.id)).toEqual([3])
        expect(filtrarFilas(filas, { q: '2621010004' }).map((f) => f.id)).toEqual([4])
        expect(filtrarFilas(filas, { q: 'alvarez diego' })).toEqual([])
    })

    it('cuenta pagaron, revisión, rechazados y recaudado solo de lo aprobado', () => {
        expect(contar(filas, true)).toEqual({
            alumnos: 4, pagaron: 2, enRevision: 1, rechazados: 0, sinInscripcion: 1, noPagaron: 2, avance: 0.5, recaudado: 140,
        })
        expect(contar([], true)).toMatchObject({ alumnos: 0, avance: 0, recaudado: 0 })
    })

    it('resume por ciclo, sección y asesor, y avisa de los alumnos sin asesor', () => {
        const resumen = resumir(filas, ASESORES, true)
        expect(resumen.totales.alumnos).toBe(4)
        expect(resumen.porCiclo.map((c) => [c.ciclo, c.alumnos, c.pagaron])).toEqual([['I', 2, 1], ['II', 1, 1], ['III', 1, 0]])
        expect(resumen.porSeccion.map((s) => `${s.ciclo}-${s.seccion}:${s.alumnos}`)).toEqual(['I-A:2', 'II-B:1', 'III-C:1'])
        expect(resumen.porSeccion[0]).toMatchObject({ turnos: ['M'], asesores: [{ id: 1 }, { id: 2 }] })
        expect(resumen.porAsesor.map((a) => [a.id, a.alumnos, a.pagaron])).toEqual([[1, 2, 1], [2, 3, 2], [3, 0, 0]])
        expect(resumen.alumnosSinAsesor).toBe(1)
    })

    it('ofrece como opciones de filtro todo el padrón, ordenado', () => {
        const opciones = opcionesDeFiltro(filas, ASESORES)
        expect(opciones.ciclos).toEqual(['I', 'II', 'III'])
        expect(opciones.secciones).toEqual([{ ciclo: 'I', seccion: 'A' }, { ciclo: 'II', seccion: 'B' }, { ciclo: 'III', seccion: 'C' }])
        expect(opciones.turnos).toEqual(['M', 'T'])
        expect(opciones.asesores.map((a) => a.id)).toEqual([1, 2, 3])
    })
})

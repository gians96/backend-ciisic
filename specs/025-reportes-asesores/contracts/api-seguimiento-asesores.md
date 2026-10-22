# Contrato: seguimiento por asesor (spec 025)

Todas las rutas son de administración (`/api/v1/events/:eventId/advisory/…`, Bearer de staff). Las cuentas por
evento (Tesorero, Comisión) solo acceden a los eventos que tienen asignados (`403 EVENT_NOT_ASSIGNED`).

| Ruta | Permiso | Límite |
|---|---|---|
| `GET …/advisory/summary` | `reportes.ver` | 120/min por cuenta |
| `GET …/advisory/students` | `reportes.ver` | 120/min por cuenta |
| `GET …/advisory/export` | `reportes.exportar` | 20/min por cuenta |
| `POST …/advisory/import` | `reportes.gestionar` (global) | 10 cada 15 min por cuenta |

Sin `pagos.ver` (Comisión) `monto`, `fechaPago` y `recaudado` van en `null` y `conPago` es `false`.

## Filtros (query)

`asesorId` (entero), `ciclo`, `seccion`, `turno` (texto, sin distinguir mayúsculas), `situacion`
(`PAGADO`·`EN_REVISION`·`RECHAZADO`·`SIN_INSCRIPCION`·`NO_PAGADO`) y `q` (nombre, código, DNI o correo; sin acentos,
todas las palabras). Un valor inválido responde `422 VALIDATION_ERROR` con `fields`. `summary` usa solo los cuatro
primeros (el alcance); `students` y `export` usan todos.

## `GET …/advisory/summary`

```json
{
  "success": true,
  "data": {
    "semestre": "2026-2",
    "importadoEn": "2026-10-21T22:00:00.000Z",
    "generadoEn": "2026-10-21T22:41:00.000Z",
    "hayPadron": true,
    "conPago": true,
    "opciones": {
      "ciclos": ["I", "II"],
      "secciones": [{ "ciclo": "I", "seccion": "A" }],
      "turnos": ["M", "T"],
      "asesores": [{ "id": 7, "nombre": "DRA. ANGOMA ASTUCURI MIRIAM" }]
    },
    "totales": { "alumnos": 434, "pagaron": 118, "enRevision": 6, "rechazados": 2, "sinInscripcion": 308, "noPagaron": 316, "avance": 0.2719, "recaudado": 5860 },
    "porCiclo": [{ "ciclo": "I", "alumnos": 39, "pagaron": 15, "...": "mismos contadores" }],
    "porSeccion": [{ "ciclo": "I", "seccion": "A", "turnos": ["M"], "asesores": [{ "id": 7, "nombre": "…" }], "alumnos": 39, "...": "" }],
    "porAsesor": [{ "id": 7, "nombre": "…", "secciones": [{ "ciclo": "I", "seccion": "A" }], "alumnos": 39, "...": "" }],
    "alumnosSinAsesor": 0
  }
}
```

- `avance` = `pagaron / alumnos` (0 a 1). `noPagaron` = `alumnos − pagaron`.
- Sin padrón: `hayPadron: false`, `semestre: null` y todo en cero (la pantalla ofrece cargarlo).
- Con un alcance (asesor, ciclo, sección o turno) `porAsesor` solo trae a los asesores con alumnos en él.

## `GET …/advisory/students`

`data` es un arreglo; `meta` es `{ page, pageSize, total }` (`pageSize` por defecto 50, máximo 200).

```json
{
  "id": 12, "codigo": "2621030019", "documento": "40083357", "nombre": "BLANCAS BONARREGO DIEGO JAVIER",
  "correo": "2621030019@undc.edu.pe", "celular": "902847061", "carrera": "INGENIERÍA DE SISTEMAS",
  "ciclo": "I", "turno": "M", "seccion": "A",
  "asesores": [{ "id": 7, "nombre": "DRA. ANGOMA ASTUCURI MIRIAM" }],
  "situacion": "PAGADO", "estadoInscripcion": "APROBADO", "inscripcionId": 344, "coincidencia": "DOCUMENTO",
  "monto": 40, "fechaPago": "2026-10-19"
}
```

`situacion`: `PAGADO` (inscripción `APROBADO`), `EN_REVISION` (`PENDIENTE` o `EN_REVISION`), `RECHAZADO` (`RECHAZADO` o
`CANCELADO`) o `SIN_INSCRIPCION` (entonces `estadoInscripcion`, `inscripcionId`, `coincidencia`, `monto` y `fechaPago`
son `null`). `coincidencia`: `DOCUMENTO`, `CODIGO` o `CORREO`.

## `GET …/advisory/export?formato=xlsx|pdf`

Descarga (`Content-Disposition: attachment`, `Cache-Control: no-store`) calculada en el momento. `formato` por defecto
`xlsx`; otro valor → `422`.

- **Excel**: hojas `Resumen` (indicadores, por ciclo, por ciclo y sección con asesores y, si no es de un solo asesor,
  por asesor), `Alumnos` (el listado filtrado, con autofiltro y la situación a color), `Pagaron` y `No pagaron` (del
  alcance elegido).
- **PDF**: A4 apaisado con indicadores, el resumen por sección y asesor y el listado.
- Con `asesorId` es el reporte de ese docente y el archivo se llama como él (`DRA. ANGOMA ASTUCURI MIRIAM.xlsx`);
  `404 ADVISOR_NOT_FOUND` si no existe. Sin él: `Seguimiento <evento> [ciclo [sección]] <fecha>`.
- `409 PADRON_NOT_LOADED` si el evento no tiene padrón.

## `POST …/advisory/import`

`multipart/form-data`: `file` (`.xlsx`, ≤ 5 MB) y `semestre` opcional (`AAAA-1` o `AAAA-2`). Con `?simular=true` solo
valida y cuenta (`200`); sin él reemplaza el padrón y los asesores del evento (`201`).

```json
{ "success": true, "data": { "semestre": "2026-2", "estudiantes": 434, "asesores": 25, "secciones": 29, "advertencias": [], "aplicado": true } }
```

Formato del Excel: hoja `ESTUDIANTES <semestre>` con las columnas `DNI`, `CODIGO`, `ALUMNO`, `CICLO`, `SECCIÓN`
(obligatorias) y `EMAIL`, `CELULAR`, `CARRERA`, `TURNO`, `DISTRITO`, `PROVINCIA`, `DEPARTAMENTO`, `SEMESTRE`; hoja
`RESUMEN` con una tabla de cabeceras `CICLO`, `SECCIÓN` y `ASESORES` (un docente por línea de la celda). Las demás
hojas se ignoran.

Errores `422`: `INVALID_FILE_TYPE` (no es `.xlsx`), `INVALID_FILE_CONTENT` (no es un ZIP), `PADRON_FILE_INVALID`,
`PADRON_SHEET_NOT_FOUND`, `PADRON_COLUMNS_MISSING`, `PADRON_EMPTY`, `PADRON_SEMESTER_REQUIRED`; `413 UPLOAD_LIMIT_EXCEEDED`
si pesa más de 5 MB.

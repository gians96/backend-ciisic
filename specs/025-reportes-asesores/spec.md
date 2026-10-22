# Feature Specification: Reportes de seguimiento por asesor

**Created**: 2026-10-21 · **Status**: Implementado en el backend (panel en su repo, spec 016) · **Contrato**: [`contracts/api-seguimiento-asesores.md`](contracts/api-seguimiento-asesores.md)

**Input**: la facultad lleva el avance de inscripción de sus estudiantes en un Excel (`INCRITOS CONGRESO.xlsx`):
una hoja `ESTUDIANTES 2026-2` (434 alumnos con DNI, código, ciclo, turno y sección), una hoja `RESUMEN` con la tabla
«ciclo · sección · cuántos pagaron · asesores» y el cruce a mano con un export de inscripciones
(`¿Pago? = PAGO` si el código aparece en el export). Cada sección tiene de 1 a 4 docentes **asesores**, que necesitan
su propia lista (quién pagó y quién no, con sus datos) y la facultad un panorama general. Todo se rehacía a mano y
quedaba viejo al día siguiente.

Se agrega un apartado **Reportes** que cruza el padrón de estudiantes con las inscripciones del evento **en cada
consulta** (tiempo real), con filtros, resumen y descarga en Excel o PDF, por asesor o general.

## Decisiones

- **El pago no se guarda**: el padrón (`padron_estudiantes`) solo tiene los datos de la facultad; la situación de
  cada alumno se calcula al consultar, cruzando con `inscripciones`. Así un voucher aprobado hace un minuto ya cuenta.
- **Situación** (`PAGADO`, `EN_REVISION`, `RECHAZADO`, `SIN_INSCRIPCION`): *pagó* es **solo** una inscripción
  `APROBADO`. `PENDIENTE` y `EN_REVISION` son «en revisión» (el alumno ya envió su voucher), `RECHAZADO` y
  `CANCELADO` son «rechazado» y no cuentan como pago. *No pagaron* = todo lo que no es `PAGADO`. El Excel manual
  marcaba «PAGO» a quien aparecía en el export **sin mirar el estado**: con los datos de octubre eran 126 «PAGO»
  contra 118 aprobados (6 en revisión y 2 rechazados).
- **Cruce**: se busca la inscripción del evento por **documento** (DNI; Excel pierde el cero inicial, por eso se
  completa a 8 dígitos y se consultan ambas formas), luego por **código de estudiante** y por último por **correo**. Si
  dos inscripciones coinciden, vale la de mejor situación y, a igualdad, la más reciente. La fila informa con qué dato
  coincidió (`coincidencia`).
- **Asesores**: nombre tal como lo escribe la facultad (`DRA. ANGOMA ASTUCURI MIRIAM`); no son cuentas del panel. Un
  asesor atiende varias secciones y una sección tiene varios asesores: un alumno cuenta una vez en los totales y una
  vez por cada uno de sus asesores. Los nombres que difieren en mayúsculas, acentos o espacios son el mismo asesor.
- **Fuente de los asesores**: la hoja `RESUMEN` de la facultad puede quedar desactualizada. Con el Excel de octubre, 13 de las 29
  secciones no coincidían con la **designación oficial de asesores** del 2 de octubre (p. ej. la Mg. Barrera solo atiende el ciclo I; el
  ciclo II-A es de la Dra. Daga y el Dr. Torres; II-B solo del Mg. Alejos; VIII-A de los Mg. Leonidas y Silva; VIII-B de los Mg. Sierra,
  Huarancca y el Dr. Ferreyros; X-B del Mg. Cárdenas y la Dra. Muñoz Meza). Quien carga el padrón debe cargar el Excel **ya corregido**.
- **Carga**: se sube el mismo Excel de la facultad (`POST …/advisory/import`). **Reemplaza** el padrón y los asesores
  del evento (ninguna otra tabla depende de ellos). `?simular=true` valida y cuenta sin guardar, para confirmar antes.
  El semestre sale del nombre de la hoja (`ESTUDIANTES 2026-2`) y puede corregirse (`semestre`).
- **Alcance de los filtros**: asesor, ciclo, sección y turno **delimitan** el grupo (el resumen y los reportes lo
  usan); situación y búsqueda solo afectan al listado y a la hoja «Alumnos» de la descarga. Las opciones de los filtros
  salen siempre de todo el padrón.
- **Montos**: sin `pagos.ver` (Comisión) llegan la situación y los conteos, pero `monto`, `fechaPago` y `recaudado`
  van en `null` y el reporte no lleva columnas de dinero.
- **Formatos**: Excel con `exceljs` (carga diferida: solo cuando se importa o se descarga) y PDF con `pdfkit`
  (sin Chromium); ambos se arman en memoria.

## User Scenarios & Testing

### User Story 1 - Veo cómo van mis estudiantes (Priority: P1)

1. **Given** el padrón está cargado, **When** abro Reportes, **Then** veo alumnos, pagaron, en revisión, rechazados,
   sin inscripción, avance y recaudado, por ciclo, por sección (con sus asesores) y por asesor.
2. **Given** el tesorero aprueba un voucher, **When** actualizo, **Then** el alumno pasa a «Pagó» sin recargar nada más.

### User Story 2 - Descargo la lista de un docente (Priority: P1)

1. **Given** elijo un asesor, **When** descargo Excel, **Then** el archivo se llama como el docente y trae Resumen,
   Alumnos, Pagaron y No pagaron con los datos de contacto de sus alumnos de todas sus secciones.
2. **Given** descargo PDF, **Then** obtengo el mismo reporte listo para imprimir.

### User Story 3 - Filtro y descargo en general (Priority: P1)

1. **Given** filtro por ciclo, sección, turno, situación o búsqueda, **Then** el listado, el resumen y la descarga
   respetan el filtro.

### User Story 4 - Cargo el padrón (Priority: P2)

1. **Given** soy Owner o Administrador, **When** subo el Excel con «Simular», **Then** veo cuántos alumnos, asesores y
   secciones se leerán y las advertencias (códigos repetidos, secciones sin asesor…); **When** confirmo, **Then** se
   reemplaza el padrón del evento.

## Requirements

- **FR-001**: `GET /v1/events/:eventId/advisory/summary` devuelve semestre, totales, por ciclo, por sección, por
  asesor, alumnos sin asesor y las opciones de filtro; respeta `asesorId`, `ciclo`, `seccion` y `turno`.
- **FR-002**: `GET /v1/events/:eventId/advisory/students` lista paginado (`page`, `pageSize` ≤ 200) con todos los
  filtros, más `situacion` (`PAGADO`, `EN_REVISION`, `RECHAZADO`, `SIN_INSCRIPCION`, `NO_PAGADO`) y `q`.
- **FR-003**: `GET /v1/events/:eventId/advisory/export?formato=xlsx|pdf` descarga el reporte con los mismos filtros;
  con `asesorId` es el reporte de ese docente. Sin padrón responde `409 PADRON_NOT_LOADED`.
- **FR-004**: un filtro inválido responde `422 VALIDATION_ERROR` (nunca se ignora: el reporte saldría sin filtrar).
- **FR-005**: `POST /v1/events/:eventId/advisory/import` (multipart `file` `.xlsx`, ≤ 5 MB) valida la firma ZIP y
  reemplaza el padrón y los asesores en una transacción; errores `PADRON_FILE_INVALID`, `PADRON_SHEET_NOT_FOUND`,
  `PADRON_COLUMNS_MISSING`, `PADRON_EMPTY` y `PADRON_SEMESTER_REQUIRED` (todos `422`).
- **FR-006**: permisos `reportes.ver` (implica `inscripciones.ver`), `reportes.exportar` (implica `reportes.ver`), ambos
  por evento (Tesorero y Comisión elegible), y `reportes.gestionar` (global: Owner y Administrador).
- **FR-007**: límites por cuenta: lecturas 120/min, descargas 20/min y cargas 10 cada 15 min.

## Success Criteria

- **SC-001**: con el Excel de octubre el padrón queda en 434 alumnos y 29 secciones sin advertencias (25 asesores con la hoja RESUMEN original, 26 con la designación oficial), y los conteos por
  sección coinciden con la hoja RESUMEN de la facultad salvo los 8 envíos en revisión o rechazados.
- **SC-002**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios.

# Feature Specification: Seguimiento por curso y docente según SIVIRENO

**Created**: 2026-10-23 · **Status**: Implementado en el backend (panel en su repo, spec 025; datos en producción pendientes) · **Contrato**: [`contracts/api-cursos-sivireno.md`](contracts/api-cursos-sivireno.md)

**Input**: la spec 033 repartió a los alumnos con los «grupos de asesoría» de la foto de la facultad y los docentes preguntaban *de dónde salió* cada alumno. Se cambia la fuente de verdad a **SIVIRENO**
(programación académica, sincronizada en JP): cada **curso** (carga lectiva: asignatura + ciclo + sección + turno + docente) tiene sus alumnos matriculados; un alumno puede estar en varios cursos y repetir.
Se pidió: (1) que el docente vea **los alumnos de sus cursos**, con trazabilidad de quién pagó; (2) un **listado completo** (alumnos con sus secciones, cursos y docentes); (3) una pestaña **«Por curso»** donde,
al elegir un curso, salga su listado de alumnos y quién pagó. La designación de la foto se retira.

## Decisiones

- **Docente = el de SIVIRENO**, identificado por su `id_docente` (`asesores.jp_docente_id`, único por evento). Un docente existente se enlaza por ese id, luego por su **DNI** y por último por su nombre (sin título ni orden de
  palabras: `claveDeNombre`); conserva nombre, DNI y enlace personal. Los demás se crean con el nombre de SIVIRENO y, si está en el JSON de DNI, su DNI. Los que ya existían y no dictan cursos no se tocan.
- **Curso = carga lectiva**, sin plegar (ciclo, sección y turno como vienen): `padron_cursos` (único por `jp_carga_id`) y `padron_matriculas` (alumno ↔ curso). Se reemplazan enteros en cada carga, como el padrón.
- **Los estudiantes** son los del padrón (que guarda el DNI para el cruce de pagos; SIVIRENO no lo trae) **más** los matriculados que falten, sin DNI (se cruzan por código y correo). Quien no tiene matrícula en SIVIRENO se queda con su sección
  anterior, sin curso ni docente. Cruce por código de estudiante y, si no, por correo.
- **Un alumno cuenta una vez** en los totales, una vez en cada ciclo, sección y curso en que está, y una vez por cada docente de sus cursos. Con cursos, `secciones` y `asesores` de la fila salen de ellos; sin cursos (Excel) siguen como en la 033.
  Su sección «principal» (columnas `ciclo`, `turno`, `seccion`) es la de más cursos; a igualdad, la del ciclo mayor.
- **Cada quien ve solo lo suyo**: `filtrarAlcance` gana `cursoId` y filtra y **proyecta por curso** (ciclo, sección, turno, docente y curso deben cumplirse en el mismo curso). La vista del docente (DNI o enlace) trae sus cursos y los alumnos de ellos con
  solo sus cursos; la del ciclo, los cursos de ese ciclo con su docente (dato institucional). Siguen sin salir DNI, correo, montos ni los cursos o el docente de otro.
- **Un docente de SIVIRENO** solo cambia de nombre y DNI desde el panel: sus secciones (`asesores_secciones`) se derivan de sus cursos al cargar. `padron_secciones` también se rellena desde los cursos para que las consultas agregadas no cambien.
- **Script, no endpoint** (como la 033): `npm run padron:desde-jp` lee SIVIRENO **solo con `SELECT`** desde `JP_DATABASE_URL` (variable de la consola, no del API) y toma los DNI de los docentes de un JSON fuera del repositorio (`--docentes`).
  Simula por defecto; `--aplicar` escribe todo en una transacción. Ver [`docs/operacion.md`](../../docs/operacion.md).
- Se **elimina** la designación por grupos de la foto (`designacion.ts`, `matriculas-jp.ts`, `plegarSeccion`). Cargar el Excel de la facultad después de SIVIRENO borra los cursos (el Excel no los tiene).

## User Scenarios & Testing

### User Story 1 - El docente ve a los alumnos de sus cursos (Priority: P1)

1. **Given** el docente tiene DNI y dicta 2 cursos, **When** entra a la página común, **Then** ve sus 2 cursos con cuántos matriculados pagaron y la lista de sus alumnos, cada uno con el curso o los cursos suyos en que está.
2. **When** un alumno repite un curso de otro docente, **Then** el docente solo ve el curso suyo de ese alumno.

### User Story 2 - La facultad ve quién pagó por curso (Priority: P1)

1. **Given** Reportes, **When** abro la pestaña «Por curso», **Then** veo los 120 cursos con docente, matriculados y quién pagó, y «Ver alumnos» muestra su listado.
2. **When** descargo el Excel, **Then** trae «Por curso» y la hoja «Listado completo» con una fila por alumno y curso.

### User Story 3 - La facultad recarga desde SIVIRENO (Priority: P1)

1. **When** corro el script sin `--aplicar`, **Then** veo cursos, matrículas, alumnos, docentes con y sin DNI y cursos y alumnos por docente.
2. **When** lo corro con `--aplicar`, **Then** el padrón, los cursos, las matrículas y los docentes quedan al día y sus enlaces no cambian.

## Requirements

- **FR-001**: migración aditiva `20261026120000_padron_cursos` (`padron_cursos`, `padron_matriculas`, `asesores.jp_docente_id`).
- **FR-002**: `GET …/advisory/summary|students|export` aceptan `cursoId` (`422` si es inválido; `404 COURSE_NOT_FOUND` al descargar un curso inexistente) y el resumen trae `porCurso` y `opciones.cursos`.
- **FR-003**: las vistas públicas traen `cursos` solo del alcance de quien consulta (prueba automática de que no salen otro curso, otro docente, DNI, correo ni montos).
- **FR-004**: `cursos-jp.ts` es puro y probado; el script no escribe nada sin `--aplicar` ni sin `JP_DATABASE_URL`.
- **FR-005**: con cursos, quien no tiene curso queda sin docente.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios.
- **SC-002**: con SIVIRENO 2026-2 de Sistemas: **120 cursos**, **2666 matrículas**, **43 docentes**, 434 alumnos (3 sin curso); cada docente por su DNI ve sus alumnos distintos (Zamudio 143, Daga 39, Muñoz Meza 89) y cada curso, tantos alumnos como dice SIVIRENO.

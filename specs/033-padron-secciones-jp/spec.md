# Feature Specification: Secciones por curso (JP) en el seguimiento por asesor

**Created**: 2026-10-23 · **Status**: Implementado en el backend (panel en su repo, spec 023; datos en producción pendientes) · **Contrato**: [`contracts/api-secciones-por-curso.md`](contracts/api-secciones-por-curso.md)

**Input**: el padrón de seguimiento (spec 025) traía **una sola sección por alumno**, la del Excel de la facultad. En JP (programación académica,
sincronizada con SIVIRENO) la sección va **ligada al curso**: un mismo alumno cursa en varias (teoría `A` y laboratorio `A1`, o un curso repetido de otro
ciclo). La facultad publicó la «Designación de asesores CIISIC 2026» (ciclo, turno, sección y docentes). Se pidió: (1) que cada alumno salga con **todas** sus
secciones y con el asesor de cada una según esa designación; (2) que **los alumnos sigan siendo los mismos** (todos los del padrón son de la matrícula 2026-2) y la cantidad
de alumnos no cambie aunque uno aparezca en varias secciones; (3) registrar el **DNI** de los docentes para que la página común (`/docentes`, spec 028) les muestre sus
secciones y alumnos.

## Decisiones

- **Grupo de asesoría**: el ciclo y la sección de la designación (`I-A, II-A, II-B, III-A, IV-A, IV-B, VI-A1, VI-A2, VI-B1, VI-B2, VIII-A, VIII-B, X-A, X-B`), cada uno con su
  turno (`M`, `T`, `N`). Cada sección de JP se **pliega** a un grupo con este orden (`plegarSeccion`): coincidencia exacta; quitando los dígitos finales (`II-A1 → II-A`);
  mismo ciclo y turno si la designación tiene **un solo** grupo ahí (`IV-C` de la tarde → `IV-B`); si no, queda sin asesor y se avisa.
- **Tabla `padron_secciones`** `(evento_id, codigo, ciclo, seccion, turno, cursos)`: una fila por alumno y grupo, con cuántos cursos lleva en él. Va unida por clave compuesta
  a `padron_estudiantes` con `ON DELETE CASCADE` (el padrón se reemplaza entero en cada carga). `padron_estudiantes.ciclo/turno/seccion` quedan como la sección **principal** (la de
  más cursos; a igualdad, el ciclo mayor). La migración rellena la tabla con la sección que ya tenía cada alumno: al desplegar, nada cambia hasta cargar los datos nuevos.
- **Los estudiantes son los del padrón** (no los de JP): JP solo dice en qué secciones cursa cada uno, cruzando por código de estudiante y, si JP no lo trae, por correo. Quien no tiene
  matrícula en JP conserva su sección anterior; quien está en JP y no en el padrón no se agrega. JP **no trae el DNI** de los alumnos (el cruce de pagos ya cae a código y correo), así que el DNI y
  el lugar de residencia del padrón actual se conservan.
- **Un alumno cuenta una vez** en los totales, en cada ciclo y en cada sección en que cursa, y una vez por cada uno de sus asesores. `FilaSeguimiento` agrega `secciones` (la principal primero,
  cada una con sus `asesores`) y `asesores` es la unión sin repetir. Los filtros de ciclo, sección, turno y asesor deben cumplirse en **la misma** sección.
- **Cada quien ve solo lo suyo**: `filtrarAlcance` **proyecta** al alumno a las secciones dentro del alcance (su ciclo, turno y sección pasan a ser los de la primera). La vista del docente y la de
  un ciclo, y sus descargas, solo muestran etiquetas (`«VI-A1»`) de secciones de su alcance y **nunca** otras secciones ni otros asesores.
- **La designación y los DNI no se versionan**: viven en un JSON fuera del repositorio (`services/designacion.ts` valida el formato). Los docentes que no están en ella no se tocan.
- **Script, no endpoint**: `npm run padron:desde-jp` (`src/database/sincronizarPadronJp.ts`) lee JP **solo con `SELECT`** (sesión de solo lectura) desde `JP_DATABASE_URL`, una variable de la consola y
  no del API (el API no se conecta a JP y no guarda sus credenciales). Simula por defecto; `--aplicar` escribe todo en una transacción. Ver [`docs/operacion.md`](../../docs/operacion.md).
- El Excel de la facultad sigue funcionando: cada alumno entra con su única sección (`cursos = 1`).

## User Scenarios & Testing

### User Story 1 - El docente ve a todos los alumnos de sus secciones (Priority: P1)

1. **Given** un alumno cursa en `VI-A1` y repite un curso de `II-B`, **When** el docente de `II-B` entra con su DNI, **Then** ve al alumno solo con `II-B`; el de `VI-A1`, solo con `VI-A1`.
2. **When** consulta el panel (Reportes), **Then** el alumno aparece una vez en el total y en cada una de sus secciones, con todos sus asesores.

### User Story 2 - La facultad recarga las secciones desde JP (Priority: P1)

1. **Given** la designación de asesores en un JSON, **When** corro el script sin `--aplicar`, **Then** veo cuántos alumnos van a cada grupo, cuántos están en varios, quiénes no tienen matrícula en JP y qué cambia en cada docente.
2. **When** lo corro con `--aplicar`, **Then** el padrón, las secciones, el DNI y los grupos de los docentes quedan actualizados y sus enlaces personales no cambian.

## Requirements

- **FR-001**: migración aditiva `20261025140000_padron_secciones` (tabla, FK en cascada y relleno desde `padron_estudiantes`).
- **FR-002**: `GET …/advisory/summary|students|export` y las vistas públicas calculan con todas las secciones del alumno; los totales cuentan al alumno una vez.
- **FR-003**: las vistas públicas (docente, DNI y ciclo) no contienen otras secciones fuera de su alcance, ni DNI, correo, montos ni otros asesores (prueba automática).
- **FR-004**: `plegarSeccion` y `consolidarPadron` son puras y probadas; el script no escribe nada sin `--aplicar` ni sin `JP_DATABASE_URL`.
- **FR-005**: `POST …/advisory/import` (Excel) sigue igual y guarda una sección por alumno en `padron_secciones`.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios.
- **SC-002**: con la matrícula 2026-2 de Sistemas, cada docente de la designación entra con su DNI y ve sus secciones y sus alumnos; ningún alumno del padrón queda fuera.

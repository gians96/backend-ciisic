# Contrato: cursos y docentes de SIVIRENO en el seguimiento (spec 034)

Cambio **aditivo**: no se quita ni se renombra nada; el panel anterior sigue funcionando (ignora los campos nuevos). Sin cursos cargados (padrón del Excel) todo responde como antes, con `cursos: []`.

## Administración (staff, `reportes.ver`)

`GET /v1/events/:eventId/advisory/summary` agrega:

- `porCurso`: `[{ id, codigo, nombre, ciclo, seccion, turno, docente: { id, nombre } | null, alumnos, pagaron, enRevision, rechazados, sinInscripcion, noPagaron, avance, recaudado }]` en orden de ciclo, sección y nombre.
- `opciones.cursos`: `[{ id, codigo, nombre, ciclo, seccion, turno, docente }]` (todos los cursos del padrón, para los filtros).

`GET …/advisory/students` — cada fila agrega `cursos` (`[{ id, codigo, nombre, ciclo, seccion, turno, docente }]`) y `secciones` y `asesores` salen de ellos (el docente de cada curso). Con filtros de curso, docente, ciclo, sección o
turno, la fila sale **proyectada** a los cursos que los cumplen en el mismo curso (`ciclo`, `seccion` y `turno` pasan a ser los de la primera sección en el alcance).

Filtro nuevo en `summary`, `students` y `export`: `cursoId` (id de `padron_cursos`). Inválido → `422 VALIDATION_ERROR` (`fields.cursoId`). `export?cursoId=` de un curso inexistente → `404 COURSE_NOT_FOUND`.

`GET …/advisory/export?formato=xlsx|pdf`:
- Excel: tabla «Por curso» en «Resumen», columna «Cursos» en las hojas de alumnos y la hoja **«Listado completo»** (una fila por alumno y curso: curso, código, ciclo, sección, turno, docente, código del alumno, DNI, alumno, correo, celular,
  situación y, con `pagos.ver`, monto y fecha). Un alumno sin cursos sale en una fila con el curso vacío. Con `cursoId` el reporte es el de ese curso (título «CURSO · II-B»).
- PDF: tabla «Por curso».

`GET|POST|PUT …/advisory/advisors`: cada docente agrega `desdeSivireno` (`true` si viene de SIVIRENO) y `cursos` (cuántos dicta). A un docente con `desdeSivireno` el `PUT` solo le cambia nombre y DNI; las `secciones` enviadas se ignoran.

## Vistas públicas (sin sesión)

`GET /v1/public/advisor`, `POST /v1/public/advisor/lookup` y `GET /v1/public/cycle` (y sus `/export`):

- `cursos` de la vista: `[{ id, codigo, nombre, ciclo, seccion, turno, alumnos, pagaron, enRevision, rechazados, sinInscripcion, noPagaron, avance }]` — los del docente, o los del ciclo (con `docente`: nombre, dato institucional).
- Cada alumno agrega `cursos`: `[{ id, codigo, nombre, ciclo, seccion, turno }]` (en la vista del ciclo, con `docente`), **solo los del alcance** de quien consulta.
- Sigue sin salir DNI, correo, montos, otros cursos ni otros docentes.

## Base de datos

- `padron_cursos (id, evento_id, jp_carga_id, codigo, nombre, ciclo, turno, seccion, asesor_id, docente_nombre)`: único `(evento_id, jp_carga_id)`; `asesor_id` → `asesores` `SET NULL`.
- `padron_matriculas (evento_id, codigo, curso_id)`: PK las tres; FK en cascada a `padron_estudiantes (evento_id, codigo)` y a `padron_cursos`.
- `asesores.jp_docente_id`: único por evento, `NULL` si no viene de SIVIRENO.
- `padron_secciones` y `asesores_secciones` se rellenan derivadas de los cursos.

## Orden de despliegue

Backend primero (migración aditiva y respuestas con `cursos`); el panel tolera su ausencia. Los datos se cargan después con `npm run padron:desde-jp`.

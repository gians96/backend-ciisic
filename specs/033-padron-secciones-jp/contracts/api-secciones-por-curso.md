# Contrato: secciones por curso en el seguimiento por asesor (spec 033)

Cambio **aditivo**: no se quita ni se renombra nada; el panel y la landing anteriores siguen funcionando.

## Administración (staff, `reportes.ver`)

`GET /v1/events/:eventId/advisory/students` — cada fila (`FilaSeguimiento`) agrega:

```json
{
  "ciclo": "VI", "seccion": "A1", "turno": "M",
  "secciones": [
    { "ciclo": "VI", "seccion": "A1", "turno": "M", "cursos": 5, "asesores": [{ "id": 7, "nombre": "MG. RAMIREZ PACHECO LUIS ENRIQUE" }] },
    { "ciclo": "II", "seccion": "B", "turno": "T", "cursos": 1, "asesores": [{ "id": 3, "nombre": "MG. ALEJOS CUADROS HENRY YURI" }] }
  ],
  "asesores": [ …unión de los de todas sus secciones, sin repetir… ]
}
```

- `ciclo`, `seccion` y `turno` siguen siendo la sección **principal** (la de más cursos); con filtros de ciclo, sección, turno o asesor son los de la primera sección **dentro del alcance** y
  `secciones` solo trae las del alcance (el alumno sale proyectado).
- `GET …/advisory/summary`: `totales` cuenta al alumno una vez; `porCiclo` y `porSeccion` lo cuentan en cada ciclo y sección en que cursa; `porAsesor`, una vez por asesor.
  `opciones.ciclos|secciones|turnos` salen de todas las secciones.
- `GET …/advisory/export`: el Excel y el PDF agregan la columna «Otras secciones» (las demás secciones del alumno dentro del alcance; vacía casi siempre).

## Vistas públicas (sin sesión)

`GET /v1/public/advisor`, `POST /v1/public/advisor/lookup` y `GET /v1/public/cycle` (y sus `/export`): cada alumno agrega `secciones: string[]` con las etiquetas (`«VI-A1»`) de sus
secciones **dentro del alcance** (las del docente, o las del ciclo). Sigue sin salir DNI, correo, montos, otras secciones ni otros asesores. `ciclo`, `seccion` y `turno` son los de la primera.

## Importación del Excel

`POST …/advisory/import` no cambia. Cada alumno queda con su única sección en `padron_secciones` (`cursos = 1`).

## Base de datos

`padron_secciones (evento_id, codigo, ciclo, seccion, turno, cursos)` — PK `(evento_id, codigo, ciclo, seccion)`, índice `(evento_id, ciclo, seccion)`, FK `(evento_id, codigo)` →
`padron_estudiantes` con `ON DELETE CASCADE`. Migración `20261025140000_padron_secciones` (rellena desde `padron_estudiantes`).

## Orden de despliegue

Backend primero (migración y respuesta con `secciones`); el panel tolera su ausencia (`?? []`). Los datos nuevos se cargan después con `npm run padron:desde-jp`.

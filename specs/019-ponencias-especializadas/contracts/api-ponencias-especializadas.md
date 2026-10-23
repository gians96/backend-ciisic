# Contrato — Ponencias especializadas

Respuestas `{ success, data, meta? }`; errores `{ success: false, code, message, fields? }`. Fechas `YYYY-MM-DD`
y horas `HH:mm` en hora de Lima. Rutas bajo `/api`.

## Ponencia

```json
{
  "id": 4, "eventoId": 2, "tema": "Bases de datos vectoriales",
  "fecha": "2026-10-27", "horaInicio": "12:00", "horaFin": "12:45", "duracionMin": 45,
  "ambiente": "Laboratorio 2", "modalidad": "PRESENCIAL",
  "precio": 0, "esGratuita": true, "cupo": 20,
  "ponente": { "nombre": "Ph.D. Edwin Roque Tito", "bio": "…", "foto": "/images/ponentes/2026/especializados/edwin-roque.webp", "externo": false },
  "orden": 2
}
```

- Panel (`aPonencia`): además `publicada`, `inscritos`, `asistentes`, `cuposDisponibles` (`null` = sin límite).
- Sitio (`aPonenciaPublica`): además `cuposDisponibles` y `llena`; **sin** `inscritos`, `asistentes` ni `publicada`.
- `modalidad`: `PRESENCIAL` | `VIRTUAL`. `precio` 0 = gratuita. `foto`: ruta del sitio (`/images/…`) o URL https.
- Spec 032: además `coponentes` (siempre un arreglo, `[]` si no hay) con los demás ponentes de un tema compartido, y la entrada acepta `coponentes` (máx. 3); ver `../../032-ponencias-coponentes/contracts/api-ponencias-coponentes.md`.

## Panel (sesión de staff)

| Método y ruta | Permiso | Notas |
|---|---|---|
| `GET /v1/events/:eventId/specialized-talks` | `especializadas.ver` ∨ `.gestionar` | `?fecha=`, `?modalidad=`; ordenadas por fecha, hora y `orden` |
| `POST /v1/events/:eventId/specialized-talks` | `.gestionar` | 201; cuerpo: `tema`, `fecha`, `horaInicio`, `horaFin`, `ambiente`, `modalidad` (def. `PRESENCIAL`), `precio` (def. 0), `cupo` (opcional, `null` = sin límite), `ponente{nombre,bio?,foto?,externo?}`, `publicada` (def. `true`), `orden` |
| `PUT /v1/specialized-talks/:id` | `.gestionar` | todos los campos opcionales; `ponente` parcial; `cupo: null` quita el límite |
| `DELETE /v1/specialized-talks/:id` | `.gestionar` | borra también las inscripciones canceladas |
| `GET /v1/events/:eventId/specialized-talk-registrations` | `.ver` | filtros abajo; `meta: { page, pageSize, total, asistieron }` |
| `POST /v1/specialized-talks/:id/registrations` | `.inscribir` | alta manual; cuerpo = persona; 201 con la inscripción |
| `PATCH /v1/specialized-talk-registrations/:id` | `.inscribir` | `{ estado?: "INSCRITO"\|"CANCELADO", asistente?: { nombres, apellidos, correo, celular, procedencia } }`; vacío en correo/celular/procedencia los borra |
| `POST /v1/specialized-talks/:id/check-in` | `.asistencia` | cuerpo = persona; 201 |
| `DELETE /v1/specialized-talk-registrations/:id/attendance` | `.asistencia` | anula la asistencia; la inscripción sigue vigente |

Las cuentas por evento (Tesorero, Comisión) solo operan en sus eventos (`403 EVENT_NOT_ASSIGNED`).

### Persona (cuerpo de alta manual y de puerta)

```json
{ "tipoDocumento": "dni", "numeroDocumento": "12345678", "nombres": "Ana", "apellidos": "Pérez",
  "correo": "ana@gmail.com", "celular": "987654321", "procedencia": "INTERNO" }
```

`tipoDocumento` (`dni` | `ce`) y `numeroDocumento` son obligatorios; el resto es opcional (vacío = ausente).
`procedencia`: `INTERNO` | `EXTERNO`. Con DNI los nombres salen de la consulta oficial; los enviados solo
se usan si la consulta no responde. Sin ninguno: `422 NAMES_REQUIRED` con `fields.nombres` y/o `fields.apellidos`.

### Filtros de las inscripciones

`ponenciaId`, `fecha`, `modalidad`, `estado` (`INSCRITO`|`CANCELADO`), `asistencia` (`si`|`no`), `origen`
(`LANDING`|`STAFF`|`PUERTA`), `procedencia` (`INTERNO`|`EXTERNO`|`SIN_DATO`), `q` (documento, nombres,
apellidos, correo o celular; cada palabra debe aparecer), `page`, `pageSize` (≤ 100). Un valor inválido: `400 INVALID_FILTER`.

### Inscripción (fila del listado)

```json
{
  "id": 31, "estado": "INSCRITO", "origen": "LANDING", "creadoEn": "…", "canceladoEn": null, "motivoCancelacion": null,
  "asistioEn": null, "esFueraDeHorario": false,
  "asistente": { "id": 9, "tipoDocumento": "dni", "numeroDocumento": "12345678", "nombres": "Ana", "apellidos": "Pérez", "correo": null, "celular": null, "procedencia": null },
  "ponencia": { "id": 4, "tema": "…", "fecha": "2026-10-27", "horaInicio": "12:00", "horaFin": "12:45", "ambiente": "Laboratorio 2", "modalidad": "PRESENCIAL" },
  "registradoPor": { "id": 2, "nombres": "…", "apellidos": "…" }, "asistenciaPor": null
}
```

`motivoCancelacion`: `STAFF` | `CAMBIO_EN_PUERTA`.

### Respuesta de `check-in`

```json
{
  "id": 31, "inscripcionNueva": true, "asistioEn": "…", "esFueraDeHorario": false,
  "asistente": { "…": "…" },
  "ponencia": { "id": 4, "tema": "…", "ambiente": "Laboratorio 2", "cupo": 20, "inscritos": 14, "asistentes": 9 },
  "liberadas": [ { "inscripcionId": 28, "ponenciaId": 7, "tema": "…", "ambiente": "Aula 5" } ]
}
```

## API del sitio (token del evento, `X-Api-Key`)

### `GET /v1/site/specialized-talks`

Ponencias `publicada` del evento del token (esquema «Sitio» arriba).

### `POST /v1/site/specialized-talk-registrations`

```json
{ "asistente": { "tipoDocumento": "dni", "numeroDocumento": "12345678", "nombres": "Ana", "apellidos": "Pérez", "correo": "…", "celular": "…", "procedencia": "EXTERNO" },
  "ponenciaIds": [4, 12] }
```

201 con `{ asistente: { …documento enmascarado `****5678` }, inscripciones: [{ id, yaInscrito, ponencia }] }`.
Todo o nada. Límites: 1–4 ponencias sin repetir; `limiteInscripcion` (10 / 15 min por visitante) y
`limiteTokenInscripcion`. Nunca modifica a una persona que ya existe.

## Errores

| Código | Estado | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | cuerpo inválido (`fields`) |
| `NAMES_REQUIRED` | 422 | no hay nombres oficiales ni enviados |
| `PAID_TALK_UNAVAILABLE` | 422 | (sitio) la ponencia tiene precio > 0 |
| `TALK_NOT_FOUND` | 404 | no existe, no es del evento o (sitio) no está publicada |
| `REGISTRATION_NOT_FOUND` / `ATTENDANCE_NOT_FOUND` | 404 | la inscripción o la asistencia no existe |
| `TALK_FULL` | 409 | sin cupos |
| `SCHEDULE_CONFLICT` | 409 | (sitio) dos ponencias se cruzan; el mensaje nombra ambas |
| `TALK_ENDED` | 409 | (sitio) la ponencia ya terminó |
| `ALREADY_REGISTERED` | 409 | (alta manual) ya está inscrita |
| `ALREADY_ATTENDED` | 409 | cancelar a quien ya asistió |
| `ATTENDANCE_ALREADY_REGISTERED` | 409 | segunda lectura en puerta |
| `ROOM_CONFLICT` | 409 | ambiente presencial ocupado a esa hora |
| `CAPACITY_BELOW_REGISTERED` | 409 | cupo menor a los inscritos vigentes |
| `TALK_HAS_REGISTRATIONS` | 409 | eliminar con inscritos vigentes |
| `INVALID_HOURS` | 409 | fin ≤ inicio al editar |
| `INVALID_FILTER` | 400 | filtro inválido |
| `FORBIDDEN` / `EVENT_NOT_ASSIGNED` | 403 | sin permiso / evento no asignado |

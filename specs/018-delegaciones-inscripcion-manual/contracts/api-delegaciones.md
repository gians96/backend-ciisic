# Contrato — Delegaciones e inscripción manual (staff)

Base `/api/v1`. Staff: `Authorization: Bearer <jwt>` con la guarda de la spec 013
(`requirePermiso`; `401 SESSION_INVALIDATED`, `403 FORBIDDEN`). Errores
`{ "success": false, "code", "message", "fields"? }`.

Ambas funciones son **globales**: Owner y Administrador del sistema. Tesorero, Comisión y
participantes reciben `403 FORBIDDEN` (permisos `delegaciones.gestionar` e
`inscripciones.manual`, alcance `G`; el backend no exige evento asignado). Sin `pagos.ver` los
montos salen en `null` (spec 013).

## Delegaciones

Una delegación agrupa inscritos de un evento (un salón, un ciclo u otro grupo) con un delegado
opcional (una persona del padrón del evento). El nombre es único por evento.

### `GET /events/:eventId/delegations`

Lista las delegaciones del evento, activas primero y por nombre. `404 EVENT_NOT_FOUND` si el
evento no existe.

```json
{ "success": true, "data": [ {
  "id": 9, "eventoId": 2, "nombre": "Salón 5to A", "tipo": "SALON", "abreviatura": "5A",
  "activo": true,
  "delegado": { "id": 50, "nombres": "Ana", "apellidos": "Pérez", "tipoDocumento": "dni",
    "numeroDocumento": "12345678", "correo": "ana@undc.edu.pe" },
  "totalInscripciones": 12,
  "creadoEn": "2026-10-15T15:00:00.000Z", "actualizadoEn": "2026-10-15T15:00:00.000Z" } ] }
```

### `POST /events/:eventId/delegations`

Cuerpo: `{ "nombre": "Salón 5to A", "tipo"?: "SALON"|"CICLO"|"OTRO", "abreviatura"?: "5A",
"delegadoId"?: 50 }`. `tipo` por defecto `OTRO`; `nombre` de 2 a 80 caracteres (único en el
evento). `201` con la delegación creada (`totalInscripciones: 0`, `activo: true`).

| Estado | Código | Cuándo |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | El evento no existe |
| 404 | `PARTICIPANT_NOT_FOUND` | `delegadoId` sin participante |
| 409 | `DELEGATION_EXISTS` | Ya hay una delegación con ese nombre en el evento |
| 422 | `VALIDATION_ERROR` | Cuerpo inválido (nombre corto, `tipo` desconocido) |

### `GET /delegations/:id`

Detalle de una delegación (mismo objeto de la lista). `404 DELEGATION_NOT_FOUND`.

### `PATCH /delegations/:id`

Cuerpo con los campos a cambiar: `nombre`, `tipo`, `abreviatura`, `activo`, `delegadoId`
(`0` o `null` quita el delegado). Un cuerpo vacío no toca la BD y devuelve la delegación
actual. Mismos códigos de `POST` (404 `PARTICIPANT_NOT_FOUND` y 409 `DELEGATION_EXISTS`).

### `GET /delegations/:id/members`

Las inscripciones de la delegación (del evento de la delegación), paginadas con el mismo
`meta` del listado de inscritos y las mismas filas (`data[]` de
`GET /events/:eventId/inscriptions`): participante, tipo, clasificación, estado, fechas, y
`delegacion` incluido. Los montos y datos de pago solo salen con `pagos.ver`.

```
GET /v1/delegations/9/members?page=1&pageSize=25
```

```json
{ "success": true,
  "data": [ { "id": 130, "…": "…",
    "participante": { "id": 50, "nombres": "Ana", "…": "…" },
    "delegacion": { "id": 9, "nombre": "Salón 5to A", "tipo": "SALON", "abreviatura": "5A", "activo": true },
    "estado": { "codigo": "APROBADO", "nombre": "Aprobado" } } ],
  "meta": { "page": 1, "pageSize": 25, "total": 12 } }
```

`404 DELEGATION_NOT_FOUND` si la delegación no existe.

## Inscripción manual

### `POST /events/:eventId/manual-inscriptions`

Registra una inscripción con el **pago real** del staff (sin voucher): nace `APROBADO`, revisada
por quien la registra, con `codigoCredencial` nuevo. A diferencia de la cortesía, el número de
operación lo escribe el staff y es único en el sistema.

Cuerpo (exactamente uno de `participanteId` / `participante`):

| Campo | Tipo | Detalle |
|---|---|---|
| `participanteId` | number | Participante existente |
| `participante` | object | `{ tipoDocumento, numeroDocumento, nombres, apellidos, correo, celular }`; si el documento ya existe se reutiliza, si no se da de alta |
| `modalidadPago` | `"banco" \| "billetera" \| "efectivo"` | Obligatorio |
| `banco`, `tipoOperacion` | string | Solo con `banco` (obligatorios): `tipoOperacion` es `"directo"` o `"interbancario"` |
| `billeteraDigital` | string | Solo con `billetera` (obligatorio) |
| `numeroOperacion` | string | 3–100, único en el sistema, sin el prefijo `CORTESIA-` |
| `fechaPago` | `"AAAA-MM-DD"` | No futura (hora de Lima) |
| `monto` | number | Monto pagado, ≥ 0, a dos decimales |
| `descuento` | number | Por defecto `0` |
| `tipoInscripcionId`, `clasificacionId` | number | Del evento (el servidor no calcula precios) |
| `delegacionId` | number | Debe ser del evento y estar activa |
| `enviarCredencial` | boolean | Por defecto `false`; genera y envía la credencial como al aprobar |

`201`: la inscripción en el mismo formato del detalle
(`GET /inscriptions/:id`) más `credencialEnviada: true|false|null`:

```json
{ "success": true, "data": {
  "id": 130, "…": "…",
  "estado": { "codigo": "APROBADO", "nombre": "Aprobado" },
  "codigoCredencial": "K7Q2M9X4TB",
  "pago": { "modalidad": "efectivo", "monto": 150, "banco": null, "numeroOperacion": "OP-123",
    "tieneVoucher": false, "fechaPago": "2026-10-01" },
  "delegacion": { "id": 9, "nombre": "Salón 5to A", "tipo": "SALON", "abreviatura": "5A", "activo": true },
  "credencialEnviada": null } }
```

| Estado | Código | Cuándo |
|---|---|---|
| 404 | `EVENT_NOT_FOUND` | El evento no existe |
| 404 | `PARTICIPANT_NOT_FOUND` | `participanteId` sin participante |
| 404 | `INSCRIPTION_NOT_FOUND` | (raro) inscripción borrada durante el proceso |
| 409 | `ALREADY_REGISTERED` | La persona ya tiene inscripción en el evento |
| 409 | `OPERATION_ALREADY_REGISTERED` | Ese `numeroOperacion` ya se registró |
| 422 | `VALIDATION_ERROR` | Cuerpo inválido (sin persona, las dos formas, banco sin campos, fecha futura) |
| 422 | `REGISTRATION_TYPE_INVALID` | `tipoInscripcionId` de otro evento o inexistente |
| 422 | `CLASSIFICATION_INVALID` | `clasificacionId` inexistente |
| 422 | `DELEGATION_INVALID` | `delegacionId` inexistente o de otro evento |
| 422 | `DELEGATION_INACTIVE` | La delegación está desactivada |

## Filtro de inscripciones por delegación

`GET /events/:eventId/inscriptions` acepta `?delegacionId=9` (junto a los filtros existentes):
devuelve solo las inscripciones de esa delegación (del evento). Una delegación de otro evento no
filtra nada (`data: []`). Las filas incluyen `delegacion: { id, nombre } | null`.

# Contrato: delegaciones con convenio (spec 023)

Amplía [`api-delegaciones.md`](../../021-delegaciones/contracts/api-delegaciones.md) (spec 021) y
[`api-tipos-delegacion.md`](../../022-tipos-delegacion/contracts/api-tipos-delegacion.md) (spec 022).
**Reemplaza**: el pago conjunto de un solo voucher (`pago` con `numeroOperacion`/`voucher` en la
delegación), el campo `tipoInscripcionId` del registro público y `GET /v1/delegations/:id/voucher`.

Convenciones: respuestas `{ success, data }`; el evento del sitio sale **siempre** del token
(`X-Api-Key`); el cliente **nunca** envía precios, montos totales ni tipos.

## Tipos de contrato (categoría `DELEGACIONES`)

| Código | Cuándo | Precio (prod) |
|---|---|---|
| `delegacion_general` | presencial, menos de `minIntegrantes` | S/ 60 |
| `delegacion_grupal` | presencial, `minIntegrantes` o más | S/ 50 |
| `delegacion_virtual` | virtual, cualquier tamaño | S/ 30 |

`minIntegrantes` es 10 (`eventos.delegaciones_min_integrantes`).

## API del sitio (token del evento)

### `GET /api/v1/site/delegations/tarifa`

```json
{ "success": true, "data": { "minIntegrantes": 10, "precioEstandar": 60, "precioPromocional": 50, "virtual": { "precio": 30 } } }
```

`virtual` es `null` mientras el evento no tenga el tipo `delegacion_virtual`: la landing no ofrece
la modalidad.

### `GET /api/v1/site/delegations/link/:codigoLink`

Vista del delegado. `404 DELEGATION_NOT_FOUND` si no existe, está inactiva o es de otro evento.

```json
{
  "success": true,
  "data": {
    "id": 5, "nombre": "Ing. de Sistemas UNAT", "codigoLink": "9f3a2b1c4d5e6f70", "institucion": "UNAT",
    "modalidad": "PRESENCIAL", "representanteNombre": "Janeth Mariño Arroyo",
    "evento": { "id": 2, "codigo": "ciisic-viii-2026", "estado": "PUBLICADO", "inscripcionesAbiertas": true },
    "minIntegrantes": 10, "precioEstandar": 60, "precioPromocional": 50, "precioUnitario": 50,
    "totalIntegrantes": 24, "montoTotal": 1200, "faltanParaPromocional": null,
    "tipoInscripcion": { "id": 14, "codigo": "delegacion_grupal", "nombre": "DELEGACIONES PROMOCIONAL", "etiqueta": "sin kit", "modalidad": "PRESENCIAL" },
    "pago": { "totalAPagar": 1200, "declarado": 800, "verificado": 0, "saldo": 400, "cantidad": 2 },
    "integrantes": [{ "nombres": "Ana", "apellidos": "Ríos", "documento": "****5269", "estado": "PENDIENTE" }],
    "pagos": [{ "id": 1, "medio": "yape", "numeroOperacion": "****8877", "fechaPago": "2026-10-20", "monto": 500, "estado": "PENDIENTE", "creadoEn": "…" }]
  }
}
```

No expone el correo ni el teléfono del delegado, ni el motivo interno de un rechazo.
`integrantes` excluye a los `RECHAZADO` y `CANCELADO`.

### `POST /api/v1/site/delegations` (multipart)

Registra la delegación, sus integrantes y sus vouchers en **una transacción**.

| Campo | Tipo | Notas |
|---|---|---|
| `delegacion` | JSON | `{ nombre, institucion? }` |
| `representante` | JSON | `{ nombres, apellidos, tipoDocumento: dni\|ce, numeroDocumento, correo, celular, esIntegrante? }` (`esIntegrante` por defecto `true`: entra primero en la lista) |
| `participantes` | JSON | `[{ tipoDocumento, numeroDocumento, nombres, apellidos, correo, celular? }]`, hasta 200 |
| `modalidad` | texto | `PRESENCIAL` (por defecto) o `VIRTUAL` |
| `pagos` | JSON | `[{ modalidadPago: banco\|billetera, banco?, tipoOperacion?: directo\|interbancario, billeteraDigital?, numeroOperacion, fechaPago: AAAA-MM-DD, monto }]`, de 1 a 6 |
| `vouchers` | archivos | un archivo por pago, en el mismo orden (PDF/JPG/PNG/WebP, 5 MB c/u) |
| `codigoLink` | texto | opcional: se suma a la delegación que el staff creó (modalidad y tarifa de esa delegación) |

**`201`**: la vista del link más `registrados` y `omitidos`.

**Errores**: `409 REGISTRATION_CLOSED`, `422 VOUCHER_REQUIRED` (archivos ≠ pagos), `422 NO_PARTICIPANTS`,
`422 DELEGATION_MODALITY_NOT_AVAILABLE`, `409 OPERATION_ALREADY_REGISTERED`, `409 DUPLICATE_PARTICIPANT`,
`409 EMAIL_IN_USE`, `409 PARTICIPANT_ALREADY_REGISTERED`, `404 DELEGATION_NOT_FOUND` (link), `422 VALIDATION_ERROR`,
`422 INVALID_FILE_TYPE` / `INVALID_FILE_CONTENT`.

### `POST /api/v1/site/delegations/link/:codigoLink/participants` (JSON)

`{ participantes: [...] }` (1 a 200). Solo agrega: quien ya está en el grupo se omite. `201`: la
vista del link con `registrados` y `omitidos`. Los mismos errores de integrantes y `409 REGISTRATION_CLOSED`.

### `POST /api/v1/site/delegations/link/:codigoLink/payments` (multipart)

`pagos` (JSON) y `vouchers` (archivos), como arriba. `201`: la vista del link.

No existen rutas del sitio para borrar ni editar integrantes o vouchers.

## API administrativa

Permisos: gestionar = `eventos.configurar` (global); revisar pagos y aprobar al grupo =
`eventos.configurar` **o** `inscripciones.validar` (en el evento de la delegación); ver un voucher =
`eventos.configurar` **o** `pagos.ver`.

| Ruta | Permiso | Descripción |
|---|---|---|
| `GET /v1/events/:eventId/delegations` | `eventos.configurar` | Lista con integrantes activos, precio, total y resumen de pagos |
| `POST /v1/events/:eventId/delegations` | `eventos.configurar` | Alta: `{ nombre, institucion?, modalidad?, representante: {…, esIntegrante? (false)}, participantes? }` (cifras opcionales `minIntegrantes`, `precioEstandar`, `precioPromocional` para un convenio distinto) |
| `GET /v1/delegations/:id` | `eventos.configurar` | Detalle: `pagos[]`, `inscripciones[]` (todas, con estado), `pago` (resumen) |
| `PUT /v1/delegations/:id` | `eventos.configurar` | Edita nombre, institución, delegado, `activo`, cifras; `modalidad` solo sin integrantes (`409 DELEGATION_MODALITY_LOCKED`). Cambiar `minIntegrantes` o los precios reprecia al grupo |
| `POST /v1/delegations/:id/inscriptions` | `eventos.configurar` | Alta manual o masiva de integrantes (`{ participantes }`, 1 a 200) |
| `DELETE /v1/delegations/:id/inscriptions/:inscriptionId` | `eventos.configurar` | Quita un integrante no aprobado (`409 INSCRIPTION_NOT_REMOVABLE`) y recalcula el grupo |
| `POST /v1/delegations/:id/approve` | `eventos.configurar` / `inscripciones.validar` | Aprueba a los integrantes por revisar; las credenciales salen en diferido. `data`: el detalle con `aprobadas` y `credencialesEnSegundoPlano`. `409 NOTHING_TO_APPROVE` |
| `POST /v1/delegations/:id/payments` | `eventos.configurar` | Suma vouchers (multipart `pagos` + `vouchers`) |
| `PATCH /v1/delegations/:id/payments/:paymentId` | `eventos.configurar` / `inscripciones.validar` | `{ estado: PENDIENTE\|VERIFICADO\|RECHAZADO, motivo? }` |
| `DELETE /v1/delegations/:id/payments/:paymentId` | `eventos.configurar` | Borra el voucher y su archivo; uno verificado no (`409 PAYMENT_VERIFIED`) |
| `GET /v1/delegations/:id/payments/:paymentId/voucher` | `eventos.configurar` / `pagos.ver` | El archivo del voucher |

### Forma de una delegación (listado y detalle)

```json
{
  "id": 5, "eventoId": 2, "nombre": "…", "codigoLink": "9f3a2b1c4d5e6f70", "institucion": "UNAT", "modalidad": "VIRTUAL",
  "representante": { "nombre": "…", "email": "…", "telefono": "…", "tipoDocumento": "dni", "documento": "07969419" },
  "minIntegrantes": 10, "precioEstandar": 30, "precioPromocional": 30, "precioUnitario": 30,
  "totalIntegrantes": 24, "montoTotal": 720, "faltanParaPromocional": null,
  "tipoInscripcion": { "id": 15, "codigo": "delegacion_virtual", "nombre": "…", "etiqueta": "VIRTUAL", "modalidad": "VIRTUAL" },
  "pago": { "totalAPagar": 720, "declarado": 720, "verificado": 360, "saldo": 0, "cantidad": 2 },
  "activo": true, "creadoEn": "…", "actualizadoEn": "…"
}
```

El detalle agrega `pagos[]` (`id`, `modalidadPago`, `banco`, `billeteraDigital`, `tipoOperacion`,
`numeroOperacion`, `fechaPago`, `monto`, `estado`, `motivoRechazo`, `revisadoEn`, `creadoEn`) e
`inscripciones[]` (`id`, `participante`, `estado`, `monto`, `creadoEn`).

### En las inscripciones

`GET /v1/events/:eventId/inscriptions` y `GET /v1/inscriptions/:id` traen `delegacion` (`null` si es
individual): `id`, `nombre`, `codigoLink`, `totalIntegrantes` y, en el detalle, `modalidad` y `pago`
(el resumen, solo con `pagos.ver`; sin ese permiso va `null`).

## Compatibilidad

Todo es aditivo respecto a la API anterior de inscripciones. Frente a la rama `delegacionesd`
(nunca desplegada): `tipoInscripcionId` deja de ser un campo del registro, y `pago`/`voucher` de la
delegación pasan a `pagos[]`.

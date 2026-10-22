# Contrato: delegaciones con planes y tarifa propios (spec 029)

Reemplaza las rutas de tarifa y de registro público de [`api-delegaciones-convenio.md`](../../023-delegaciones-convenio/contracts/api-delegaciones-convenio.md)
y [`api-tarifa-delegaciones.md`](../../024-tarifa-delegaciones/contracts/api-tarifa-delegaciones.md). Los vouchers (`…/payments`) y la aprobación del
grupo siguen como en la 023.

Respuestas `{ success, data }`. Errores `{ success: false, code, message, fields? }`.

## Planes

`CON_KIT`, `SIN_KIT` y `VIRTUAL` (siempre en mayúsculas; el servidor acepta minúsculas en el cuerpo). Cada uno es un tipo de la categoría oculta de la
delegación (`delegacion_con_kit`, `delegacion_sin_kit`, `delegacion_virtual`).

```json
{
  "codigo": "SIN_KIT",
  "tipoInscripcionId": 22,
  "etiqueta": "SIN KIT",
  "modalidad": "PRESENCIAL",
  "activo": true,
  "precio": 60,
  "precioPromocional": 50,
  "precioUnitario": 50,
  "integrantes": 12
}
```

- `precioPromocional`: `null` = sin escala. Desde `minIntegrantes` (integrantes activos de **toda** la delegación) el plan cobra ese precio a todos sus integrantes.
- `precioUnitario`: lo que paga hoy cada integrante de ese plan. Sin `pagos.ver`, `precio`, `precioPromocional` y `precioUnitario` van en `null`.

## Staff

Permisos: `delegaciones.ver` (lista y detalle), `delegaciones.inscribir` (datos, integrantes, cambio de plan, subir vouchers; incluye ver),
`delegaciones.gestionar` (global: configuración, links, borrar voucher), `inscripciones.validar` (aprobar al grupo y verificar/rechazar vouchers) y
`pagos.ver` (ver el archivo del voucher). Las cuentas por evento solo operan en sus eventos (`403 EVENT_NOT_ASSIGNED`).

### `GET /api/v1/events/:eventId/delegations` · `GET /api/v1/delegations/:id`

```json
{
  "id": 5, "eventoId": 2, "nombre": "UNAC · Sistemas", "institucion": "UNAC",
  "codigoLink": "9f2c4a7b1d3e5f60",
  "codigoInscripcion": "a1b2c3d4e5f60718",
  "inscripcionIndividual": true,
  "dominioCorreo": "unac.edu.pe",
  "representante": { "nombre": "Rosa Quispe", "email": "rosa@unac.edu.pe", "telefono": "999888777", "tipoDocumento": "dni", "documento": "70000001" },
  "minIntegrantes": 10,
  "planes": [ { "codigo": "CON_KIT", "…": "…" }, { "codigo": "SIN_KIT", "…": "…" }, { "codigo": "VIRTUAL", "…": "…" } ],
  "totalIntegrantes": 12,
  "montoTotal": 760,
  "faltanParaPromocional": null,
  "pago": { "totalAPagar": 760, "declarado": 500, "verificado": 300, "saldo": 260, "cantidad": 2 },
  "activo": true, "creadoEn": "…", "actualizadoEn": "…"
}
```

- `codigoLink` y `codigoInscripcion` van en `null` salvo para quien tiene `delegaciones.inscribir` o `delegaciones.gestionar`; `inscripcionIndividual` (booleano)
  siempre sale. `codigoInscripcion: null` con `inscripcionIndividual: false` = link individual apagado.
- Sin `pagos.ver`: `montoTotal` y `pago` en `null` y los importes de los planes en `null`.
- `faltanParaPromocional`: `null` si ningún plan activo tiene escala o ya se alcanzó el mínimo.
- El **detalle** agrega `pagos[]` (`[]` sin `pagos.ver`) e `inscripciones[]`:
  `{ id, participante: { id, tipoDocumento, numeroDocumento, nombres, apellidos, correo, celular }, estado: { codigo, nombre }, plan: "CON_KIT" | … | null, monto, creadoEn }`
  (`monto: null` sin `pagos.ver`).
- Las delegaciones de la lista salen de la más nueva a la más antigua; el conteo por plan viene de una sola consulta agrupada.

### `POST /api/v1/events/:eventId/delegations` (`delegaciones.gestionar` o `delegaciones.inscribir`) → `201` con el detalle

```json
{
  "nombre": "UNAC · Sistemas",
  "institucion": "UNAC",
  "representante": { "nombres": "Rosa", "apellidos": "Quispe", "tipoDocumento": "dni", "numeroDocumento": "70000001", "correo": "rosa@unac.edu.pe", "celular": "999888777", "esIntegrante": true, "plan": "CON_KIT" },
  "participantes": [ { "tipoDocumento": "dni", "numeroDocumento": "70000002", "nombres": "Ana", "apellidos": "Pérez", "correo": "ana@unac.edu.pe", "celular": "", "plan": "SIN_KIT" } ],
  "planes": { "CON_KIT": { "activo": true, "precio": 80 }, "SIN_KIT": { "activo": true, "precio": 60, "precioPromocional": 50 } },
  "minIntegrantes": 10,
  "dominioCorreo": "@unac.edu.pe",
  "inscripcionIndividual": true
}
```

- `planes`, `minIntegrantes`, `dominioCorreo` e `inscripcionIndividual` **solo** con `delegaciones.gestionar`; de lo contrario `403 FORBIDDEN` y no se crea nada. Sin `planes` los tres
  nacen apagados y a S/ 0 (la delegación no admite integrantes hasta que se configuren).
- El delegado es obligatorio (documento, correo y celular). `dominioCorreo` se normaliza (minúsculas, sin arroba; `""` = sin filtro). Máximo 200 participantes.
- Si inscribir a los integrantes falla, no queda nada creado (se borran la delegación, su categoría y sus planes).

### `PUT /api/v1/delegations/:id` (`delegaciones.inscribir`) → detalle

Datos del grupo: `nombre`, `institucion`, `activo`, `representante`. Renombrar renombra también los tipos (es lo que imprime la credencial). Los precios,
la modalidad y los planes **ya no** se aceptan aquí.

### `PUT /api/v1/delegations/:id/config` (`delegaciones.gestionar`) → detalle

```json
{ "planes": { "CON_KIT": { "precio": 90 }, "VIRTUAL": { "activo": true, "precio": 30 }, "SIN_KIT": { "precioPromocional": null } }, "minIntegrantes": 8, "dominioCorreo": "unac.edu.pe", "inscripcionIndividual": false }
```

- Todo es opcional (al menos un dato, `422` si no); lo que no llega se conserva. `precioPromocional: null` quita la escala. `inscripcionIndividual: true` genera el código si no existía;
  `false` lo apaga (`NULL`).
- Un plan activo necesita `precio > 0` y el promocional no puede superar al precio: `409 INVALID_PRICES` y no cambia nada.
- Un cambio de precio o de mínimo reprecia a los integrantes activos del grupo. Apagar un plan no toca a quienes ya lo tienen.

### `POST /api/v1/delegations/:id/links/regenerate` (`delegaciones.gestionar`) `{ "enlace": "delegado" | "individual" }` → detalle

El código anterior deja de funcionar. Regenerar el individual lo enciende.

### Integrantes

- `POST /api/v1/delegations/:id/inscriptions` (`delegaciones.inscribir`) `{ participantes: [...] }` (1–200, cada uno con `plan`) → `201` con el detalle + `registrados` y `omitidos`.
- `PATCH /api/v1/delegations/:id/inscriptions/:inscriptionId` (`delegaciones.inscribir`) `{ "plan": "CON_KIT" }` → detalle. El plan destino debe estar activo (quedarse en el mismo no es error);
  un integrante `RECHAZADO` o `CANCELADO` responde `409 INSCRIPTION_NOT_EDITABLE`.
- `DELETE /api/v1/delegations/:id/inscriptions/:inscriptionId` (`delegaciones.inscribir`): solo no aprobados (`409 INSCRIPTION_NOT_REMOVABLE`).
- El staff puede inscribir con cualquier correo aunque la delegación tenga dominio.

### Vouchers y aprobación

`POST …/payments` (`delegaciones.inscribir`, multipart), `PATCH …/payments/:paymentId` (`inscripciones.validar`), `DELETE …/payments/:paymentId` (`delegaciones.gestionar`),
`GET …/payments/:paymentId/voucher` (`pagos.ver`), `POST …/approve` (`inscripciones.validar`).

## API del sitio (token del evento en `X-Api-Key`, como el resto)

Retiradas: `GET /v1/site/delegations/tarifa` y `POST /v1/site/delegations` (`404`).

### `GET /api/v1/site/delegations/link/:codigoLink` — la vista del delegado

Igual que en la 023, con lo nuevo: `planes[]` (los tres, con `activo` y precios), `minIntegrantes`, `dominioCorreo`, `codigoInscripcion` (el link individual, para compartirlo; `null` si está apagado),
`montoTotal`, `faltanParaPromocional`, `pago` y `integrantes[]` con `{ nombres, apellidos, documento (enmascarado), estado, plan }`. Ya no trae `modalidad`, `precioEstandar`,
`precioPromocional`, `precioUnitario` ni `tipoInscripcion`. No expone el correo ni el teléfono del delegado. Otro evento, inactiva o inexistente: `404 DELEGATION_NOT_FOUND`.

### `POST /api/v1/site/delegations/link/:codigoLink/participants` — el delegado suma integrantes

`{ participantes: [{ tipoDocumento, numeroDocumento, nombres, apellidos, correo, celular, plan }] }` → `201` con la vista del delegado + `registrados` y `omitidos`. Con dominio en la delegación el correo
completo debe terminar en `@dominio`: `422 EMAIL_DOMAIN_NOT_ALLOWED` con `fields["participantes[i].correo"]`.
`…/payments` (multipart) como en la 023.

### `GET /api/v1/site/delegations/join/:codigoInscripcion` — lo que ve quien abre el link individual

```json
{
  "nombre": "UNAC · Sistemas", "institucion": "UNAC",
  "evento": { "id": 2, "codigo": "ciisic-viii-2026", "nombre": "…", "nombreCorto": "…", "fechaInicio": "…", "fechaFin": "…", "inscripcionesAbiertas": true, "estado": "PUBLICADO" },
  "dominioCorreo": "unac.edu.pe",
  "minIntegrantes": 10,
  "planes": [ { "codigo": "CON_KIT", "etiqueta": "CON KIT", "modalidad": "PRESENCIAL", "precio": 80, "precioPromocional": null } ]
}
```

Solo planes **activos**. Nada de los demás integrantes ni del contacto. Link apagado, de otro evento, de una delegación inactiva o inexistente: `404 DELEGATION_NOT_FOUND`.

### `POST /api/v1/site/delegations/join/:codigoInscripcion/participants` — el integrante se inscribe solo (sin Google)

```json
{ "tipoDocumento": "dni", "numeroDocumento": "70000001", "nombres": "Ana", "apellidos": "Quispe", "celular": "999888777", "correoPrefijo": "aquispe", "plan": "SIN_KIT" }
```

→ `201` `{ "delegacion": { "nombre": "…" }, "plan": { "codigo": "SIN_KIT", "etiqueta": "SIN KIT", "modalidad": "PRESENCIAL" }, "registrados": 1, "omitidos": 0 }`.

- Con `dominioCorreo`: `correoPrefijo` (solo lo que va antes de la `@`) o `correo` completo, que debe terminar en el dominio. Sin dominio: `correo` completo (con solo el prefijo, `422` con `fields.correo`).
- `plan` es obligatorio si hay varios activos (`422 PLAN_REQUIRED`); un plan apagado o desconocido, `422 DELEGATION_PLAN_NOT_AVAILABLE`; sin planes activos, `422 DELEGATION_WITHOUT_PLANS`.
- Queda `PENDIENTE` con el tipo de su plan; el pago es del grupo. Repetir es idempotente (`omitidos: 1`). Quien ya está inscrito en el evento por su cuenta: `409 PARTICIPANT_ALREADY_REGISTERED`;
  inscripciones cerradas: `409 REGISTRATION_CLOSED`.
- Límites por visitante y por token como el resto de rutas de inscripción.

## Errores nuevos

| Código | Estado | Cuándo |
|---|---|---|
| `PLAN_REQUIRED` | 422 | Hay varios planes activos y falta elegir (`fields["participantes[i].plan"]`) |
| `DELEGATION_PLAN_NOT_AVAILABLE` | 422 | El plan está apagado o no existe |
| `DELEGATION_WITHOUT_PLANS` | 422 | La delegación no tiene ningún plan activo |
| `EMAIL_DOMAIN_NOT_ALLOWED` | 422 | El correo no termina en el dominio de la delegación (flujos públicos) |
| `INVALID_PRICES` | 409 | Plan activo sin precio o promocional mayor que el precio |
| `INSCRIPTION_NOT_EDITABLE` | 409 | Cambiar el plan de un integrante rechazado o cancelado |
| `DELEGATION_CATEGORY_MANAGED` | 409 | Editar desde Categorías y tipos una categoría o tipo de una delegación |
| `FORBIDDEN` | 403 | Una Comisión intenta fijar planes, mínimo, dominio o link individual al crear |

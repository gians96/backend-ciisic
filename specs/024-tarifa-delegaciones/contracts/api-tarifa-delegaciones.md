# Contrato: tarifa de delegaciones (spec 024)

Amplía [`api-delegaciones-convenio.md`](../../023-delegaciones-convenio/contracts/api-delegaciones-convenio.md).
No cambia la API del sitio: `GET /api/v1/site/delegations/tarifa` sigue leyendo los precios de los tipos y el
mínimo de `eventos.delegaciones_min_integrantes`, así que lo que se guarde aquí le llega solo.

Permiso: `eventos.configurar` (global; Tesorero y Comisión reciben `403`).

## `GET /api/v1/events/:eventId/delegations/tarifa`

```json
{
  "success": true,
  "data": {
    "minIntegrantes": 10,
    "presencial": { "precioEstandar": 60, "precioPromocional": 50 },
    "virtual": { "precio": 30, "activo": true },
    "delegaciones": { "total": 2, "sinIntegrantes": 1 }
  }
}
```

- `presencial`: el precio del tipo activo `delegacion_general` / `delegacion_grupal` o, si falta, el de
  `eventos.delegaciones_precio_*` (lo mismo que ve la landing).
- `virtual`: `null` mientras el evento no tenga el tipo `delegacion_virtual`; con `activo: false` la landing no
  ofrece la modalidad pero el precio se conserva.
- `delegaciones.sinIntegrantes`: delegaciones sin integrantes activos (no `RECHAZADO` ni `CANCELADO`) ni vouchers;
  son las que alcanza `aplicarAExistentes`.

## `PUT /api/v1/events/:eventId/delegations/tarifa`

Todos los campos son opcionales, pero debe llegar al menos uno. Lo que no llega se conserva.

| Campo | Tipo | Efecto |
|---|---|---|
| `minIntegrantes` | entero 1–1000 | `eventos.delegaciones_min_integrantes`: desde cuántos integrantes aplica el promocional |
| `precioEstandar` | número ≥ 0 | `delegacion_general` (`precio` = `precioInstitucional`) y `eventos.delegaciones_precio_estandar` |
| `precioPromocional` | número ≥ 0 | `delegacion_grupal` y `eventos.delegaciones_precio_promocional` |
| `precioVirtual` | número ≥ 0 | `delegacion_virtual`; si no existe, la crea (activa) |
| `virtualActivo` | booleano | muestra u oculta la modalidad virtual (`tipo.activo`); `true` sin tipo lo crea a S/ 30 |
| `aplicarAExistentes` | booleano (`false`) | copia el mínimo y los precios a las delegaciones sin integrantes ni vouchers |

`200`: la misma forma del `GET` (ya con los valores nuevos) más `delegacionesActualizadas`: cuántas delegaciones
recibieron la tarifa por `aplicarAExistentes` (`0` si no se pidió).

**Errores**: `422 VALIDATION_ERROR` (promocional mayor que estándar enviados juntos, mínimo fuera de rango, precio
negativo o cuerpo sin datos), `409 INVALID_PRICES` (el promocional queda mayor que el estándar al mezclar con lo
vigente), `422 DELEGATION_CATEGORY_NOT_FOUND` (hay que crear el tipo virtual y el evento no tiene la categoría
`DELEGACIONES`), `404 EVENT_NOT_FOUND`, `401`/`403`.

Guardar no reprecia a nadie por sí solo: cada delegación conserva la tarifa que copió al crearse
(`min_integrantes`, `precio_estandar`, `precio_promocional`). Para una con integrantes o vouchers se usa
`PUT /v1/delegations/:id` (cambiar el mínimo o los precios reprecia al grupo).

## Compatibilidad

Rutas nuevas y aditivas; sin migración. Un panel anterior no las usa y un backend anterior responde `404` al
panel nuevo, que entonces oculta «Editar tarifa» y sigue mostrando la tarifa de los tipos.

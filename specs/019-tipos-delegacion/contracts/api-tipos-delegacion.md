# Contrato: tipos de inscripción de delegación (spec 019)

Continúa el contrato de delegaciones (`specs/018-delegaciones/contracts/api-delegaciones.md`):
agrega la selección del tipo de delegación y la delegación en el listado/detalle de inscripciones.

## Categoría y tipos de delegación

- Categoría de inscripción con `codigo: "DELEGACIONES"` (mayúsculas, por validación del panel).
- Tipos activos con códigos **de contrato**:
  | Código | Rol | Uso |
  |---|---|---|
  | `delegacion_general` | precio estándar | tarjeta «Delegación General», precio por debajo del mínimo |
  | `delegacion_grupal` | precio promocional | tarjeta «Delegación Promocional», precio desde el mínimo |

Si faltan, la tarifa por defecto sigue siendo `eventos.delegacionesPrecioEstandar/Promocional`.

## `GET /api/v1/site/registration-types?categoria=DELEGACIONES`

Sin cambios en la ruta (contrato 3): devuelve las categorías con sus tipos activos. La landing arma
las tarjetas con `tipos[].{ id, codigo, nombre, etiqueta, descripcion, caracteristicas, precio }`.

## `GET /api/v1/site/delegations/tarifa` (cambio)

Ahora resuelve los precios **desde los tipos** (FR-002) en lugar de leer solo el evento:

```json
{
  "success": true,
  "data": { "minIntegrantes": 10, "precioEstandar": 60, "precioPromocional": 50 }
}
```

`precioEstandar` = precio de `delegacion_general` (si existe) y `precioPromocional` = precio de
`delegacion_grupal` (si existe); cada campo que falte usa el valor del evento.

## `POST /api/v1/site/delegations` (campo nuevo)

| Campo | Forma |
|---|---|
| `tipoInscripcionId` | Entero. Tipo activo del evento en la categoría `DELEGACIONES` que el representante eligió en su tarjeta. **Opcional en el contrato** (un cliente antiguo sigue funcionando); la landing siempre lo envía. Si viene inválido → `422 REGISTRATION_TYPE_NOT_AVAILABLE` |

Reglas añadidas:

- El tipo se guarda en `delegaciones.tipo_inscripcion_id` y en cada inscripción del grupo (creadas,
  reutilizadas y las que se agreguen después desde el panel).
- Con `codigoLink`, la selección **actualiza** el tipo de la delegación existente (los precios
  almacenados de esa delegación no cambian).
- El monto por persona sigue la regla de la spec 018 (`precioUnitario`) con los precios resueltos
  desde los tipos al crear la delegación.

Respuesta `201`: la misma de la spec 018, con el campo adicional `tipoInscripcion`:

```json
"tipoInscripcion": { "id": 9, "codigo": "delegacion_general", "nombre": "DELEGACION GENERAL", "etiqueta": "sin kit" }
```

Errores nuevos: `422 REGISTRATION_TYPE_NOT_AVAILABLE` (tipo inexistente, inactivo, de otro evento o
fuera de la categoría `DELEGACIONES`).

## `GET /api/v1/events/:id/inscriptions` y `GET /api/v1/inscriptions/:id` (campo nuevo)

La fila y el detalle incluyen la delegación de la inscripción (si la tiene):

```json
"delegacion": {
  "id": 5,
  "nombre": "Ing. de Sistemas UNDC",
  "codigoLink": "9f3a2b1c4d5e6f70",
  "totalIntegrantes": 12,
  "pago": {
    "modalidad": "billetera",
    "banco": null,
    "billeteraDigital": "yape",
    "tipoOperacion": null,
    "numeroOperacion": "OP-12345",
    "fechaPago": "2026-10-15",
    "montoTotalPagado": 600,
    "tieneVoucher": true
  }
}
```

- En el **listado** solo van `id`, `nombre`, `codigoLink` y `totalIntegrantes` (sin `pago`).
- `pago` solo con permiso `pagos.ver` (spec 013: sin él, los montos van en `null`).
- Sin delegación: `"delegacion": null`.

## `GET /api/v1/delegations/:id/voucher` (permiso ampliado)

`eventos.configurar` **o** `pagos.ver` (antes solo `eventos.configurar`), para ver el voucher del
grupo desde el detalle de una inscripción. La delegación sigue restringida a su evento
(`eventoDeDelegacion`).

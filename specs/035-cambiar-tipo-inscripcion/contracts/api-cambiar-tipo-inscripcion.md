# Contrato — Cambiar el tipo de una inscripción (spec 035)

Ruta del panel (sesión de staff), bajo `/api`. Respuestas `{ success, data }`; errores `{ success: false, code, message, fields? }`.

## `PATCH /v1/inscriptions/:id/type` — `inscripciones.cambiar_tipo` (global, solo Owner)

Cuerpo:

```json
{ "tipoInscripcionId": 9, "motivo": "Es docente de la facultad" }
```

- `tipoInscripcionId`: entero positivo; el tipo debe ser de **un evento igual al de la inscripción** y de una categoría que **no** sea de una delegación. Puede estar inactivo.
- `motivo`: opcional, hasta 500 caracteres (se recorta; vacío = sin motivo). Queda en el historial.

Respuesta `200`: el detalle de la inscripción (igual que `GET /v1/inscriptions/:id`, con `tipoInscripcion` y su `categoria` ya nuevos) más:

```json
{
  "success": true,
  "data": {
    "id": 317,
    "tipoInscripcion": { "id": 9, "nombre": "Docente, egresados y administrativos de la Facultad Ingeniería UNDC", "etiqueta": "CON KIT", "categoria": { "id": 4, "nombre": "Docente, egresados y administrativos de la Facultad Ingeniería UNDC" } },
    "pago": { "monto": 120, "descuento": 0, "tieneDescuento": false },
    "cambiosTipo": [
      { "id": 8, "creadoEn": "2026-10-23T19:05:00.000Z", "anterior": "PROFESIONALES Y PUBLICO EN GENERAL · CON KIT", "nuevo": "Docente, egresados y administrativos de la Facultad Ingeniería UNDC · CON KIT", "motivo": "Es docente de la facultad", "realizadoPor": { "id": 1, "nombres": "Gianmarcos", "apellidos": "Arias" } }
    ],
    "ponenciasActualizadas": 0
  }
}
```

- `pago.monto` **no cambia**. `pago.descuento` / `pago.tieneDescuento` se recalculan: `max(0, precio de lista del tipo nuevo − monto)`; una cortesía siempre 0.
- `ponenciasActualizadas`: cuántas inscripciones a ponencias especializadas (vigentes, sin asistencia y que aún no terminan) pasaron al modo de asistencia del tipo
  nuevo. Es 0 si la modalidad (presencial / virtual) no cambió.
- `cambiosTipo`: de la más reciente a la más antigua (hasta 50); `realizadoPor` es `null` si la cuenta se borró.

Errores:

| Estado | `code` | Cuándo |
|---|---|---|
| 401 | `MISSING_TOKEN` / `INVALID_TOKEN` | sin sesión |
| 403 | `FORBIDDEN` | cualquier cuenta que no sea Owner |
| 400 | `INVALID_ID` | el `:id` no es un entero positivo |
| 404 | `INSCRIPTION_NOT_FOUND` | la inscripción no existe |
| 409 | `TYPE_UNCHANGED` | ya tiene ese tipo |
| 409 | `INSCRIPTION_IN_DELEGATION` | pertenece a una delegación (o tiene el tipo de un plan de delegación): se cambia desde Delegaciones |
| 409 | `INSCRIPTION_CHANGED` | otra petición la cambió mientras se guardaba: se vuelve a abrir y se reintenta |
| 409 | `TALK_FULL_ON_TYPE_CHANGE` | el cambio pasa a la persona a presencial y alguna de sus ponencias pendientes ya no tiene cupo presencial (el mensaje dice cuál) |
| 422 | `REGISTRATION_TYPE_INVALID` | el tipo no existe, es de otro evento o de una delegación |
| 422 | `VALIDATION_ERROR` | cuerpo inválido (`tipoInscripcionId`, `motivo`) |

## `GET /v1/inscriptions/:id` — `inscripciones.ver` (sin cambios de permiso)

Agrega `cambiosTipo` (misma forma, `[]` si nunca se corrigió). No va en los listados (`GET /v1/events/:eventId/inscriptions`) ni en el CSV. Las demás respuestas que devuelven
el detalle (`PATCH …/status`, cortesías) **no** lo traen: el panel conserva el que ya tenía.

## Permisos

`inscripciones.cambiar_tipo` — «Cambiar el tipo y la categoría de una inscripción»: alcance **global**, solo el Owner (`PERMISOS_SOLO_OWNER`), nunca elegible para la Comisión.
La sesión (`usuario.acceso.permisos`) lo incluye solo para el Owner; el panel decide por ese código, no por el rol.

## Qué cambia y qué no

- Cambia: `inscripciones.tipo_inscripcion_id` (y con él la categoría y la modalidad de asistencia), `descuento`, `tiene_descuento`, una fila en `cambios_tipo_inscripcion` y, si cambia la modalidad,
  `inscripciones_ponencia.modo_asistencia` de las ponencias pendientes de la persona.
- No cambia: monto, voucher, estado, revisión, correo, código de credencial ni QR, clasificación, datos de verificación de estudiante. Tampoco se envía ningún correo.

## Compatibilidad

Cambio aditivo: ruta nueva, permiso nuevo, una tabla nueva y una clave nueva en el detalle. El panel anterior ignora lo que no conoce (no muestra el botón). Backend primero.

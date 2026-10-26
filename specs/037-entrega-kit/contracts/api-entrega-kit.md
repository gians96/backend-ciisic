# Contrato — Entrega del kit y asistencia solo presencial (spec 037)

Respuestas `{ success, data }`; errores `{ success: false, code, message, fields?, data? }`. Todo es **aditivo**: un cliente que no lee lo nuevo sigue funcionando,
salvo que ahora una inscripción **virtual** no registra asistencia (`403 VIRTUAL_REGISTRATION`).

## Forma común: `kit`

```json
{ "incluye": true, "entregado": true, "entregadoEn": "2026-10-26T15:32:00.000Z", "entregadoPor": { "id": 41, "nombres": "Rosa", "apellidos": "Quispe" } }
```

- `incluye`: el tipo de la inscripción incluye kit y es presencial (un tipo virtual, o una cortesía sin tipo, no).
- `entregado` / `entregadoEn` / `entregadoPor`: la entrega vigente; sin entregar, `false` / `null` / `null`. `entregadoPor` es `null` también si se borró la cuenta.
- `incluyeKit` va **dentro del objeto del tipo** (`tipoInscripcion.incluyeKit`), como `modalidad`.

## Entregar y deshacer — `asistencia.marcar` (evento de la inscripción)

### `PUT /v1/inscriptions/:id/kit`

Sin cuerpo. Marca el kit como entregado **ahora**, por la cuenta que llama.

```json
{ "success": true, "data": { "inscripcionId": 500, "kit": { "incluye": true, "entregado": true, "entregadoEn": "2026-10-26T15:32:00.000Z", "entregadoPor": { "id": 41, "nombres": "Rosa", "apellidos": "Quispe" } } } }
```

Errores: `401`, `403 FORBIDDEN` / `403 EVENT_NOT_ASSIGNED`, `404 INSCRIPTION_NOT_FOUND`, `400 INVALID_ID`, `403 NOT_APPROVED` (la inscripción no está aprobada),
`409 KIT_NOT_INCLUDED` (tipo sin kit, virtual o sin tipo), `409 KIT_ALREADY_DELIVERED` (con la hora: «El kit ya fue entregado a las 10:32.», o con la fecha si fue otro día),
`429` (mismo límite por cuenta que marcar asistencia: 120 por minuto, salvo cuentas globales).

### `DELETE /v1/inscriptions/:id/kit`

Deshace la entrega: vuelve a «pendiente» (`entregadoEn` y `entregadoPor` en `null`). Misma respuesta que el `PUT`, con `kit.entregado: false`.
No exige que el tipo siga incluyendo kit. Errores: los mismos de arriba salvo `NOT_APPROVED`/`KIT_NOT_INCLUDED`/`KIT_ALREADY_DELIVERED`; `409 KIT_NOT_DELIVERED` si no estaba entregado.

## Resumen — `asistencia.ver` (evento)

### `GET /v1/events/:eventId/kits/summary`

```json
{ "success": true, "data": { "conKit": 120, "entregados": 85, "pendientes": 35 } }
```

Cuenta inscripciones `APROBADO` cuyo tipo es presencial e incluye kit. `404 EVENT_NOT_FOUND`.

## Asistencia

### `POST /v1/activities/:id/attendances` (cambia)

- Una inscripción **virtual** responde `403 VIRTUAL_REGISTRATION` (tras `NOT_APPROVED`), sin crear ni reactivar la asistencia y sin importar `fueraDeHorario` ni `metodo: 'MANUAL'`.
- La respuesta 201 agrega `inscripcion.tipoInscripcion.incluyeKit` e `inscripcion.kit`:

```json
"inscripcion": {
  "id": 500,
  "tipoInscripcion": { "nombre": "ESTUDIANTES", "etiqueta": "CON KIT", "modalidad": "PRESENCIAL", "incluyeKit": true },
  "kit": { "incluye": true, "entregado": false, "entregadoEn": null, "entregadoPor": null }
}
```

- `409 ATTENDANCE_ALREADY_REGISTERED` ahora trae `data: { participante, inscripcion }` con el mismo formato que la respuesta 201 (`participante` con `foto`), para poder entregar el kit
  pendiente al volver a escanear. Los demás errores no llevan `data`.

### `GET /v1/activities/:id/attendances` (agrega)

Cada fila agrega `inscripcion: { id, tipoInscripcion, kit } | null` (la inscripción de la persona en el evento de la actividad).

## Tipos de inscripción (panel)

`GET /v1/events/:eventId/registration-categories` agrega `incluyeKit` a cada tipo (también sin `pagos.ver`). `POST /v1/registration-categories/:id/types` y
`PUT /v1/registration-types/:id` aceptan `incluyeKit` (booleano; `422 VALIDATION_ERROR` si no lo es). Sin enviarlo: `false` al crear y se conserva al actualizar. Un tipo que queda
`VIRTUAL` se guarda con `incluyeKit: false`, lo pida o no. Los planes de una delegación se crean con kit solo en `CON_KIT`.

## Inscripciones

- `GET /v1/inscriptions/:id` agrega `tipoInscripcion.incluyeKit` y `kit`.
- `GET /v1/events/:eventId/inscriptions` agrega `tipoInscripcion.incluyeKit` y `kitEntregado` (booleano; cuándo y quién se ven en el detalle).

# Contrato — Validación del congreso en las ponencias especializadas (spec 030)

Continúa [`019-ponencias-especializadas/contracts/api-ponencias-especializadas.md`](../../019-ponencias-especializadas/contracts/api-ponencias-especializadas.md).
Respuestas `{ success, data, meta? }`; errores `{ success: false, code, message, fields? }`.

## Regla de acceso

`eventos.ponencias_acceso_libre` (por evento, apagado por defecto):

| Interruptor | Landing | Alta manual y puerta |
|---|---|---|
| **Encendido** (acceso libre) | Solo el documento (como antes); modo presencial, sin validar | Solo el documento; sin validar |
| **Apagado** | Documento **y correo** de un congresista con inscripción `APROBADO` del evento | Documento de un congresista con inscripción `APROBADO` |

El modo (`PRESENCIAL` | `VIRTUAL`) sale de `tipoInscripcion.modalidad`; sin tipo (cortesía) es `PRESENCIAL`. Solo el modo
presencial ocupa el `cupo` de la ponencia.

### Errores de acceso (422)

| `code` | Cuándo | Quién lo ve |
|---|---|---|
| `CONGRESS_REGISTRATION_NOT_FOUND` | Documento desconocido, sin inscripción en el evento o correo distinto | Todos (mismo mensaje en los tres casos para la landing) |
| `CONGRESS_PAYMENT_PENDING` | Inscripción `PENDIENTE` o `EN_REVISION` | Quien acertó documento (y correo); el staff |
| `CONGRESS_REGISTRATION_REJECTED` | Inscripción `RECHAZADO` o `CANCELADO` | Ídem |
| `VALIDATION_ERROR` (`fields.correo`) | Landing sin correo con el interruptor apagado | Landing |
| `FREE_ACCESS_ENABLED` (409) | `POST …/eligibility` con el interruptor encendido | Landing |

## Sitio (token del evento)

### `GET /v1/site/specialized-talks`

Igual que la spec 019, con `meta: { accesoLibre }`. `cuposDisponibles` y `llena` se calculan con el **aforo presencial**.

### `POST /v1/site/specialized-talk-eligibility`

Cuerpo `{ tipoDocumento: 'dni'|'ce', numeroDocumento, correo }` (todo obligatorio). Límites propios (20 por visitante y 300 por token
cada 15 min, `limiteVerificacionCongresista`), aparte de los de la inscripción para no gastar su cupo. 200:

```json
{ "success": true, "data": { "nombres": "Ana", "modoAsistencia": "VIRTUAL", "tipo": "Público general virtual", "categoria": "Público general" } }
```

### `POST /v1/site/specialized-talk-registrations`

Cuerpo `{ asistente: { tipoDocumento, numeroDocumento, correo, … }, ponenciaIds[1..4] }`. Con el interruptor apagado el `correo`
es obligatorio y `nombres`, `apellidos`, `celular` y `procedencia` se ignoran (salen del congreso). La respuesta agrega
`modoAsistencia` (`null` con el acceso libre) y `cuposDisponibles` de cada ponencia es el presencial. Un virtual se inscribe
aunque la ponencia esté llena (`TALK_FULL` solo aplica al presencial). Repetir valida una inscripción anterior sin validar.

## Panel (sesión de staff)

| Método y ruta | Permiso | Notas |
|---|---|---|
| `GET /v1/events/:eventId/specialized-talks/access` | `especializadas.ver` ∨ `.gestionar` | `{ accesoLibre }` |
| `PUT /v1/events/:eventId/specialized-talks/access` | `.gestionar` (global) | cuerpo `{ accesoLibre: boolean }`; registra solo ids |
| `GET /v1/events/:eventId/specialized-talk-registrations` | `.ver` | filtros nuevos `?validacion=si` o `no`, `?modo=PRESENCIAL` o `VIRTUAL`; `meta.sinValidar` |
| `POST /v1/specialized-talks/:id/registrations` | `.inscribir` | solo el documento; con el acceso apagado debe ser congresista aprobado |
| `POST /v1/specialized-talks/:id/check-in` | `.asistencia` | ídem; la respuesta lleva `validada`, `modoAsistencia` y `ponencia.{inscritos, presenciales, virtuales, asistentes}` |

Cada inscripción del listado añade `validada` (boolean), `modoAsistencia` y `congreso: { estado, tipo, categoria } | null`
(estado **actual** de la inscripción al congreso con la que se validó). Cada ponencia del panel añade `inscritosPresenciales`
e `inscritosVirtuales` (`inscritos` sigue siendo el total) y `cuposDisponibles` resta solo los presenciales.

## Compatibilidad

Cambio aditivo: la landing y el panel anteriores siguen funcionando (campos nuevos ignorados). La landing anterior ya envía el
correo, así que cumple la regla; no distingue el modo (un virtual vería «Agotada» en las ponencias llenas) hasta que se
despliegue la spec 009 de la landing.

# Contrato — Roles, permisos y alcance por evento

Base `/api/v1`. Sesión de staff: `Authorization: Bearer <jwt>` (audiencia `ciisic-admin`, 1 h).
Reemplaza la notación "Admin/SA" de los contratos 002–012: cada ruta exige ahora un permiso.

## Roles

| Código | Nombre visible | Alcance | Permisos |
|---|---|---|---|
| `SUPERADMIN` | Owner | `GLOBAL` | Todos. Único con `sistema.configurar` y único que gestiona Owners y Administradores |
| `ADMIN` | Administrador del sistema | `GLOBAL` | Todos menos `sistema.configurar`. Gestiona solo Tesoreros y Comisión |
| `TESORERO` | Tesorero | `EVENTO` | Fijos: `resumen.ver`, `inscripciones.ver`, `inscripciones.exportar`, `credenciales.reenviar`, `pagos.ver`, `inscripciones.validar`, `asistencia.ver`, `asistencia.exportar`, `ponencias.ver`, `mensajes.ver`, `certificados.ver` |
| `COMISION` | Comisión tecnológica | `EVENTO` | Los elegidos para la cuenta (abajo); por defecto `asistencia.marcar` |

- `SUPERADMIN` y `ADMIN` **conservan su código** (el panel actual y los JWT vivos lo usan) y solo
  cambian su nombre visible. El renombre a `OWNER`/`ADMINISTRADOR` queda para después del 30-oct-2026.
- Las cuentas `EVENTO` solo operan en sus eventos (`asignaciones_evento`).

## Permisos

Catálogo en `src/core/permisos.ts` (nombres visibles en `ETIQUETAS_PERMISO`).

- **Globales (G)**, solo Owner y Administrador: `sistema.configurar` (solo Owner),
  `administradores.gestionar`, `eventos.configurar`, `eventos.eliminar`, `catalogos.configurar`,
  `correo.configurar`, `consultas_dni.gestionar`, `participantes.gestionar`,
  `inscripciones.eliminar` (solo Owner desde la spec 017), `inscripciones.cancelar`, `legacy.usar`; reservados para las specs
  014–015: `inscripciones.cortesia`, `certificados.gestionar`.
- **Por evento (E)**: `resumen.ver`, `inscripciones.ver`, `inscripciones.exportar`,
  `credenciales.reenviar`, `pagos.ver`, `inscripciones.validar`, `asistencia.ver`,
  `asistencia.exportar`, `asistencia.marcar`, `asistencia.anular`, `asistencia.fuera_horario`,
  `ponencias.ver`, `mensajes.ver`, `mensajes.eliminar`; reservados: `certificados.ver`,
  `certificados.operar`.
- **Elegibles para la Comisión**: `asistencia.marcar`, `asistencia.ver`, `asistencia.anular`,
  `asistencia.fuera_horario`, `asistencia.exportar`, `resumen.ver`, `inscripciones.ver`,
  `inscripciones.exportar`, `credenciales.reenviar`, `ponencias.ver`, `mensajes.ver`. Nunca
  `pagos.ver`, `inscripciones.validar`, `mensajes.eliminar` ni permisos G.
- **Dependencias** (se agregan al guardar y al cargar la cuenta): `inscripciones.exportar`,
  `credenciales.reenviar` y `pagos.ver` → `inscripciones.ver`; `inscripciones.validar` →
  `pagos.ver`; `asistencia.exportar`, `asistencia.marcar` y `asistencia.anular` →
  `asistencia.ver`; `asistencia.fuera_horario` → `asistencia.marcar`; `mensajes.eliminar` →
  `mensajes.ver`; `certificados.operar` → `certificados.ver`. `asistencia.marcar` **no** implica
  `asistencia.exportar`.

## Errores de la guarda

La cuenta (rol, estado, eventos y permisos) se lee de la BD en cada petición.

| Estado | Código | Cuándo |
|---|---|---|
| 401 | `MISSING_TOKEN`, `INVALID_TOKEN_FORMAT`, `INVALID_TOKEN` | Sin token, mal formado o caducado |
| 401 | `SESSION_INVALIDATED` | La cuenta se borró, se desactivó o tiene un rol desconocido; o cambiaron su correo, su contraseña o su cuenta Google desde que se firmó el JWT (huella); o el JWT es anterior a esta spec (sin huella) |
| 403 | `FORBIDDEN` | Token de participante, o la cuenta no tiene ninguno de los permisos de la ruta |
| 403 | `EVENT_NOT_ASSIGNED` | Cuenta `EVENTO`: el evento del recurso no es suyo |
| 404 | `NOT_FOUND` | Cuenta `EVENTO`: el recurso no existe o no tiene evento (mensajes antiguos). Las cuentas globales reciben el 404 propio de la ruta |

```json
{ "success": false, "code": "EVENT_NOT_ASSIGNED", "message": "No tienes asignado este evento." }
{ "success": false, "code": "SESSION_INVALIDATED", "message": "Tu sesión ya no es válida. Ingresa nuevamente." }
```

Los resolutores parsean el id igual que los controladores (`idParam`): `/v1/inscriptions/0x3` es el
id 3 en ambos, así que responde `403 EVENT_NOT_ASSIGNED`, nunca otro recurso. Los UUID de ponencia
se comparan sin distinguir mayúsculas.

## Ruta → permiso

P(x) = evento tomado del parámetro `x`. Los resolutores por recurso toman el evento de la
inscripción, actividad, asistencia, mensaje o ponencia. Sin evento indicado, el permiso es G. En
las rutas con dos permisos basta uno. Las rutas legacy llevan antes `rutaLegacy` (410
`LEGACY_ROUTE_DISABLED` si están apagadas). Las rutas públicas, las del sitio
(`requireTokenEvento`) y las del portal (`requireParticipante`) no cambian.

| Módulo | Método · Ruta | Permiso | Evento |
|---|---|---|---|
| admin | GET, POST `/admin`; GET, PUT, DELETE `/admin/:id` | `administradores.gestionar` | — |
| admin | POST `/auth/login` | pública (límite 10/15 min) | — |
| admin | GET `/auth/session` | `requireSesion` (staff o participante) | — |
| admin | POST `/auth/refresh` (nueva) | `requireActor` + límite 30/15 min por cuenta | — |
| catalog | POST `/classification`; PUT, DELETE `/classification/:id` | `catalogos.configurar` | — |
| catalog | GET `/roles` | `administradores.gestionar` | — |
| event | GET `/events` | `requireActor` (el controlador filtra) | — |
| event | POST `/events`; GET, PUT `/events/:id` | `eventos.configurar` | — |
| event | DELETE `/events/:id` | `eventos.eliminar` | — |
| event | GET `/events/:id/summary` | `resumen.ver` | P(`id`) |
| access-token | GET, POST `/events/:eventId/access-tokens`; DELETE `/access-tokens/:id` | `eventos.configurar` | — |
| integration | GET, POST `/events/:eventId/integrations`; PUT, DELETE `/integrations/:id`; POST `/integrations/:id/test` | `eventos.configurar` | — |
| integration | GET `/events/:eventId/integrations/sports-summary` | `resumen.ver` | P(`eventId`) |
| registration-type | GET `/events/:eventId/registration-categories` | `eventos.configurar` o `inscripciones.ver` | P(`eventId`) |
| registration-type | POST `/events/:eventId/registration-categories`; PUT, DELETE `/registration-categories/:id`; POST `/registration-categories/:id/types`; PUT, DELETE `/registration-types/:id` | `eventos.configurar` | — |
| payment-qr | POST `/payment-qr`; GET `/payment-qr/:archivo` | `eventos.configurar` | — |
| inscription | GET `/events/:eventId/inscriptions` | `inscripciones.ver` | P(`eventId`) |
| inscription | GET `/events/:eventId/inscriptions/export` | `inscripciones.exportar` | P(`eventId`) |
| inscription | GET `/inscriptions/:id`, GET `/inscriptions/:id/credential` | `inscripciones.ver` | inscripción |
| inscription | PATCH `/inscriptions/:id/status` | `inscripciones.validar` | inscripción |
| inscription | POST `/inscriptions/:id/resend-credential` | `credenciales.reenviar` + límite 20/15 min por cuenta | inscripción |
| inscription | GET `/inscriptions/:id/voucher` | `pagos.ver` | inscripción |
| inscription | DELETE `/inscriptions/:id` | `inscripciones.eliminar` | — |
| inscription (legacy) | GET `/inscription`, GET `/inscription/:id`, PUT `/inscription/:id/status` | `legacy.usar` | — |
| inscription (legacy) | DELETE `/inscription/:id` | `inscripciones.eliminar` | — |
| activity | GET `/events/:eventId/activities` | `asistencia.ver` o `eventos.configurar` | P(`eventId`) |
| activity | POST `/events/:eventId/activities`; PUT, DELETE `/activities/:id` | `eventos.configurar` | — |
| activity | GET `/activities/:id/attendances` | `asistencia.ver` | actividad |
| activity | POST `/activities/:id/attendances` | `asistencia.marcar` + límite 120/min por cuenta | actividad |
| activity | DELETE `/attendances/:id` | `asistencia.anular` | asistencia |
| activity | GET `/events/:eventId/attendances/export` | `asistencia.exportar` | P(`eventId`) |
| activity (legacy) | POST `/attendances/export`, POST `/attendances/overtime`, POST `/attendances`, GET `/attendances/:id` | `legacy.usar` | — |
| papers | GET `/events/:eventId/papers` | `ponencias.ver` | P(`eventId`) |
| papers | GET `/papers/:id/file` | `ponencias.ver` | ponencia |
| papers (legacy) | GET `/papers` | `legacy.usar` | — |
| contact | GET `/events/:eventId/contact-messages` | `mensajes.ver` | P(`eventId`) |
| contact | PATCH `/contact-messages/:id` | `mensajes.ver` | mensaje |
| contact | DELETE `/contact-messages/:id` | `mensajes.eliminar` | mensaje |
| contact (legacy) | GET `/contact`, GET `/contact/:id`, DELETE `/contact/:id` | `legacy.usar` | — |
| document-lookup | GET `/document-lookup/dni/:numero`; GET, POST `/lookup-tokens`; GET `/lookup-tokens/usage`, `/lookup-tokens/logs`; PUT, DELETE `/lookup-tokens/:id`; POST `/lookup-tokens/:id/reset`, `/lookup-tokens/:id/test` | `consultas_dni.gestionar` | — |
| email-credential | GET, POST `/email-credentials`; PUT, DELETE `/email-credentials/:id`; POST `/email-credentials/:id/test`, `/email-credentials/:id/send-test` | `correo.configurar` | — |
| participant | GET `/participants`; GET, PUT `/participants/:id` | `participantes.gestionar` | — |
| system-settings | GET, PUT `/settings`; POST `/settings/undc-api/test` | `sistema.configurar` (solo Owner) | — |

Orden de middlewares: la guarda va primera (o segunda tras `rutaLegacy`), antes de `upload` y de
`validateBody` (un 403 nunca valida ni guarda el archivo); los límites por cuenta van justo después
de la guarda.

## Sesión con acceso

El JWT del staff lleva además `huella` (HMAC del correo, la contraseña y la cuenta Google, con una
clave derivada de `JWT_SECRET`) y `authTime` (inicio de la sesión, en segundos). Son opacos para el
panel. Cambiar el correo, la contraseña, quitarla o desvincular Google cierra las sesiones abiertas de
esa cuenta en su siguiente petición (también la propia: hay que volver a ingresar). Los cambios de rol,
eventos o permisos aplican sin cerrar la sesión.

El usuario del staff lleva, además de los campos anteriores, su `acceso` (no va en el JWT):

```json
{
  "id": 40, "nombres": "…", "apellidos": "…", "correo": "…", "rolId": 4, "rolCodigo": "COMISION", "rolNombre": "Comisión tecnológica",
  "acceso": { "alcance": "EVENTO", "permisos": ["asistencia.marcar", "asistencia.ver"], "eventoIds": [2], "perfilParticipante": false }
}
```

- `permisos`: los efectivos (con dependencias), ordenados. `eventoIds`: `null` en las cuentas
  globales (todos los eventos). `perfilParticipante`: existe un participante con el mismo correo
  (el cambio al portal llega con la spec 014).
- `POST /auth/login` (misma forma que antes): `{ "jwt", "usuario": { …, "acceso" }, "expiraEn": 3600, "tipo": "ADMIN" }`.
  Cuenta inactiva o con rol desconocido → `401 INVALID_CREDENTIALS`.
- `POST /auth/google`: `{ "success": true, "data": { "jwt", "tipo": "ADMIN", "usuario": { …, "acceso" }, "expiraEn": "<ISO>" } }`.
  Rol desconocido → `403 ACCOUNT_DISABLED` (no se vincula ni pasa al portal).
- `GET /auth/session`: `{ "success": true, "tipo": "ADMIN", "user": { …, "acceso" } }`, leído de la
  BD (el JWT puede traer un nombre o un rol desactualizado). Cuenta borrada, inactiva o con rol
  desconocido → `401 SESSION_INVALIDATED`. La respuesta del participante no cambia.

## POST `/auth/refresh`

Renueva el JWT del staff antes de que caduque, con los datos actuales de la cuenta, el mismo
método de ingreso (`PASSWORD` o `GOOGLE`) y el mismo inicio de sesión (`authTime`). Una sesión dura
como máximo 12 h desde que se ingresó: después, la renovación responde `401 SESSION_EXPIRED` y hay que
volver a ingresar. Sin cuerpo. `Cache-Control: no-store`.

```json
{ "success": true, "data": { "jwt": "…", "expiraEn": "2026-10-26T15:00:00.000Z", "usuario": { "…": "…", "acceso": { "…": "…" } } } }
```

Errores: `401 MISSING_TOKEN|INVALID_TOKEN|SESSION_INVALIDATED|SESSION_EXPIRED`, `403 FORBIDDEN`
(token de participante), `429 RATE_LIMITED` (30 cada 15 min por cuenta).

```json
{ "success": false, "code": "SESSION_EXPIRED", "message": "Tu sesión llegó a su duración máxima. Ingresa nuevamente." }
```

## GET `/roles`

Solo los roles que la cuenta puede asignar (Owner: los 4; Administrador: `TESORERO` y `COMISION`).

```json
{ "success": true, "data": [
  { "id": 3, "codigo": "TESORERO", "nombre": "Tesorero", "alcance": "EVENTO", "permisos": ["resumen.ver", "inscripciones.ver", "…"] },
  { "id": 4, "codigo": "COMISION", "nombre": "Comisión tecnológica", "alcance": "EVENTO", "permisos": [],
    "permisosElegibles": [{ "codigo": "asistencia.marcar", "nombre": "Marcar asistencia", "implica": ["asistencia.ver"] }, "…"],
    "permisosPorDefecto": ["asistencia.marcar"] }
] }
```

Solo la entrada `COMISION` lleva `permisosElegibles` y `permisosPorDefecto`.

## Equipo: `/admin`

Cada cuenta lleva los campos anteriores más `alcance`, `eventos` y `permisos`:

```json
{
  "id": 40, "nombres": "…", "apellidos": "…", "correo": "…", "rolId": 4, "rolCodigo": "COMISION", "rolNombre": "Comisión tecnológica",
  "activo": true, "tieneContrasena": false, "googleVinculado": true, "googleVinculadoEn": "…", "creadoEn": "…", "actualizadoEn": "…",
  "alcance": "EVENTO", "eventos": [{ "id": 2, "nombreCorto": "VIII CIISIC 2026" }], "permisos": ["asistencia.marcar", "asistencia.ver"]
}
```

`alcance` es `"GLOBAL"`, `"EVENTO"` o `null` (rol desconocido). `permisos` son las filas guardadas
(solo la Comisión tiene).

- Cuerpo de `POST /admin`: `{ nombres, apellidos, correo, contrasena?, rolCodigo (obligatorio), activo?, eventoIds?: number[] (≤ 50), permisos?: string[] (≤ 30) }`.
  `PUT /admin/:id` es parcial (acepta además `desvincularGoogle` y `quitarContrasena`).
- **Delegación**: el Owner ve y gestiona todas las cuentas; el Administrador ve las de Tesorero y
  Comisión y la suya. Otra cuenta (GET `/admin/:id`, PUT, DELETE) → `403 ADMIN_NOT_MANAGEABLE`;
  crear o pasar a un rol que no puede asignar → `403 ROLE_NOT_ASSIGNABLE`.
- **Eventos y permisos** según el rol final: al crear un Tesorero o una Comisión, o al pasar a
  esos roles, se exigen eventos si la cuenta no los tenía (la Comisión, también permisos). Editar o
  desactivar una cuenta que se quedó sin eventos (p. ej. porque se borró su único evento) no los
  exige. `eventoIds` y `permisos`, si se envían, no pueden ir vacíos y reemplazan el conjunto
  completo (se agregan las dependencias). En los roles globales se ignoran y se borran las filas que
  hubiera.
- **Propia cuenta**: puede cambiar nombre, apellidos y contraseña; el correo y el vínculo con Google
  solo el Owner. Desactivarse, cambiar su rol, sus eventos o sus permisos, o (sin ser Owner) cambiar
  su correo o desvincular Google → `409 SELF_UPDATE_FORBIDDEN`. Enviar el mismo `rolCodigo`, el mismo
  correo (sin importar mayúsculas) o los mismos conjuntos no cuenta como cambio: el panel actual
  siempre los envía.
- **Promoción fuera de la delegación**: un Tesorero o una Comisión que pasa a Owner o Administrador
  pierde la contraseña y el vínculo con Google (un Administrador pudo dejarlos puestos), salvo que la
  misma petición traiga `contrasena`; sin ella, la persona entra con Google usando su correo. Sus
  sesiones abiertas se cierran.
- **Cambios simultáneos**: la escritura de un Administrador relee el rol de la cuenta con
  `FOR UPDATE`; si cambió desde que se leyó (p. ej. el Owner la promovió) → `409 ADMIN_CHANGED`.
- **Último Owner**: degradar, desactivar o borrar al último Owner activo → `409 LAST_OWNER` (se
  bloquean las filas con `FOR UPDATE`).
- `DELETE /admin/:id` → `{ "success": true, "data": { "desactivado": true|false } }`: se desactiva
  en lugar de borrar si revisó inscripciones o registró o anuló asistencias. Borrarse a sí mismo →
  `409 SELF_DELETE_FORBIDDEN`.

| Estado | Código | `fields` |
|---|---|---|
| 403 | `ADMIN_NOT_MANAGEABLE`, `ROLE_NOT_ASSIGNABLE` | — |
| 422 | `EVENTS_REQUIRED`, `EVENT_NOT_FOUND` | `{ "eventoIds": "…" }` |
| 422 | `PERMISSIONS_REQUIRED`, `PERMISSION_NOT_ELIGIBLE` | `{ "permisos": "…" }` |
| 409 | `LAST_OWNER`, `SELF_UPDATE_FORBIDDEN`, `SELF_DELETE_FORBIDDEN`, `EMAIL_IN_USE`, `ADMIN_CHANGED` | — |

```json
{ "success": false, "code": "EVENTS_REQUIRED", "message": "Asigna al menos un evento a esta cuenta.", "fields": { "eventoIds": "Elige al menos un evento." } }
{ "success": false, "code": "PERMISSION_NOT_ELIGIBLE", "message": "El permiso pagos.ver no se puede asignar a la Comisión.", "fields": { "permisos": "pagos.ver no es elegible." } }
```

## GET `/events` (vista reducida)

Con `eventos.configurar` (Owner y Administrador) la respuesta no cambia. Sin él, solo los eventos
asignados, en el mismo orden (`fechaInicio` desc, `id` desc):

```json
{ "id": 2, "codigo": "ciisic-viii-2026", "nombre": "…", "nombreCorto": "VIII CIISIC 2026", "sede": "…", "fechaInicio": "2026-10-26", "fechaFin": "2026-10-30",
  "estado": "PUBLICADO", "esPrincipal": true, "inscripcionesAbiertas": true, "inscripcionesInicio": "…", "inscripcionesFin": "…", "logoArchivo": null, "datosPago": { "…": "…" } }
```

`datosPago` solo con `pagos.ver`. Nunca lleva `credencialCorreo`, `credencialCorreoId`,
`dominioInstitucional`, `remitenteNombre`, `asuntoAprobacion` ni `totalInscripciones`.

## Sin `pagos.ver`: montos en `null`

Mismas claves, valores `null` (los conteos se conservan):

- `GET /events/:id/summary`: `totales.montoAprobado`, `totales.montoPendiente`, `porEstado[].monto`,
  `porTipo[].montoAprobado`.
- `GET /events/:eventId/integrations/sports-summary`: `congreso.montoAprobado`,
  `congreso.montoPendiente`, `totales.*`, `deportes[].resumen.payments.*.amount`,
  `byDiscipline[].cost|validatedAmount|pendingAmount`,
  `byParticipantType[].validatedAmount|pendingAmount`. El resumen de deportes-fi se arma con una
  lista blanca: un campo que deportes-fi agregue no llega hasta incluirlo en el backend.
- Filas de `GET /events/:eventId/inscriptions`: `monto`, `modalidadPago`, `numeroOperacion` y
  `fechaPago` en `null`, `tieneVoucher: false`; `q` no busca por número de operación.
- `GET /inscriptions/:id` (y la respuesta de `PATCH …/status`): `pago` con las mismas claves en
  `null` y sin voucher (el panel anterior lee `pago.tieneVoucher` sin comprobar `null`), y
  `tipoInscripcion.precio` / `precioInstitucional` en `null`:

  ```json
  "pago": { "monto": null, "descuento": null, "tieneDescuento": null, "modalidad": null, "banco": null, "tipoOperacion": null,
            "billeteraDigital": null, "numeroOperacion": null, "fechaPago": null, "tieneVoucher": false, "voucherMime": null }
  ```
- CSV: sin las columnas Monto, Descuento, Modalidad, Banco / billetera, N° operación y Fecha de pago.
- `GET /events/:eventId/registration-categories`: `precioDesde` y `tipos[].precio` /
  `precioInstitucional` en `null`.
- `GET /inscriptions/:id/voucher` → `403 FORBIDDEN`.

## Validación de inscripciones

- `PATCH /inscriptions/:id/status` con `inscripciones.validar`: `APROBADO`, `RECHAZADO`,
  `EN_REVISION` y `PENDIENTE`. `CANCELADO` exige además `inscripciones.cancelar` (también en el
  legacy `PUT /inscription/:id/status`):

  ```json
  { "success": false, "code": "STATUS_NOT_ALLOWED", "message": "No tienes permiso para cancelar inscripciones." }
  ```

- `revisadoPor` es la cuenta que valida.
- `POST /inscriptions/:id/resend-credential` reutiliza el PDF guardado y envía el correo; lo genera
  de nuevo si falta o si es anterior al último cambio de la persona o del evento (nombres,
  documento, logo…). Lo mismo al descargarlo (`GET /inscriptions/:id/credential` y el portal).
  Aprobar siempre regenera el PDF (cambia la fecha de aprobación).

## Asistencia

`POST /activities/:id/attendances` (todo lo nuevo es opcional):

```json
{ "participanteId": 1, "numeroDocumento": "12345678", "tipoDocumento": "dni|ce", "fueraDeHorario": false, "metodo": "QR|DOCUMENTO|MANUAL|null" }
```

- Sin `metodo` se infiere: `participanteId` → `QR`, `numeroDocumento` → `DOCUMENTO`. `QR_LEGADO` u
  otro valor → `422`. Las rutas legacy guardan `QR` con la cuenta que marca.
- `esFueraDeHorario` sale de la hora real de la marca: `fueraDeHorario: true` dentro del horario (la
  casilla del panel se queda marcada, o el legacy `overtime`) guarda `false`.
- La persona se busca **solo** entre las inscripciones del evento de la actividad.

`201` (las rutas legacy devuelven el mismo objeto sin `{ success, data }`):

```json
{ "success": true, "data": { "id": 3, "registradoEn": "2026-10-26T14:05:00.000Z", "metodo": "QR", "esFueraDeHorario": false,
  "participante": { "id": 100, "nombres": "…", "apellidos": "…", "tipoDocumento": "dni", "numeroDocumento": "****5678" } } }
```

`GET /activities/:id/attendances`, cada elemento (sin las anuladas):

```json
{ "id": 1, "registradoEn": "…", "metodo": "QR", "esFueraDeHorario": false, "registradoPor": { "id": 40, "nombres": "…", "apellidos": "…" },
  "participante": { "id": 100, "tipoDocumento": "dni", "numeroDocumento": "****5678", "nombres": "…", "apellidos": "…" } }
```

- `numeroDocumento` se enmascara (`****` + últimos 4) si la cuenta no tiene `inscripciones.ver`.
  `metodo` y `registradoPor` son `null` en las filas anteriores a esta spec.
- La exportación (`GET /events/:eventId/attendances/export`) y la matriz legacy también lo
  enmascaran sin `inscripciones.ver`.

| Estado | Código | Cuándo |
|---|---|---|
| 403 | `OUT_OF_HOURS_NOT_ALLOWED` | `fueraDeHorario` sin `asistencia.fuera_horario` |
| 404 | `PARTICIPANT_NOT_FOUND` | La persona no está inscrita en el evento de la actividad |
| 409 | `AMBIGUOUS_DOCUMENT` | Dos inscritos del evento comparten el número y no se envió `tipoDocumento` |
| 403 | `NOT_APPROVED` | La inscripción no está aprobada |
| 409 | `OUTSIDE_WINDOW` | Fuera del día u horario de la actividad |
| 409 | `ATTENDANCE_ALREADY_REGISTERED` | Ya marcada ("… a las HH:mm.", hora de Lima); también si dos marcas llegan a la vez |
| 429 | `RATE_LIMITED` | Más de 120 marcas por minuto de la misma cuenta por evento (Owner y Administrador no tienen este límite: varias estaciones pueden compartir una cuenta) |

**Anulación lógica**: `DELETE /attendances/:id` guarda `anuladoEn` y `anuladoPorId` y responde
`{ "success": true, "data": null }`; inexistente o ya anulada → `404 ATTENDANCE_NOT_FOUND`. Volver a
marcar reactiva la misma fila con los datos de quien marca (`201`). Las anuladas no cuentan en la
lista, en `totalAsistencias` de las actividades, en la exportación, en la matriz legacy ni en el
legacy `GET /attendances/:id` (que devuelve `{ id, registradoEn, participanteId, actividadId }`).
Borrar una actividad solo se impide (`409 ACTIVITY_HAS_ATTENDANCE`) si tiene asistencias vigentes.

## Compatibilidad con el panel actual

Durante el VIII CIISIC (26 al 30-oct-2026) el panel desplegado antes de esta spec sigue funcionando
para Owner y Administrador: mismos códigos de rol, mismos campos (lo nuevo son claves agregadas) y
`PUT /admin/:id` sigue aceptando `rolCodigo`. Las cuentas de Tesorero y Comisión necesitan el panel
con permisos (spec 008 del panel), que debe tolerar montos en `null` y la vista reducida de eventos.

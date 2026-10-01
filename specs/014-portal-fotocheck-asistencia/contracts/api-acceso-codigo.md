# Contrato — Acceso al portal con código por correo y paso del staff al portal

Base `/api/v1`. Todas las respuestas de `/auth/participant/*` llevan `Cache-Control: no-store`.
Errores con la forma `{ "success": false, "code", "message", "fields"? }`.

## Sesión del participante

| Campo | Valor |
|---|---|
| Audiencia / emisor / sujeto | `ciisic-participante` / `backend-ciisic` / id del participante |
| Vida | 43 200 s (12 h), igual con Google o con código. **No se renueva**: al vencer se vuelve a entrar |
| Carga | `{ participante: { id, nombres, apellidos, correo }, metodo: "GOOGLE" \| "CODIGO" }` |

- `requireParticipante` sigue comparando el correo: si el staff lo cambia, la sesión deja de valer
  (`401 SESSION_INVALIDATED`).
- El código por correo **siempre** abre una sesión de participante, nunca de staff, y no existe el
  camino del portal al panel. La sesión del staff sigue en 1 h con `POST /auth/refresh` (spec 013).

## POST `/auth/participant/code`

Pública. Guardas: `limiteSolicitudCodigo` (60 por IP cada 15 min) → `validateBody`.

```json
{ "correo": "ana@gmail.com" }
```

`correo`: se recorta y pasa a minúsculas; email válido de hasta 191 caracteres.

`202`, **siempre igual** exista o no el correo y esté o no vinculado a Google:

```json
{ "success": true, "data": { "expiraEnSegundos": 600, "reintentarEnSegundos": 60 } }
```

- La fila se crea siempre (solo el HMAC del código); el correo se envía **en diferido** y solo si
  hay un participante con ese correo, también si su cuenta está vinculada a Google. Remitente: la
  credencial de correo predeterminada activa. Asunto «Tu código de acceso al portal del
  participante».
- Al pedir uno nuevo se invalidan los vigentes salvo el más reciente: siempre sirven los **2
  últimos**.
- Presupuesto global de envíos (contado en la BD, solo filas con participante): 400 códigos
  **enviados** por hora y 2000 por día. Agotado, toda solicitud (exista o no el correo) responde
  `503 CODE_LOGIN_UNAVAILABLE` con `Retry-After`: una ráfaga no agota la cuota de Brevo que comparten
  los correos de aprobación.
- Un fallo del envío (Brevo) solo se registra en el log (id de la solicitud y causa): **no** cambia
  el estado de la credencial de correo ni `accesoCodigo.disponible`, que si no revelaría qué correos
  existen.
- La espera ante dos solicitudes simultáneas del mismo correo vive en la memoria del proceso (hoy
  corre uno solo); con varias réplicas podrían salir dos códigos, siempre dentro de los topes de la BD.

| Estado | Código | Cuándo |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Correo ausente o inválido |
| 429 | `CODE_COOLDOWN` | Menos de 60 s desde el último código, 5 en la última hora o 10 en el último día para ese correo, o dos solicitudes simultáneas. Con `Retry-After` y `fields.reintentarEnSegundos` |
| 429 | `RATE_LIMITED` | 200 códigos por hora desde la misma IP (contados en la BD; IPv6 por su subred /56), con `Retry-After`; o el limitador de la ruta |
| 503 | `CODE_LOGIN_UNAVAILABLE` | No hay credencial de correo utilizable (ninguna predeterminada activa, o su último envío de aprobación o prueba falló hace menos de 15 min) o falta la plantilla; o, con `Retry-After`, se agotó el presupuesto global de envíos |
| 503 | `CODE_LOGIN_PAUSED` | El disyuntor global está abierto (ver `verify`), con `Retry-After` |

```json
{ "success": false, "code": "CODE_COOLDOWN", "message": "Espera un momento antes de pedir otro código.", "fields": { "reintentarEnSegundos": "42" } }
```

## POST `/auth/participant/code/verify`

Pública. Guardas: `limiteVerificacionCodigo` (120 por IP cada 15 min) → `validateBody`.

```json
{ "correo": "ana@gmail.com", "codigo": "123 456" }
```

`codigo`: se quitan espacios y guiones y debe quedar `/^\d{6}$/`.

`200`:

```json
{ "success": true, "data": {
  "jwt": "…", "tipo": "PARTICIPANTE",
  "participante": { "id": 29, "nombres": "ANA", "apellidos": "PÉREZ GARCÍA", "correo": "ana@gmail.com" },
  "expiraEn": "2026-10-26T02:00:00.000Z" } }
```

- Se prueba contra los 2 últimos códigos vigentes; cada código admite 5 intentos (el intento se
  reserva antes de comparar, también con peticiones en paralelo).
- Al acertar, el código queda usado y los demás del correo invalidados. Entrar con el penúltimo no
  cuenta como fallo del correo. El participante debe seguir teniendo ese correo.
- Un ingreso correcto reinicia la cuenta de fallos del correo.
- Cada código incorrecto cuenta para el correo (10 por hora, en la BD), para la IP (50 por hora,
  IPv6 por su subred /56, en memoria) y, solo si el correo es de un participante, para el
  disyuntor global (150 por hora, en memoria): los fallos con correos inventados no pueden pausar el
  acceso de todos, y una sola red tampoco.
- Limitación conocida: quien conoce el correo de alguien puede pedirle códigos y gastar sus
  intentos (bloqueo de ese correo hasta 1 h, renovable); la persona sigue pudiendo entrar con
  Google.

| Estado | Código | Cuándo |
|---|---|---|
| 401 | `INVALID_CODE` | Código incorrecto; `fields.restantes` con los intentos que quedan |
| 401 | `CODE_EXPIRED` | Vencido, usado o agotado; no hay códigos vigentes; el correo no es de ningún participante o el participante cambió de correo |
| 429 | `CODE_LOCKED` | 10 intentos fallidos con ese correo en la última hora, con `Retry-After` |
| 429 | `RATE_LIMITED` | 50 códigos incorrectos en la última hora desde la misma IP, con `Retry-After`; o el limitador de la ruta |
| 503 | `CODE_LOGIN_PAUSED` | 150 verificaciones fallidas contra participantes existentes en una hora en el proceso: el acceso por código (solicitud y verificación) se pausa 1 h, con `Retry-After` |
| 422 | `VALIDATION_ERROR` | Cuerpo inválido |

```json
{ "success": false, "code": "INVALID_CODE", "message": "El código no es correcto. Te quedan 3 intentos.", "fields": { "restantes": "3" } }
```

**`fields` lleva texto** (`"3"`, `"42"`): el panel lo convierte a número o lee `Retry-After`.

## POST `/auth/participant/switch`

El staff pasa a su propio portal. `Authorization: Bearer <jwt de staff>`. Guardas:
`requireActor` → `limiteSwitch` (20 por cuenta cada 15 min). Sin cuerpo.

`200`: el mismo cuerpo que `verify`, con una sesión de participante de 12 h y `metodo: "GOOGLE"`.

1. La sesión de staff debe haberse iniciado con Google (`metodo: "GOOGLE"`) y la cuenta debe seguir
   vinculada a Google; si no → `409 CODE_REQUIRED` (el panel ofrece pedir el código al correo de la
   cuenta con `POST /auth/participant/code`).
2. Debe existir un participante con el mismo correo; si no → `404 PARTICIPANT_NOT_FOUND`.
3. Si el participante está vinculado a otra cuenta Google → `403 GOOGLE_ACCOUNT_MISMATCH`. Si no
   tenía, se le vincula la del staff; si esa cuenta Google ya es de otro participante →
   `409 GOOGLE_ACCOUNT_IN_USE`.

El JWT del staff no se revoca: el panel reemplaza su cookie por la sesión de participante y, para
volver al panel, se ingresa de nuevo. `acceso.perfilParticipante` (spec 013) indica si mostrar la
opción.

| Estado | Código |
|---|---|
| 401 | `MISSING_TOKEN`, `INVALID_TOKEN`, `SESSION_INVALIDATED` (cuenta desactivada o credenciales cambiadas) |
| 403 | `FORBIDDEN` (token de participante) |
| 409 | `CODE_REQUIRED` |
| 404 | `PARTICIPANT_NOT_FOUND` |
| 403 | `GOOGLE_ACCOUNT_MISMATCH` |
| 409 | `GOOGLE_ACCOUNT_IN_USE` |
| 429 | `RATE_LIMITED` |

## GET `/auth/config` (panel)

Pública, `Cache-Control: public, max-age=60`.

```json
{ "success": true, "data": { "google": { "clientId": "1-a.apps.googleusercontent.com" }, "urlPanel": "https://admin-ciisic.episundc.pe", "accesoCodigo": { "disponible": true } } }
```

`disponible`: hay credencial de correo utilizable, la plantilla existe y el disyuntor está cerrado;
nunca falla (ante un error es `false`). El panel muestra el acceso por código solo si es `true` y
Google siempre. **`GET /site/config` (landing) no cambia**: `{ google, urlPanel }`.

## POST `/auth/google`

Respuesta sin cambios. El límite pasa a `limiteLoginGoogle` (120 por IP cada 15 min; antes
compartía el de contraseña, 10). La sesión de participante que emite dura 12 h.

## Datos

`codigos_acceso`: `correo`, `codigo_hash` (HMAC-SHA256 hex de `correo:código`, clave
`sha256('codigos-acceso:' + JWT_SECRET)`), `participante_id` (NULL si el correo no existía),
`ip` (clave del limitador), `intentos`, `expira_en`, `usado_en`, `invalidado_en`, `creado_en`. Las
filas de más de 7 días se borran (como mucho una vez por hora). Rotar `JWT_SECRET` invalida los
códigos vigentes. Un envío fallido solo registra el id de la solicitud y la causa.

La plantilla es `src/api/participant-auth/templates/codigo-acceso.html` (`NOMBRE`, `CODIGO`,
`MINUTOS`, `ANIO`); la imagen Docker debe copiarla o el acceso por código queda apagado.

# Arquitectura del ecosistema CIISIC

Documento de referencia compartido por todos los repositorios que participan en las
inscripciones del congreso (CIISIC) y la Semana Sistémica de la Facultad de Ingeniería
de la UNDC. Cada repositorio mantiene sus propias specs (Spec Kit) en `specs/`; aquí se
fijan **los contratos entre sistemas**, que ningún repositorio puede cambiar sin
actualizar este documento.

## Sistemas

| Sistema | Repositorio | Stack | Rol |
|---|---|---|---|
| Landing del congreso | `gians96/ciisic-undc-web` | Nuxt 4 + Tailwind v3 (bun) | Sitio público, inscripción, envío de ponencias |
| Backend del congreso | `gians96/backend-ciisic` | Express 5 + Prisma 6 + MySQL | API multi-evento, consultas DNI, verificación de estudiantes |
| Panel administrativo | `gians96/administrator-ciisic-frontend` | Nuxt 4 + Tailwind v4 (`@tailwindcss/vite`) | Gestión de eventos, inscripciones, tipos, consultas |
| API UNDC (JP) | `gians96/API_UNDC` | Express 4 + Prisma 5 + MySQL | Espejo de SIVIRENO; verificación de estudiantes vía API key |
| Frontend JP | `gians96/app-web-innova` (`app-web-sigenet`) | Nuxt 4 | Gestión de clientes API de API_UNDC |
| Deportes FI (backend) | `gians96/derportes-fi-backend` | NestJS 11 + Prisma 6 + MariaDB | Inscripciones y pagos deportivos; tokens por evento |
| Deportes FI (frontend) | `gians96/derportes-fi-frontend` | Nuxt 4 + Tailwind 4 | Gestión de tokens por evento |

```
ciisic-undc-web ──(BFF Nitro · X-Api-Key del evento · /api/v1/site/*)──► backend-ciisic ◄──(BFF Nitro, cookie httpOnly)── administrator-ciisic-frontend
                                              │  ├─► Decolecta / apiperu  (pool de tokens rotativo, caché, bitácora)
                                              │  ├─► API_UNDC  POST /externo/estudiantes/verificar  (X-API-Key)
                                              │  └─► deportes-fi GET /api/v1/integrations/event/*   (X-Api-Key por evento)
API_UNDC ◄── app-web-sigenet (gestión de Clientes API)      deportes-fi backend ◄── deportes-fi frontend (tokens por evento)
```

## Principios transversales

1. **Secretos salientes** (tokens de proveedores DNI, token de deportes guardado en el
   congreso) se guardan cifrados con AES-256-GCM; nunca se devuelven completos por la API,
   solo un sufijo (`••••1234`).
2. **Credenciales entrantes** (API keys de API_UNDC, tokens de evento de deportes-fi) se
   guardan **solo como hash** (HMAC-SHA256 con un pepper de entorno). El valor en claro se
   muestra una única vez al crearlo o rotarlo.
3. Las llamadas entre sistemas (API_UNDC, deportes-fi) son **servidor a servidor**; esos
   tokens nunca llegan a un navegador. La API del sitio del congreso está abierta a cualquier
   origen y la protege el token de acceso del evento (se recomienda usarlo desde el servidor;
   si se usa en un navegador es público y los límites por token acotan el abuso).
6. **Configuración sin variables de entorno**: cada sistema deja en el entorno solo lo que no
   puede vivir en su BD (conexión y claves maestras); el resto se gestiona desde su panel.
4. Las respuestas de integración devuelven **datos mínimos** (sin teléfonos, correos ni
   DNI de terceros salvo que el contrato lo indique).
5. Todo repositorio documenta sus cambios de contrato en su propia carpeta `specs/` y en
   este archivo.

---

## Contrato 1 — Verificación de estudiantes (API_UNDC)

**Consumidor:** backend-ciisic (`src/api/student-verification`).
**Proveedor:** API_UNDC (`https://api-jp.episundc.pe`).

### Autenticación

- Header `X-API-Key: undc_<token>`.
- El cliente API debe tener el scope `estudiantes:verificar`.
- Errores de autenticación:
  - `401 { "msg": "API_KEY_INVALIDA", "success": false }` — ausente, inexistente, revocada, inactiva o expirada.
  - `403 { "msg": "SCOPE_INSUFICIENTE", "success": false }`.
  - `429` si se supera el límite de 60 solicitudes/minuto por cliente.

### `POST /externo/estudiantes/verificar`

Request (`Content-Type: application/json`):

```json
{
  "email": "2020123456@undc.edu.pe",
  "codigo": "2020123456",
  "dni": "12345678",
  "nombres": "JUAN CARLOS",
  "apellido_paterno": "PEREZ",
  "apellido_materno": "GARCIA"
}
```

- Se requiere `email` **o** `codigo`. El resto es opcional.
- Si `email` es institucional (`@undc.edu.pe`) y la parte local es numérica (8–12 dígitos),
  esa parte local es el código de estudiante.
- Un correo no institucional o institucional no numérico (personal administrativo o
  docente) no identifica a un estudiante: responde `es_estudiante: false` salvo que se
  envíe `codigo`.

Response `200` (siempre 200 si la solicitud es válida, exista o no el estudiante):

```json
{
  "msg": "OK",
  "sucess": true,
  "data": {
    "es_estudiante": true,
    "egresado": false,
    "matriculado_semestre_activo": true,
    "codigo_estudiante": "2020123456",
    "carrera": "INGENIERÍA DE SISTEMAS",
    "coincide_identidad": true,
    "criterio": "NOMBRE",
    "fuente": "CACHE"
  }
}
```

| Campo | Tipo | Significado |
|---|---|---|
| `es_estudiante` | boolean | Existe en SIVIRENO, sin fecha de egreso y activo en el espejo |
| `egresado` | boolean | Tiene fecha de egreso |
| `matriculado_semestre_activo` | boolean \| null | Tiene matrícula en una carga lectiva del semestre activo; `null` si no se pudo determinar |
| `codigo_estudiante` | string \| null | Código resuelto |
| `carrera` | string \| null | Carrera registrada |
| `coincide_identidad` | boolean \| null | Cruce de identidad; `null` si no se enviaron `dni` ni nombres |
| `criterio` | `"DNI"` \| `"NOMBRE"` \| null | Cómo se hizo el cruce |
| `fuente` | `"CACHE"` \| `"SIVIRENO"` | Origen del dato |

- `sucess` conserva la ortografía usada por API_UNDC en sus respuestas.
- **Cruce de identidad**:
  1. Si el espejo tiene el DNI del estudiante y se envió `dni`: coinciden si son iguales (`criterio: "DNI"`).
  2. Si no, por nombres: se normaliza (mayúsculas, sin tildes, `Ñ`→`N`, solo letras), se separa en palabras y se descartan partículas (`DE`, `DEL`, `LA`, `LAS`, `LOS`, `Y`, `SAN`, `MC`).
     Coinciden si **ambos apellidos** enviados aparecen en el nombre SIVIRENO (si solo se
     envía uno, basta ese) **y al menos un nombre** coincide (`criterio: "NOMBRE"`).
- La respuesta **nunca** incluye nombres, teléfono, correo ni DNI.

`400 { "msg": "SOLICITUD_INVALIDA", "success": false, "error": "..." }` si faltan `email` y `codigo` o los formatos son inválidos.

Comportamientos adicionales (implementados en API_UNDC, `specs/002-verificacion-estudiante-externa`):

- `429 { "msg": "LIMITE_EXCEDIDO", "success": false }` con `Retry-After`: 60 solicitudes por
  minuto (ventana deslizante) por cliente y por proceso.
- `503 { "msg": "SERVICIO_NO_DISPONIBLE" }` si no se puede validar la API key; `500 ERROR_INTERNO`
  ante errores inesperados. El congreso trata cualquier respuesta no 2xx como
  "servicio no disponible" (precio regular).
- Si se envían `codigo` y `email`, prevalece `codigo` (8–12 dígitos); `dni` acepta 8–12 caracteres alfanuméricos.
- Cruce por nombres: cada palabra del nombre SIVIRENO se usa una sola vez; faltan apellidos
  o nombres ⇒ no coincide. Estudiante inexistente ⇒ `coincide_identidad: false` si se
  enviaron datos, `null` si no.
- `matriculado_semestre_activo` es `null` si no hay semestre activo o no hay matrículas sincronizadas.
- Si SIVIRENO no responde en una consulta sin caché, responde 200 con `es_estudiante: false`
  y `fuente: "CACHE"` (indistinguible de "no existe"). `carrera` suele venir `null` porque la
  búsqueda pública de SIVIRENO no la devuelve.
- La API key se crea desde app-web-sigenet (Configuraciones → Integraciones → Clientes API)
  o con `npm run api-client:create -- --nombre "Backend CIISIC" --scopes estudiantes:verificar`.
  Se guarda como HMAC-SHA256 (clave derivada de `INTEGRATION_SECRET_KEY`); cambiar esa
  variable invalida todas las keys.

### Regla de negocio en el congreso

`esEstudianteUndc = es_estudiante && !egresado && coincide_identidad === true`.
El backend del congreso envía siempre los nombres que obtuvo **él mismo** de RENIEC
(caché o proveedor), nunca los tipeados por el usuario.

---

## Contrato 2 — Integración de deportes (deportes-fi)

**Consumidor:** backend-ciisic (`src/api/integration`).
**Proveedor:** deportes-fi backend (`<base>/api/v1`).

### Autenticación

- Header `X-Api-Key: dfi_<token>`.
- Cada token pertenece a **un solo** `SportEvent`; el evento se toma **exclusivamente del
  token**, nunca de parámetros.
- `401 { "statusCode": 401, "message": "Token de integración inválido" }` si falta, no
  existe, está revocado o expiró.

### `GET /integrations/event`

```json
{ "id": 3, "name": "Juegos Semana Sistémica 2026", "description": "…", "startDate": "2026-10-19T00:00:00.000Z", "endDate": "2026-10-24T00:00:00.000Z", "isOpen": true }
```

### `GET /integrations/event/summary`

```json
{
  "event": { "id": 3, "name": "Juegos Semana Sistémica 2026", "startDate": "…", "endDate": "…" },
  "currency": "PEN",
  "teams": { "total": 40, "pending": 5, "approved": 32, "rejected": 2, "cancelled": 1 },
  "participants": { "total": 310 },
  "payments": {
    "validated": { "count": 30, "amount": 1500 },
    "pending": { "count": 4, "amount": 200 },
    "rejected": { "count": 1, "amount": 50 }
  },
  "byDiscipline": [
    {
      "disciplineId": 7, "name": "Fútbol 7 varones", "participantType": "STUDENT", "isPaid": true, "cost": 50,
      "teams": { "total": 12, "approved": 10, "pending": 2 },
      "validatedAmount": 500, "pendingAmount": 100
    }
  ],
  "byParticipantType": [
    { "participantType": "STUDENT", "teams": 35, "validatedAmount": 1300, "pendingAmount": 200 },
    { "participantType": "OTHER", "teams": 5, "validatedAmount": 200, "pendingAmount": 0 }
  ],
  "generatedAt": "2026-10-20T15:04:05.000Z"
}
```

- "Recaudado" = suma de `Voucher.amount` con `status = VALIDATED`.
- Montos en soles como número con 2 decimales.

### `GET /integrations/event/payments?status=VALIDATED|PENDING|REJECTED&page=1&pageSize=50`

```json
{
  "data": [
    { "id": 11, "amount": 50, "status": "VALIDATED", "operationNumber": "123456", "uploadedAt": "…", "updatedAt": "…", "teamName": "Los Bits", "disciplineName": "Fútbol 7 varones", "participantType": "STUDENT" }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 35 }
}
```

### `GET /integrations/event/registrations?status=PENDING|APPROVED|REJECTED|CANCELLED&page=1&pageSize=50`

```json
{
  "data": [
    { "id": 21, "name": "Los Bits", "status": "APPROVED", "disciplineName": "Fútbol 7 varones", "participantType": "STUDENT", "participantsCount": 9, "createdAt": "…" }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 40 }
}
```

Ninguna respuesta incluye correos, DNI, códigos de estudiante ni URLs de vouchers.

Comportamientos adicionales (implementados en deportes-fi, `specs/001-tokens-api-por-evento`):

- `400` (formato estándar de NestJS, mensajes en español) si `status` no es válido, `page < 1`
  o `pageSize` fuera de 1–100 (no se recorta).
- `503` en operaciones con tokens si en producción falta `API_TOKEN_PEPPER` (cambiarla
  invalida todos los tokens emitidos).
- Orden: pagos por `uploadedAt` descendente y equipos por `createdAt` descendente (`id` como desempate).
- `operationNumber` puede ser `null`; `description` es HTML saneado o `null`; montos con
  hasta 2 decimales sumados con Decimal.
- `participants.total` cuenta a todos los participantes de todos los equipos; `byDiscipline`
  incluye todas las disciplinas del evento (aunque no tengan equipos); `byParticipantType`
  siempre trae `STUDENT` y `OTHER`.
- Los pagos se clasifican **solo por el estado del voucher**: si se rechaza un equipo cuyo
  voucher estaba `VALIDATED`, ese monto sigue contando como recaudado (a revisar con el
  equipo de deportes).
- Aplica el rate limit global por IP de deportes-fi (120 solicitudes/minuto por defecto).
- Los tokens se generan en el panel de deportes-fi (Eventos → «Tokens API»); formato
  `dfi_` + 43 caracteres base64url; se muestran una sola vez.

---

## Contrato 3 — API del sitio (landing de cada evento)

Definido en `backend-ciisic/specs/007-tokens-acceso-evento/contracts/api-sitio.md` (spec 009).
El evento sale del token de acceso (`X-Api-Key`, generado en el panel; solo se guarda su hash).
CORS está abierto a cualquier origen; la landing lo usa desde su servidor Nitro (BFF) y envía
`X-Client-Ip` para los límites por visitante. Además hay límites por token. Rutas:
`GET /api/v1/site/event`, `/registration-types`, `/catalogs`, `/config`,
`GET /document-lookup/dni/:numero`, `GET /payment-qr/:archivo` (imagen del QR de una billetera,
spec 012; la landing la sirve desde su BFF), `POST /inscriptions`, `/student-verification`,
`/google-verification`, `/papers`, `/contact`.

### Correo conservado al reinscribirse (spec 014)

Definido en `backend-ciisic/specs/014-portal-fotocheck-asistencia/contracts/api-asistencia.md`. Si
el documento ya está registrado con **otro** correo, el backend **no** cambia el correo ni responde
409, **aunque el nuevo venga verificado con Google** (`verificacionCorreoToken` prueba que quien
envía controla el correo nuevo, no que sea el dueño del documento): la inscripción se hace con el
correo registrado y se avisa a ese correo. El cambio de correo lo hace la organización desde el
panel. La respuesta `201` de `POST /api/v1/site/inscriptions` (y de la legacy
`POST /api/v1/inscription`) agrega dos campos:

```json
{ "correoConservado": true, "correoEnmascarado": "a***@g***.com" }
```

- Con `correoConservado: true`, `data.participante.correo` sale enmascarado (`"a***@g***.com"`) y
  `data.participante.celular` oculto por completo (`"*********"`); en la legacy,
  `data.usuario.correoElectronico` y `data.usuario.celular`. `esCorreoVerificado` es `false` (la
  verificación era del correo ingresado). Con `false`, `correoEnmascarado` es `null` y todo sale como
  antes.
- El precio por dominio institucional (categoría general y ruta legacy) se calcula con el correo
  **registrado**: escribir un correo `@undc.edu.pe` ajeno no da el precio institucional.
- **Cambio compatible**: una landing que lo ignore sigue funcionando. Mensaje sugerido cuando es
  `true`: «Ya estabas registrado con {correoEnmascarado}; tu inscripción y tu credencial llegarán a
  ese correo. Si ya no lo usas, escribe a la organización para cambiarlo».
- Una persona **nueva** con un correo de otra persona sigue recibiendo `409 EMAIL_IN_USE`.
- `numeroOperacion` con el prefijo `CORTESIA-` queda reservado (`422 VALIDATION_ERROR`).
- `GET /api/v1/site/config` **no cambia** (`{ google, urlPanel }`).

### Disponibilidad de los tipos de inscripción (spec 016)

Definido en `backend-ciisic/specs/016-disponibilidad-tipos/contracts/api-tipos.md`. Cada tipo de
`GET /api/v1/site/registration-types` trae `disponiblePara`: `TODOS` | `INSTITUCIONAL` (solo a quien
recibe el precio institucional) | `EXTERNOS` (nunca a quien lo recibe). Ejemplo: en el VIII CIISIC,
«Profesionales y público general sin kit» es `EXTERNOS`, así un correo `@undc.edu.pe` solo ve el plan
con kit a su precio institucional.

- La landing oculta el tipo con la **misma regla del precio**: estudiante verificado (categoría
  estudiantil) o correo del dominio institucional (las demás). Campo ausente = `TODOS`.
- `POST /api/v1/site/inscriptions` (y la legacy) responde `422 REGISTRATION_TYPE_NOT_AVAILABLE` si el
  tipo no corresponde, decidido con el correo con que queda la inscripción (el registrado si se conserva).
- **Cambio compatible**: los tipos existentes quedan en `TODOS`; una landing que ignore el campo sigue
  funcionando (solo vería el error al enviar).

## Contrato 4 — API administrativa del congreso (panel)

Definido en `backend-ciisic/specs/002-multi-evento/contracts/api-admin.md`, en las specs
003–012 y, para la autorización, en `specs/013-roles-permisos/contracts/api-roles-permisos.md`.
El panel la consume solo a través de su BFF (`/api/backend/**`), que agrega el
`Authorization: Bearer` desde una cookie httpOnly.

### Roles y permisos (spec 013)

- Cuatro roles de staff: **Owner** (`SUPERADMIN`) y **Administrador del sistema** (`ADMIN`),
  globales; **Tesorero** (`TESORERO`) y **Comisión tecnológica** (`COMISION`), solo en los eventos
  asignados. `SUPERADMIN` y `ADMIN` conservan su código hasta después del 30-oct-2026; solo cambia
  el nombre visible (`rolNombre`).
- Cada ruta exige un permiso del catálogo `src/core/permisos.ts`; la cuenta se lee de la BD en cada
  petición. El backend es la autoridad: el panel solo oculta lo que el usuario no puede usar.
- `POST /api/v1/auth/login`, `POST /api/v1/auth/google`, `GET /api/v1/auth/session` y
  `POST /api/v1/auth/refresh` devuelven el usuario con
  `acceso: { alcance: "GLOBAL"|"EVENTO", permisos: string[], eventoIds: number[]|null, perfilParticipante: boolean }`.
  `acceso` no va en el JWT; el panel arma menús, páginas y botones con `acceso.permisos`.
- `POST /api/v1/auth/refresh` (sin cuerpo) renueva el JWT de 1 h antes de que caduque y conserva el
  método de ingreso y el inicio de la sesión: `{ success, data: { jwt, expiraEn, usuario } }`. A las
  12 h del ingreso responde `401 SESSION_EXPIRED` (volver a ingresar).
- Cambiar el correo, la contraseña o el vínculo con Google de una cuenta cierra sus sesiones
  abiertas (`401 SESSION_INVALIDATED` en la siguiente petición), también la de quien se cambia su
  propia contraseña.
- Errores que el panel debe manejar: `401 SESSION_INVALIDATED` y `401 SESSION_EXPIRED` (cerrar la
  sesión; solo ante un 401, no ante un 5xx);
  `403 FORBIDDEN` y `403 EVENT_NOT_ASSIGNED` (refrescar el acceso y la lista de eventos);
  `403 STATUS_NOT_ALLOWED` (cancelar sin `inscripciones.cancelar`); los de la gestión del equipo
  (`ROLE_NOT_ASSIGNABLE`, `ADMIN_NOT_MANAGEABLE`, `LAST_OWNER`, `ADMIN_CHANGED`, `EVENTS_REQUIRED`,
  `EVENT_NOT_FOUND`, `PERMISSIONS_REQUIRED`, `PERMISSION_NOT_ELIGIBLE`) y los de asistencia
  (`OUT_OF_HOURS_NOT_ALLOWED`, `AMBIGUOUS_DOCUMENT`, `PARTICIPANT_NOT_FOUND`).
- Sin `pagos.ver` las respuestas conservan las claves con montos, precios y datos de pago en
  `null`; `GET /api/v1/events` sin `eventos.configurar` devuelve solo los eventos asignados en una
  vista reducida. El panel debe tolerar ambos.
- Compatibilidad: para Owner y Administrador el panel anterior recibe los mismos campos (lo nuevo son
  claves agregadas) y `PUT /api/v1/admin/:id` sigue aceptando `rolCodigo`.

### Escáner, credencial y operación (spec 014)

Definido en `specs/014-portal-fotocheck-asistencia/contracts/api-asistencia.md` (panel: spec 009).

- El QR de la credencial (PDF y fotocheck) lleva el **código de credencial** de 10 caracteres
  `[0-9A-Z]` (`codigoCredencial` en `GET /api/v1/inscriptions/:id`, nunca en listados ni CSV). El
  QR anterior (id del participante) se acepta hasta el `fechaFin` del evento solo en las
  inscripciones marcadas (`esQrLegado`).
- `POST /api/v1/activities/:id/attendances` con exactamente uno de `{ codigo }` (método `QR`),
  `{ numeroDocumento, tipoDocumento? }` (`DOCUMENTO`) o `{ participanteId }` (QR anterior,
  `QR_LEGADO`); `metodo: "MANUAL"` exige `asistencia.fuera_horario`. Se marca desde 30 min antes de
  `horaInicio`. La respuesta agrega `alerta: "QR_LEGADO" | null`, `participante.foto.tiene` e
  `inscripcion: { id, tipoInscripcion }`; la foto se pide con `GET /api/v1/inscriptions/:id/photo`
  (`asistencia.marcar` o `inscripciones.ver`).
- Errores nuevos que el panel debe manejar: `404 CODE_NOT_FOUND`, `409 CODE_OTHER_EVENT`,
  `422 LEGACY_QR_NOT_ALLOWED`, `403 MANUAL_NOT_ALLOWED`, `503 PDF_BUSY` con `Retry-After` (descarga
  de credencial; al aprobar o reenviar llega `credencialEnviada: false`).
- **Lectura del QR en el escáner** (los dos formatos conviven hasta el `fechaFin` del VIII):
  texto leído sin espacios ni saltos de línea → si cumple `/^[0-9A-Za-z]{10}$/`, enviar
  `{ codigo: texto.toUpperCase() }`; si cumple `/^\d+$/`, enviar `{ participanteId: Number(texto) }`
  (QR anterior) y mostrar en ámbar la `alerta: "QR_LEGADO"`; si no, «QR no válido» sin llamar al
  backend. Un código de 10 dígitos (todo números) se trata como código, no como id.
- El número de operación de una cortesía es `CORTESIA-` + 12 hexadecimales aleatorios (sale en
  listados y CSV: nunca lleva el código del QR).
- `POST /api/v1/participants` (`participantes.gestionar`; `409 PARTICIPANT_EXISTS` con
  `fields.id`, `409 EMAIL_IN_USE`, `422 NAMES_REQUIRED`) y
  `POST /api/v1/events/:eventId/courtesy-inscriptions` (`inscripciones.cortesia`).
- **Orden de despliegue**: primero (o a la vez) el panel 009, que lee los dos formatos de QR; nunca
  el backend 014 solo. Con el panel anterior, cada credencial que se apruebe, reenvíe o descargue
  lleva el QR nuevo y su escáner lo rechaza en el navegador («usa DNI / documento»).

---


## Contrato 5 — Acceso con Google, código por correo y portal del inscrito

Definidos en `backend-ciisic/specs/010-google-sign-in/contracts/api-google.md`,
`specs/011-portal-participante/contracts/api-portal.md` y, desde la spec 014,
`specs/014-portal-fotocheck-asistencia/contracts/api-acceso-codigo.md` y `api-portal.md` (v2).

- El panel obtiene de `GET /api/v1/auth/config` el client ID de Google, la URL del panel y
  `accesoCodigo: { disponible }`; emite un `nonce` desde su servidor y envía el ID token de Google a
  `POST /api/v1/auth/google`: entra como staff (cuenta activa) o como participante (portal
  `/api/v1/me/*`). Las sesiones llevan audiencia `ciisic-admin` (1 h, renovable hasta 12 h) o
  `ciisic-participante` (12 h, sin renovación).
- **Código por correo** (spec 014), además de Google: `POST /api/v1/auth/participant/code`
  `{ correo }` → `202 { expiraEnSegundos: 600, reintentarEnSegundos: 60 }` siempre igual (exista o
  no el correo, también si está vinculado a Google); `POST /api/v1/auth/participant/code/verify`
  `{ correo, codigo }` → `{ jwt, tipo: "PARTICIPANTE", participante, expiraEn }` (`metodo:
  "CODIGO"`). El código **siempre** abre una sesión de participante, nunca de staff. Errores:
  `429 CODE_COOLDOWN`, `401 INVALID_CODE` (`fields.restantes`), `401 CODE_EXPIRED`,
  `429 CODE_LOCKED`, `429 RATE_LIMITED` (muchas solicitudes o códigos incorrectos desde la misma
  red), `503 CODE_LOGIN_UNAVAILABLE` (sin credencial de correo o, con `Retry-After`, tope global de
  envíos), `503 CODE_LOGIN_PAUSED`; las esperas van en `Retry-After` y en `fields` como texto. El BFF llama al backend por la URL interna de Docker y
  reenvía en `X-Forwarded-For` la IP del visitante (la que agrega su proxy, no la primera de la
  cadena, que el cliente puede falsificar): los topes por IP usan esa IP.
- **Staff → portal**: `POST /api/v1/auth/participant/switch` (Bearer de staff, sin cuerpo) devuelve
  la misma sesión de participante si la sesión del staff es de Google y hay un participante con su
  correo; con contraseña `409 CODE_REQUIRED` (pedir el código), sin inscripción
  `404 PARTICIPANT_NOT_FOUND`, otra cuenta Google `403 GOOGLE_ACCOUNT_MISMATCH` o
  `409 GOOGLE_ACCOUNT_IN_USE`. Un solo sentido; `acceso.perfilParticipante` (spec 013) indica si
  ofrecerlo.
- **Portal v2**: `GET /me` (+ `celular`, `foto`, `google`), `PATCH /me/profile` (solo celular),
  `GET /me/inscriptions` (+ `fotocheck.disponible`), `GET /me/inscriptions/:id/badge` (fotocheck:
  código, QR en data URL, evento, documento enmascarado, tipo, foto), `GET /me/attendances`,
  `PUT|GET|DELETE /me/photo` (JPG/PNG ≤ 2 MB y ≤ 4096 px por lado —si no, `422 IMAGE_TOO_LARGE`—,
  `consentimiento=true`; el panel recodifica y reduce la imagen con canvas). Todo con `Cache-Control: private, no-store`.
- La landing verifica opcionalmente el correo con `POST /api/v1/site/google-verification` y envía
  el token resultante con la inscripción; con o sin él, un correo distinto del registrado se
  conserva (contrato 3).

## Entornos locales de desarrollo

| Servicio | Puerto | Base de datos local (Docker) |
|---|---|---|
| ciisic-undc-web | 3000 | — |
| administrator-ciisic-frontend | 3001 | — |
| backend-ciisic | 3010 | MySQL 8.4 `ciisic_vii` en `localhost:3310` |
| API_UNDC | 3020 | MySQL 8.4 `jp` en `localhost:3310` |
| deportes-fi backend | 3030 | MariaDB 11 `deportes_fi` en `localhost:3311` |

Nunca se ejecutan migraciones contra bases de datos de producción desde un entorno local.

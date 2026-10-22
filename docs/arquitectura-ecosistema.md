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
`/google-verification`, `/papers`, `/contact`, `GET /specialized-talks` y
`POST /specialized-talk-registrations` (spec 019) y `POST /specialized-talk-eligibility` (spec 030).

### Ponencias especializadas (spec 019)

- Contrato: `backend-ciisic/specs/019-ponencias-especializadas/contracts/api-ponencias-especializadas.md`.
- `GET /api/v1/site/specialized-talks`: ponencias `publicada` del evento del token, con `cuposDisponibles`
  y `llena`, sin datos personales.
- `POST /api/v1/site/specialized-talk-registrations` (`{ asistente, ponenciaIds[1..4] }`): todo o nada;
  rechaza ponencias que se cruzan (`409 SCHEDULE_CONFLICT`), sin cupo (`409 TALK_FULL`), terminadas
  (`409 TALK_ENDED`), no disponibles (`404 TALK_NOT_FOUND`) y de pago (`422 PAID_TALK_UNAVAILABLE`).
  Repetir es idempotente (`yaInscrito`) y nunca modifica a una persona que ya existe.
- **Cambio compatible**: rutas nuevas; la landing anterior no las usa.
- **Spec 030** (`backend-ciisic/specs/030-ponencias-validacion-congreso/contracts/api-ponencias-validacion-congreso.md`): solo se
  inscribe un congresista con la inscripción `APROBADO` (documento y correo en la landing; documento en staff y puerta), salvo que el
  evento tenga encendido el **acceso libre** (`GET|PUT /api/v1/events/:eventId/specialized-talks/access`, `meta.accesoLibre` en la lista
  del sitio). Ruta nueva `POST /api/v1/site/specialized-talk-eligibility` (documento + correo → modo presencial o virtual). Solo el modo
  presencial ocupa el `cupo`; `cuposDisponibles` y `llena` son del aforo presencial. Errores: `CONGRESS_REGISTRATION_NOT_FOUND`,
  `CONGRESS_PAYMENT_PENDING`, `CONGRESS_REGISTRATION_REJECTED`, `FREE_ACCESS_ENABLED`. Cambio aditivo (migración con valores por defecto).

### Delegaciones con planes propios (specs 021, 022, 023 y 029)

Definido en `backend-ciisic/specs/029-delegaciones-planes/contracts/api-delegaciones-planes.md` (reemplaza la tarifa global y el registro
público de las specs 021–024). El **staff** crea cada delegación con sus **planes** (Con kit, Sin kit y Virtual, cada uno con su precio) y comparte
sus links, sin menú ni enlaces en la landing. Rutas del sitio: `GET /api/v1/site/delegations/link/:codigoLink` (la vista del delegado) con
`POST …/link/:codigoLink/participants` y `POST …/link/:codigoLink/payments` (multipart), y el **link individual**
`GET /api/v1/site/delegations/join/:codigoInscripcion` + `POST …/join/:codigoInscripcion/participants` (cada integrante se inscribe solo, sin Google).

- **El servidor decide el tipo y el precio**; el cliente solo envía el `plan` de cada integrante (`CON_KIT`, `SIN_KIT` o `VIRTUAL`). Cada plan es un tipo
  de la categoría oculta de la delegación y puede tener precio promocional desde `minIntegrantes`; al cruzarlo, todos los integrantes de ese plan pasan al precio nuevo.
- Con **dominio** en la delegación (`dominioCorreo`, p. ej. `unac.edu.pe`) los correos deben terminar en él (`422 EMAIL_DOMAIN_NOT_ALLOWED`) y en el link individual
  basta escribir el prefijo (`correoPrefijo`). Link apagado, de otro evento o inexistente: `404`.
- **Pagos múltiples** (`delegacion_pagos`): del grupo; cada voucher lleva su archivo, medio, número de operación (único en el evento), fecha y el monto que dice; el staff lo
  verifica o rechaza. Cada inscripción del grupo lleva un número de operación interno (`DELEGACION-<uuid>`).
- Con su link el delegado **solo agrega** integrantes y vouchers: no hay rutas del sitio para borrar ni editar. Las vistas **exigen el token del evento** (otro evento → `404`) y
  enmascaran documentos y números de operación; no exponen el correo ni el teléfono del delegado.
- **Cambio incompatible** (deliberado, con la sección oculta y sin integrantes en producción): se retiran `GET /site/delegations/tarifa` y `POST /site/delegations`. Orden de
  despliegue: backend, panel y landing.

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

### Tipos que no admiten estudiantes UNDC (spec 020)

Definido en `backend-ciisic/specs/020-virtual-sin-estudiantes-undc/contracts/api-excluye-estudiantes.md`.
Cada tipo de `GET /api/v1/site/registration-types` trae `excluyeEstudiantesUndc` (booleano; ausente = no
excluye). «Estudiante UNDC» = verificación de SIVIRENO positiva **o** correo `<8–12 dígitos>@<dominio del
evento>`; docentes, administrativos y externos no lo son. La landing oculta el tipo a los estudiantes UNDC
y `POST /api/v1/site/inscriptions` responde `422 REGISTRATION_TYPE_NOT_AVAILABLE` («…no está disponible
para estudiantes de la UNDC. Elige un plan presencial.») si llegan a enviarlo. No cambia el precio ni
`disponiblePara`. Cambio compatible: la forma LEGACY no lleva el campo, y un backend anterior descarta el
que envía el panel (backend primero).

### Modalidad de asistencia (spec 018)

Definido en `backend-ciisic/specs/018-modalidad-virtual/contracts/api-modalidad.md`. Cada tipo de
`GET /api/v1/site/registration-types` trae `modalidad`: `PRESENCIAL` | `VIRTUAL` (cómo se asiste con
ese tipo). Ejemplo: en el VIII CIISIC los tipos `estudiantes_virtual` (S/ 30) y `general_virtual`
(S/ 50) viven **dentro de las categorías existentes** `ESTUDIANTES` y `PUBLICO_GENERAL`, con
`precio == precioInstitucional` y `disponiblePara = TODOS`: el monto es el mismo con cualquier correo y
el descuento es 0. La modalidad **no cambia el precio** ni el significado de `disponiblePara`.

- La clave `modalidad` va **siempre dentro del objeto del tipo** (`tipo.modalidad`,
  `tipoInscripcion.modalidad`), nunca en la raíz de una inscripción: `pago.modalidad` / `modalidadPago`
  (`banco` | `billetera` | `cortesia`) es otra cosa. Tampoco es el «fotocheck virtual» (credencial
  digital del portal) ni las «Modalidad 01/02/03» de `/planes` (categorías de precios).
- La landing separa los tipos presenciales de los virtuales con este campo (no interpreta etiquetas ni
  nombres). Campo ausente, `null` o desconocido = `PRESENCIAL`.
- `POST /api/v1/site/inscriptions` (201) agrega `tipoInscripcion.modalidad`. La verificación de
  estudiante (SIVIRENO) y el flujo de la categoría estudiantil no cambian. No hay errores nuevos.
- **Cambio compatible**: backend nuevo + landing anterior → el tipo virtual aparece como un plan más
  (etiqueta «VIRTUAL») y la inscripción funciona; landing nueva + backend anterior → todo se lee
  `PRESENCIAL`. La forma LEGACY (`GET /api/v1/registration-types`, rutas de la landing anterior) está
  congelada y **no** lleva `modalidad`: mientras estén encendidas, los tipos virtuales aparecen en ella
  como planes normales.
- Textos neutros hasta que la organización responda (entrega del acceso a la transmisión,
  certificado y asistencia de los virtuales, constancia de estudiante): sin enlaces, sin promesas de
  horas ni de certificado; nada se bloquea.

### Reinscripción tras un rechazo o una cancelación (spec 017)

- `POST /api/v1/site/inscriptions` (y la legacy) ya no responde `409 ALREADY_REGISTERED` cuando la
  inscripción anterior de la persona en el evento está `RECHAZADO` o `CANCELADO`: reutiliza esa fila
  (mismo `id`) con los datos nuevos y la deja `PENDIENTE`. Con `PENDIENTE`, `EN_REVISION` o `APROBADO`
  sigue respondiendo `409 ALREADY_REGISTERED`.
- **Cambio compatible**: la respuesta `201` tiene la misma forma; la landing no necesita cambios.
- Eliminar inscripciones (`DELETE /api/v1/inscriptions/:id`) pasa a ser **solo del Owner**
  (`inscripciones.eliminar` sale del Administrador del sistema).

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
- Ponencias especializadas (spec 019): cuatro permisos nuevos — `especializadas.gestionar` (global:
  Owner y Administrador), `especializadas.ver`, `.inscribir` y `.asistencia` (por evento; los dos
  últimos implican `.ver`). Los tres por evento son elegibles para la Comisión. Rutas y errores en
  `specs/019-ponencias-especializadas/contracts/api-ponencias-especializadas.md`. Un panel anterior
  simplemente no muestra esas pantallas.

### Delegaciones (specs 021, 022, 023 y 029)

Definido en `specs/029-delegaciones-planes/contracts/api-delegaciones-planes.md`. Grupos que inscriben a sus integrantes con **planes y precios propios** por delegación; el servidor
decide el precio de cada uno según su plan y el tamaño del grupo (ver el contrato 3). Cada alta, baja, cambio de plan o de precio recalcula el `monto` de las inscripciones activas
del grupo (los `RECHAZADO` y `CANCELADO` no cuentan).

- `GET|POST /api/v1/events/:eventId/delegations` (`delegaciones.ver`; `delegaciones.gestionar` o `delegaciones.inscribir` para crear): lista y alta (delegado con documento, correo y celular;
  integrantes opcionales; `planes`, `minIntegrantes`, `dominioCorreo` e `inscripcionIndividual` solo con `delegaciones.gestionar`). Cada delegación trae sus `planes[]`, los links
  (`codigoLink`, `codigoInscripcion`; solo para quien inscribe o gestiona), el resumen `pago` (`totalAPagar`, `declarado`, `verificado`, `saldo`; solo con `pagos.ver`).
- `GET /api/v1/delegations/:id` (detalle con `pagos[]` e `inscripciones[]` con su `plan`) y `PUT` (datos del grupo, `delegaciones.inscribir`).
- `PUT /api/v1/delegations/:id/config` y `POST …/links/regenerate` (`delegaciones.gestionar`, global): planes y precios, mínimo, dominio y links.
- `POST /api/v1/delegations/:id/inscriptions` (alta manual o masiva, máximo 200, cada uno con su `plan`), `PATCH …/inscriptions/:inscriptionId` (cambiar de plan) y
  `DELETE …` (solo integrantes no aprobados), todos `delegaciones.inscribir`.
- `POST /api/v1/delegations/:id/approve`: aprueba a los integrantes por revisar y envía las credenciales en diferido, una por una (`inscripciones.validar`).
- Vouchers: `POST /api/v1/delegations/:id/payments` (multipart, `delegaciones.inscribir`), `PATCH …/payments/:paymentId` (`PENDIENTE`, `VERIFICADO` o `RECHAZADO`, `inscripciones.validar`) y
  `DELETE …` (`delegaciones.gestionar`); el archivo en `GET …/payments/:paymentId/voucher` (`pagos.ver`).
- Se retiran `GET|PUT /api/v1/events/:eventId/delegations/tarifa` (spec 024). Los planes viven en una categoría oculta por delegación: no salen en `registration-categories`.
- En `GET /api/v1/events/:eventId/inscriptions` y `GET /api/v1/inscriptions/:id` cada fila/detalle incluye `delegacion` (`null` si es individual): `id`, `nombre`, `codigoLink` y
  `totalIntegrantes`; en el detalle también el resumen `pago` (solo con `pagos.ver`).

### Seguimiento por asesor (spec 025)

Definido en `specs/025-reportes-asesores/contracts/api-seguimiento-asesores.md` (panel: spec 016). El padrón de
estudiantes de la facultad y sus asesores viven en el backend; **el pago no se guarda**: cada consulta cruza el
padrón con las inscripciones del evento (documento, código de estudiante o correo) y *pagó* es solo una inscripción
`APROBADO`.

- `GET /api/v1/events/:eventId/advisory/summary` y `…/students` (`reportes.ver`): indicadores, cuadros por ciclo,
  sección y asesor, y el listado paginado, con filtros (`asesorId`, `ciclo`, `seccion`, `turno`, `situacion`, `q`).
- `GET …/advisory/export?formato=xlsx|pdf` (`reportes.exportar`): el mismo reporte, por asesor o general.
- `POST …/advisory/import` (`reportes.gestionar`, solo Owner y Administrador): sube el Excel; `?simular=true` solo valida.
- Sin `pagos.ver` los montos, fechas de pago y el recaudado van en `null`.

#### Enlace público por docente (spec 026)

Contrato en `specs/026-enlaces-docentes/contracts/api-enlaces-docentes.md` (panel: spec 017). Cada asesor puede tener un token
personal (256 bits) con el que ve, **sin sesión**, cómo van sus estudiantes. El enlace lo arma el panel:
`<origen del panel>/seguimiento#<token>` (lo que va tras el `#` no se envía a ningún servidor); el BFF del panel lo reenvía al
backend en `X-Link-Token`, nunca en una URL.

- `GET|POST /api/v1/events/:eventId/advisory/links` y `DELETE …/links/:asesorId` (`reportes.gestionar`, global): listar, crear/renovar y
  desactivar enlaces. El token es una credencial: ni el Tesorero ni la Comisión lo ven.
- `GET /api/v1/public/advisor` y `GET …/export?formato=xlsx|pdf` (sin sesión, `X-Link-Token`): solo los estudiantes de ese asesor y
  **solo** nombre, código, ciclo, sección, turno, celular y situación (nunca DNI, correo ni montos). Token inválido, desactivado o
  renovado: `404 LINK_NOT_FOUND`, siempre igual.
- Recargar el padrón conserva los enlaces por nombre del asesor.

#### Enlace público por ciclo (spec 027)

Contrato en `specs/027-enlaces-ciclo/contracts/api-enlaces-ciclo.md` (panel: spec 018). Igual que el del docente, pero para un ciclo
completo (todas sus secciones): `<origen del panel>/seguimiento/ciclo#<token>`, token en `X-Link-Token`.

- `GET|POST /api/v1/events/:eventId/advisory/cycle-links` y `DELETE …/cycle-links/:ciclo` (`reportes.gestionar`, global): listar los ciclos del
  padrón con su enlace, crear/renovar y desactivar.
- `GET /api/v1/public/cycle` y `GET …/export?formato=xlsx|pdf` (sin sesión): todos los estudiantes del ciclo con nombre, código, ciclo,
  sección, turno y situación, y el asesor de cada sección; **sin** celular, DNI, correo ni montos. Un token de docente no abre un ciclo.
- Los enlaces viven en `enlaces_ciclo`: recargar el padrón no los toca.

#### Docentes y consulta con el DNI (spec 028)

Contrato en `specs/028-docentes-dni/contracts/api-docentes-dni.md` (panel: spec 019). Los docentes ya no dependen del Excel: se les registra el **DNI** y se editan sus secciones
desde el panel, y entran a **una sola página común** escribiendo su DNI.

- `GET|POST /api/v1/events/:eventId/advisory/advisors` y `PUT|DELETE …/advisors/:asesorId` (`reportes.gestionar`, global): listar, agregar, editar (nombre, DNI y secciones) y eliminar. El DNI es dato personal: solo sale aquí.
- `POST /api/v1/public/advisor/lookup` y `…/lookup/export` (sin sesión, `{ documento }` en el cuerpo): la misma vista y reporte que el enlace personal, de los estudiantes de ese docente; **no devuelve el DNI**. DNI inválido o desconocido: el mismo
  `404 ADVISOR_DOCUMENT_NOT_FOUND`. Límite: 10 intentos **fallidos** cada 15 min por IP.
- Recargar el padrón (`asesores=conservar|reemplazar`) conserva por defecto a los docentes, sus DNI, sus secciones editadas y sus enlaces.

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

### Modalidad de asistencia (spec 018)

Definido en `specs/018-modalidad-virtual/contracts/api-modalidad.md`. Todo aditivo; ausente, `null` o
desconocida = `PRESENCIAL` (también una cortesía sin tipo).

- **Tipos**: `GET /api/v1/events/:eventId/registration-categories` → `tipos[].modalidad` (también sin
  `pagos.ver`: no es un precio). `POST /api/v1/registration-categories/:id/types` y
  `PUT /api/v1/registration-types/:id` aceptan `modalidad` (`PRESENCIAL` | `VIRTUAL`; otro valor o
  `null` → `422 VALIDATION_ERROR` con `fields.modalidad`; al crear sin ella, `PRESENCIAL`; al
  actualizar sin ella, se conserva). Las respuestas de crear y actualizar la incluyen. Crear un evento
  copiando otro (`copiarDeEventoId`) copia la modalidad de cada tipo. La modalidad se lee del tipo en
  tiempo real: cambiarla en un tipo con inscripciones es válido pero **retroactivo** (filtro, CSV,
  resumen, escáner, credencial y correo de todas sus inscripciones); la respuesta de actualizar trae
  `totalInscripciones` para que el panel lo avise.
- **Inscripciones**: `tipoInscripcion.modalidad` en la lista, el detalle y la creación. Filtro nuevo
  `?modalidad=PRESENCIAL|VIRTUAL` en `GET /events/:eventId/inscriptions` y en `/export` (se combina con
  `?categoria=`; otro valor → `422`). CSV: columna **«Modalidad de asistencia»** (también sin
  `pagos.ver`); la columna «Modalidad» de siempre es la de **pago** y no se renombra.
- **Resumen**: `GET /api/v1/events/:id/summary` → `porTipo[].modalidad` y
  `totales.porModalidad = [{ modalidad, inscripciones, aprobadas, montoAprobado }]` (siempre las dos;
  `montoAprobado` en `null` sin `pagos.ver`). Un evento sin tipos virtuales trae `VIRTUAL` en cero: el
  panel muestra el bloque «por modalidad» solo si hay actividad virtual (`inscripciones > 0` en
  `VIRTUAL` o algún `porTipo[].modalidad` `VIRTUAL`), para que un evento anterior se vea igual.
- **Portal y escáner**: `GET /me/inscriptions` y `GET /me/inscriptions/:id/badge` →
  `tipoInscripcion.modalidad`; `POST /activities/:id/attendances` → `inscripcion.tipoInscripcion.modalidad`.
  El escáner solo avisa «participante virtual»: la marca se registra igual (sin `403` ni `409` nuevos).
- **Credencial y correo**: el PDF lleva «Modalidad: VIRTUAL» solo si el tipo es virtual (entra en la
  huella; `VERSION_PLANTILLA` 3, así que los PDF guardados se regeneran al pedirlos) y el correo de
  aprobación agrega un párrafo neutro solo para virtuales.
- **Orden de despliegue**: respaldo → backend (`migrate deploy`) → panel y landing → crear los tipos
  virtuales (`prisma/preflight/configurar-virtual.sql` o el panel) → verificar (`verificar-virtual.sql`).
  Ningún orden da errores (el campo es aditivo), pero **el backend va primero**: el anterior descarta en
  silencio la `modalidad` que envía el panel, y un tipo creado o editado desde el panel antes queda
  `PRESENCIAL` (`verificar-virtual.sql` lo detecta). Los tipos van al final porque nacen activos y la
  landing anterior los mostraría como planes normales, sin separarlos. Detalle y reversión en
  `docs/operacion.md` (Migración 018).

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

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
ciisic-undc-web ──(REST /api/v1/public/*)──► backend-ciisic ◄──(BFF Nitro, cookie httpOnly)── administrator-ciisic-frontend
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
3. Las llamadas entre sistemas son **servidor a servidor**; ningún token de integración
   llega a un navegador.
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

---

## Contrato 3 — API pública del congreso (landing)

Definido en `backend-ciisic/specs/002-multi-evento/contracts/api-publica.md`.
Resumen: `GET /api/v1/public/events/:codigo`, `GET …/registration-types`,
`POST …/inscriptions`, `POST …/student-verification`, `POST …/papers`, `POST …/contact`,
`GET /api/v1/public/document-lookup/dni/:numero`.

## Contrato 4 — API administrativa del congreso (panel)

Definido en `backend-ciisic/specs/002-multi-evento/contracts/api-admin.md` y en las specs
003–005. El panel la consume solo a través de su BFF (`/api/backend/**`), que agrega el
`Authorization: Bearer` desde una cookie httpOnly.

---

## Entornos locales de desarrollo

| Servicio | Puerto | Base de datos local (Docker) |
|---|---|---|
| ciisic-undc-web | 3000 | — |
| administrator-ciisic-frontend | 3001 | — |
| backend-ciisic | 3010 | MySQL 8.4 `ciisic_vii` en `localhost:3310` |
| API_UNDC | 3020 | MySQL 8.4 `jp` en `localhost:3310` |
| deportes-fi backend | 3030 | MariaDB 11 `deportes_fi` en `localhost:3311` |

Nunca se ejecutan migraciones contra bases de datos de producción desde un entorno local.

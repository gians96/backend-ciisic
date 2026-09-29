# API

Base `/api`. Respuestas de éxito `{ "success": true, "data": … , "meta"? }`; errores
`{ "success": false, "code", "message", "fields"? }` con códigos estables (p. ej.
`VALIDATION_ERROR`, `EVENT_TOKEN_REQUIRED`, `RATE_LIMITED`). CORS abierto a cualquier origen
(sin cookies): la API la protege el token.

## Autenticación por audiencia

| Audiencia | Cómo | Rutas |
|---|---|---|
| Administración | `Authorization: Bearer <JWT>` (aud `ciisic-admin`); roles `SUPERADMIN` / `ADMIN` | `/api/v1/events…`, `/inscriptions…`, `/settings`, `/email-credentials`, `/lookup-tokens`, `/admin`, … |
| Sitio del evento (landing u otra plataforma) | `X-Api-Key: <token de acceso del evento>` (+ `X-Client-Ip` desde un BFF) | `/api/v1/site/*` |
| Portal del inscrito | `Authorization: Bearer <JWT>` (aud `ciisic-participante`) | `/api/v1/me/*` |
| Sesión y configuración pública | sin token (con límites) | `POST /api/v1/auth/login`, `POST /api/v1/auth/google`, `GET /api/v1/auth/config` |

Un token de un perfil en rutas de otro responde `403 FORBIDDEN`.

## Contratos (fuente de verdad)

| Área | Contrato |
|---|---|
| Administración (eventos, tipos, inscripciones, actividades) | [`specs/002-multi-evento/contracts/api-admin.md`](../specs/002-multi-evento/contracts/api-admin.md) |
| Consultas DNI y pool de tokens | [`specs/003-consultas-dni/contracts/api-consultas.md`](../specs/003-consultas-dni/contracts/api-consultas.md) |
| Verificación de estudiantes | [`specs/004-verificacion-estudiante/contracts/api-verificacion.md`](../specs/004-verificacion-estudiante/contracts/api-verificacion.md) |
| Integraciones (deportes-fi) | [`specs/005-integracion-deportes/contracts/api-integraciones.md`](../specs/005-integracion-deportes/contracts/api-integraciones.md) |
| Credenciales de correo | [`specs/006-credenciales-correo/contracts/api-credenciales-correo.md`](../specs/006-credenciales-correo/contracts/api-credenciales-correo.md) |
| API del sitio y tokens de acceso | [`specs/007-tokens-acceso-evento/contracts/api-sitio.md`](../specs/007-tokens-acceso-evento/contracts/api-sitio.md) |
| Configuración del sistema | [`specs/008-configuracion-sistema/contracts/api-configuracion.md`](../specs/008-configuracion-sistema/contracts/api-configuracion.md) |
| Acceso con Google | [`specs/010-google-sign-in/contracts/api-google.md`](../specs/010-google-sign-in/contracts/api-google.md) |
| Portal del inscrito | [`specs/011-portal-participante/contracts/api-portal.md`](../specs/011-portal-participante/contracts/api-portal.md) |
| Rutas legacy (landing anterior) | [`specs/002-multi-evento/contracts/api-publica.md`](../specs/002-multi-evento/contracts/api-publica.md) |

## Límites

- Por visitante (IP; en la API del sitio, `X-Client-Ip` con token válido): lecturas 120/min,
  inscripción 10/15 min, verificación 20/min, DNI 10/min, ponencias 10/15 min, contacto
  5/15 min, login 10/15 min.
- Por token del sitio: lecturas 3000/min, DNI 60/min y 1500/día, verificación 50/min, Google
  300/min, inscripciones 150/15 min, ponencias y contacto 60/15 min.
- Por participante (portal): 60/min; descarga de credencial 10/min.

## Salud

`GET /health` → `{ status: 'ok' }` (consulta la BD). Lo usa el `HEALTHCHECK` de la imagen.

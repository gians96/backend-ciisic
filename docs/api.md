# API

Base `/api`. Respuestas de éxito `{ "success": true, "data": … , "meta"? }`; errores
`{ "success": false, "code", "message", "fields"? }` con códigos estables (p. ej.
`VALIDATION_ERROR`, `EVENT_TOKEN_REQUIRED`, `RATE_LIMITED`). CORS abierto a cualquier origen
(sin cookies): la API la protege el token.

## Autenticación por audiencia

| Audiencia | Cómo | Rutas |
|---|---|---|
| Administración (staff) | `Authorization: Bearer <JWT>` (aud `ciisic-admin`); permiso por ruta según el rol: Owner, Administrador del sistema, Tesorero o Comisión (spec 013) | `/api/v1/events…`, `/inscriptions…`, `/settings`, `/email-credentials`, `/lookup-tokens`, `/admin`, `POST /api/v1/auth/refresh`, … |
| Sitio del evento (landing u otra plataforma) | `X-Api-Key: <token de acceso del evento>` (+ `X-Client-Ip` desde un BFF) | `/api/v1/site/*` |
| Portal del inscrito | `Authorization: Bearer <JWT>` (aud `ciisic-participante`) | `/api/v1/me/*` |
| Sesión y configuración pública | sin token (con límites) | `POST /api/v1/auth/login`, `POST /api/v1/auth/google`, `GET /api/v1/auth/config` |

Un token de un perfil en rutas de otro responde `403 FORBIDDEN`.

Staff (spec 013): la guarda `requirePermiso` lee la cuenta de la BD en cada petición.
`401 SESSION_INVALIDATED` si la cuenta se borró, se desactivó o tiene un rol desconocido, o si
cambiaron su correo, su contraseña o su cuenta Google desde que se firmó el JWT;
`403 FORBIDDEN` sin el permiso de la ruta; las cuentas con eventos asignados (Tesorero, Comisión)
reciben `403 EVENT_NOT_ASSIGNED` fuera de sus eventos y `404 NOT_FOUND` si el recurso no existe.
El login, Google, `GET /api/v1/auth/session` y `POST /api/v1/auth/refresh` devuelven el usuario con
`acceso` (alcance, permisos y eventos). La renovación conserva el inicio de la sesión y se corta a
las 12 h (`401 SESSION_EXPIRED`). Sin `pagos.ver` los montos y datos de pago salen en `null`.

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
| Roles, permisos y alcance por evento (permiso de cada ruta, sesión con `acceso`, equipo) | [`specs/013-roles-permisos/contracts/api-roles-permisos.md`](../specs/013-roles-permisos/contracts/api-roles-permisos.md) |
| Rutas legacy (landing anterior) | [`specs/002-multi-evento/contracts/api-publica.md`](../specs/002-multi-evento/contracts/api-publica.md) |

## Límites

- Por visitante (IP; en la API del sitio, `X-Client-Ip` con token válido): lecturas 120/min,
  inscripción 10/15 min, verificación 20/min, DNI 10/min, ponencias 10/15 min, contacto
  5/15 min, login 10/15 min.
- Por token del sitio: lecturas 3000/min, DNI 60/min y 1500/día, verificación 50/min, Google
  300/min, inscripciones 150/15 min, ponencias y contacto 60/15 min.
- Por participante (portal): 60/min; descarga de credencial 10/min.
- Por cuenta de staff: marcar asistencia 120/min (solo Tesorero y Comisión), reenvío de
  credencial 20/15 min, renovación de sesión 30/15 min.

## Salud

`GET /health` → `{ status: 'ok' }` (consulta la BD). Lo usa el `HEALTHCHECK` de la imagen.

# Feature Specification: Tokens de acceso por evento (API del sitio)

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "Ten en cuenta que cada evento de congreso tendría su token para que el frontend lo consuma."

## User Scenarios & Testing

### User Story 1 - La landing de cada edición consume la API con su token (Priority: P1)

Como responsable de la landing del VIII CIISIC quiero desplegarla con un único token que
identifique al evento, de modo que no pueda leer ni escribir datos de otro evento.

**Acceptance Scenarios**:

1. **Given** el token del VIII, **When** la landing llama `GET /api/v1/site/event`, **Then**
   recibe el VIII sin indicar código.
2. **Given** un token revocado o expirado, **Then** `401 INVALID_EVENT_TOKEN`.
3. **Given** que falta la cabecera, **Then** `401 EVENT_TOKEN_REQUIRED`.
4. **Given** un evento archivado, **Then** `404 EVENT_NOT_FOUND`.

### User Story 2 - Gestionar los tokens desde el panel (Priority: P1)

Como SuperAdmin quiero generar, ver (sin el valor) y revocar los tokens de un evento.

**Acceptance Scenarios**:

1. **When** genero un token, **Then** lo veo una sola vez; en la BD solo queda su hash.
2. **When** lo revoco, **Then** la landing deja de funcionar con él de inmediato.
3. En la lista veo nombre, prefijo, estado, último uso, expiración y quién lo creó.

### User Story 3 - Límites por visitante (Priority: P1)

Como operador quiero que los límites de consultas DNI, verificación e inscripción sigan siendo
por visitante aunque todas las llamadas lleguen desde el servidor de la landing.

**Acceptance Scenarios**:

1. **Given** un token válido y `X-Client-Ip` con una IP válida, **Then** el límite se aplica a esa IP.
2. **Given** `X-Client-Ip` sin token válido o con un valor que no es IP, **Then** se ignora.

## Requirements

- **FR-001**: Tabla `tokens_acceso` (evento, nombre, prefijo único, hash HMAC-SHA256 único,
  último uso, expiración, revocación, creado por).
- **FR-002**: Formato `ciisic_` + 32 bytes aleatorios (base64url). Hash con clave derivada de
  `SECRETS_ENCRYPTION_KEY`.
- **FR-003**: API del sitio `/api/v1/site/*` (evento, tipos, catálogos, inscripciones,
  verificación de estudiante, consulta DNI, ponencias, contacto): el evento sale solo del token.
- **FR-004**: El token se valida antes de aceptar archivos (multipart).
- **FR-005**: `X-Api-Key` no está permitido por CORS: la API del sitio es solo servidor a servidor
  (BFF Nitro de la landing).
- **FR-006**: `ultimo_uso_en` se actualiza como máximo cada 5 minutos por token.
- **FR-007**: Se retiran `/api/v1/public/*` (no llegó a producción) y `/api/v1/reniec/dni`.
- **FR-008**: Las rutas legacy de la landing anterior siguen activas hasta `LEGACY_ROUTES_ENABLED=false` (→ `410 LEGACY_ROUTE_DISABLED`).

## Success Criteria

- **SC-001**: El pool de consultas DNI (de pago) solo es accesible con un token de evento o como administrador.
- **SC-002**: Una landing nueva se configura con una sola variable (`NUXT_BACKEND_EVENT_TOKEN`).

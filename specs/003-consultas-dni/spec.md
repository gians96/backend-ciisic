# Feature Specification: Módulo de consultas de DNI con pool de tokens

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "Módulo de consultas (Decolecta, apiperu): puedo agregar qué tipo de proveedor es el token, la cantidad de consultas límite que tiene y la fecha de refresco; poder agregar múltiples; si un token falla porque llegó a su límite pasar al siguiente y al siguiente y así poder usarlo siempre."

## User Scenarios & Testing

### User Story 1 - Autocompletar nombres por DNI sin interrupciones (Priority: P1)

Como persona que se inscribe quiero que al escribir mi DNI se completen mis nombres,
aunque uno de los tokens del congreso se haya quedado sin consultas.

**Independent Test**: registrar dos tokens (uno agotado) y consultar un DNI desde la landing.

**Acceptance Scenarios**:

1. **Given** un DNI consultado hace menos de 30 días, **When** se consulta otra vez, **Then**
   se responde desde caché sin gastar consultas.
2. **Given** el token de mayor prioridad responde "cuota agotada", **When** se consulta,
   **Then** se marca `AGOTADO` y la consulta se resuelve con el siguiente token.
3. **Given** un token rechazado (401/403), **When** se consulta, **Then** se marca `INVALIDO`
   y se usa el siguiente.
4. **Given** que un proveedor no encuentra el DNI (apiperu no trae menores de edad),
   **When** hay tokens de otro proveedor, **Then** se prueba con ese proveedor antes de responder 404.
5. **Given** que no hay tokens disponibles, **When** se consulta, **Then** se responde 503 y
   la landing permite escribir los nombres a mano.

### User Story 2 - Gestionar el pool de tokens (Priority: P1)

Como administrador quiero registrar varios tokens indicando proveedor, alias, límite de
consultas, periodo y fecha de renovación y prioridad; ver cuántas consultas lleva cada uno,
su estado y el último error; probarlos, reiniciarlos y desactivarlos.

**Acceptance Scenarios**:

1. **Given** un token nuevo, **When** lo registro, **Then** se guarda cifrado y solo se
   muestra `••••` + últimos 4 caracteres.
2. **Given** un token `AGOTADO` cuya fecha de renovación llegó, **When** ocurre la siguiente
   consulta, **Then** su contador vuelve a 0, pasa a `ACTIVO` y la fecha avanza un periodo.
3. **Given** un token con límite 1000 y 1000 consultas usadas, **Then** no se usa aunque el
   proveedor aún no lo haya rechazado.

### User Story 3 - Auditoría de uso (Priority: P2)

Como administrador quiero ver consultas por día y por token (éxitos, no encontrados,
agotados, errores, caché) sin exponer los DNI completos.

### Edge Cases

- Respuestas del proveedor con código 200 pero mensaje de límite → `AGOTADO`.
- Timeout (8 s) o error de red → se registra y se prueba el siguiente token, sin marcarlo.
- Consultas concurrentes durante la renovación → actualización condicional (idempotente).
- CE (carné de extranjería): no se consulta; los nombres se escriben a mano.

## Requirements

- **FR-001**: Proveedores soportados: `DECOLECTA` (`GET https://api.decolecta.com/v1/reniec/dni?numero=`)
  y `APIPERU` (`POST https://api.apiperu.dev/dni`), ambos con `Authorization: Bearer`.
- **FR-002**: Los tokens se guardan cifrados (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`) y nunca
  se devuelven completos.
- **FR-003**: Selección por `prioridad` ascendente entre tokens `activo` + `ACTIVO` y bajo su límite.
- **FR-004**: Renovación perezosa según `periodo_renovacion` (DIARIO, MENSUAL, ANUAL, NINGUNO).
- **FR-005**: Caché de personas consultadas con TTL configurable (`DNI_CACHE_TTL_DAYS`, 30).
- **FR-006**: Bitácora con DNI enmascarado (`12****78`), proveedor, token, resultado, HTTP, duración y origen.
- **FR-007**: Endpoint público con rate limit (10/min por IP) y alias legacy `/v1/reniec/dni`.
- **FR-008**: Los nombres consultados son la fuente de verdad para inscripciones y para la
  verificación de estudiantes (spec 004).

## Success Criteria

- **SC-001**: Con al menos un token utilizable, 100 % de consultas de DNI válidos obtienen respuesta.
- **SC-002**: Un token agotado deja de usarse en la misma solicitud en que se detecta.
- **SC-003**: Ninguna respuesta de la API contiene un token completo.

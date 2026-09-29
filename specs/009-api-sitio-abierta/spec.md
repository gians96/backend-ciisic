# Feature Specification: API abierta protegida por tokens

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-30
**Status**: Implementado
**Input**: "En los repositorios me parece que deben estar abiertos para todos, para que se puedan consumir y se bloqueen siempre y cuando no tengan el token […] CORS_ORIGINS también lo veo innecesario, porque cada vez que otra plataforma requiera consumir algo necesito esto obligatoriamente."

## User Scenarios & Testing

### User Story 1 - Otra plataforma consume la API con su token (Priority: P1)

Como desarrollador de otra plataforma quiero llamar a la API del sitio desde mi frontend o mi
servidor con el token del evento, sin pedir que agreguen mi dominio a una lista.

**Acceptance Scenarios**:

1. **Given** un token de acceso válido, **When** llamo desde cualquier origen, **Then** CORS lo
   permite (`Access-Control-Allow-Origin: *`, `X-Api-Key` permitido).
2. **Given** que no envío token, **Then** `401 EVENT_TOKEN_REQUIRED`.

### User Story 2 - Un token filtrado no agota el pool DNI (Priority: P1)

Como organizador quiero que, si un token se usa desde un navegador y alguien lo copia, el daño
esté acotado.

**Acceptance Scenarios**:

1. **Given** muchas consultas DNI con el mismo token (aunque varíe `X-Client-Ip`), **Then** al
   superar 60/min o 1500/día el token recibe `429 RATE_LIMITED` y el log lo registra.

## Requirements

- **FR-001**: CORS `origin: '*'`, sin credenciales; cabeceras permitidas `Content-Type`,
  `Authorization`, `X-Api-Key`; expuestas `Content-Disposition`, `Retry-After`, `RateLimit-*`.
- **FR-002**: Límite por token además del límite por visitante en todas las rutas `/v1/site/*`
  (lecturas 3000/min, DNI 60/min y 1500/día, verificación 50/min, Google 300/min,
  inscripciones 150/15 min, ponencias y contacto 60/15 min).
- **FR-003**: Se elimina `CORS_ORIGINS`.

## Success Criteria

- **SC-001**: Integrar una plataforma nueva solo requiere generar un token en el panel.

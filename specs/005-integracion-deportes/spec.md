# Feature Specification: Integración con deportes-fi (Semana Sistémica)

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "En deportes necesito un token para consumir los pagos realizados, por evento y que solo vea ese evento, y poder saber cuánto se hizo, dentro de la semana sistémica de la Facultad de Ingeniería." (Decisión: lo consume el panel del congreso.)

## User Scenarios & Testing

### User Story 1 - Registrar la integración de un evento deportivo (Priority: P1)

Como administrador del congreso quiero pegar el token por evento generado en deportes-fi y
su URL base, probar la conexión y ver a qué evento deportivo pertenece.

**Acceptance Scenarios**:

1. **Given** un token válido, **When** pruebo la conexión, **Then** veo el nombre del evento
   deportivo y el estado `OK`.
2. **Given** un token revocado, **When** pruebo, **Then** el estado queda `ERROR` con el motivo.
3. **Given** una URL `http://` pública o un host no permitido, **When** la guardo, **Then** se rechaza.

### User Story 2 - Resumen de la Semana Sistémica (Priority: P1)

Como organizador quiero ver en el panel cuánto se recaudó en el congreso (inscripciones
aprobadas) y en deportes (vouchers validados), con pendientes y el total.

**Acceptance Scenarios**:

1. **Given** una integración activa, **When** abro el resumen, **Then** veo congreso,
   deportes (por disciplina y tipo de participante) y el total.
2. **Given** que deportes-fi no responde, **Then** el resumen muestra lo del congreso y el
   error de la integración sin fallar.

## Requirements

- **FR-001**: Tabla `integraciones_evento` (varias por evento) con token cifrado y sufijo visible.
- **FR-002**: Llamadas servidor a servidor con `X-Api-Key`; timeout 10 s; sin seguir redirecciones.
- **FR-003**: URL base solo `https` (http únicamente `localhost` fuera de producción) y lista
  opcional `INTEGRATIONS_ALLOWED_HOSTS`.
- **FR-004**: Caché en memoria de 60 s por integración.
- **FR-005**: Se registran `ultimo_estado`, `ultimo_error` y `ultima_sincronizacion_en`.

## Success Criteria

- **SC-001**: El token de deportes nunca sale del backend del congreso.
- **SC-002**: El resumen responde aunque una integración falle.

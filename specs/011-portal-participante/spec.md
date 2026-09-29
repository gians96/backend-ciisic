# Feature Specification: Portal del inscrito

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-30
**Status**: Implementado
**Input**: "Los que se han registrado puedan ver en el sistema de administración su registro y el evento en el que se registró y su estado de registro para que puedan ver cómo va."

## User Scenarios & Testing

### User Story 1 - Ver el estado de mi inscripción (Priority: P1)

**Acceptance Scenarios**:

1. **Given** que me inscribí con un correo de Google (Gmail o institucional), **When** entro al
   panel con Google, **Then** veo "Mis inscripciones": evento, tipo, monto y descuento, pago,
   estado y fecha de revisión.
2. **Given** una inscripción rechazada, **Then** veo el motivo.
3. **Given** una inscripción aprobada, **Then** descargo mi credencial PDF.
4. No puedo ver inscripciones de otras personas (404) ni entrar a páginas de administración (403).

## Requirements

- **FR-001**: `GET /v1/me`, `GET /v1/me/inscriptions`, `GET /v1/me/inscriptions/:id/credential`
  con `requireParticipante` y límite por participante.
- **FR-002**: Sin datos internos (quién revisó, rutas de archivos, verificación detallada).
- **FR-003**: Si un administrador cambia el correo del participante, su sesión deja de valer
  (`401 SESSION_INVALIDATED`).

## Limitaciones

- Solo pueden entrar correos de Google (Gmail o Workspace); el correo debe ser el de la inscripción.

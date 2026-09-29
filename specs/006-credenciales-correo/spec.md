# Feature Specification: Credenciales de correo en BD

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "También gestionar credencial de correo electrónico usando eso, y todas esas apikeys ya no deberían estar [en el entorno] … esas credenciales guárdalas en la base de datos y dime qué parte de las variables de entorno quitar."

## User Scenarios & Testing

### User Story 1 - Gestionar la cuenta de envío desde el panel (Priority: P1)

Como SuperAdmin quiero registrar la API key de Brevo con su remitente, probarla y cambiarla
sin tocar el servidor ni redeplegar.

**Acceptance Scenarios**:

1. **Given** una API key válida, **When** pruebo la credencial, **Then** veo la cuenta de Brevo
   y los créditos del plan, sin que se envíe ningún correo.
2. **Given** una API key revocada, **When** la pruebo, **Then** el estado queda `ERROR` con un
   mensaje legible ("API key de Brevo inválida…").
3. **Given** un remitente no verificado en Brevo, **When** envío un correo de prueba, **Then** veo
   el error de Brevo y el estado `ERROR`.
4. La API key nunca vuelve al navegador: solo `••••` + últimos 4 caracteres.

### User Story 2 - Credencial por evento (Priority: P2)

Como organizador de otro evento (p. ej. la Semana Sistémica) quiero enviar desde otra cuenta o
remitente sin afectar al congreso.

**Acceptance Scenarios**:

1. **Given** un evento con credencial propia activa, **When** se aprueba una inscripción,
   **Then** el correo sale con esa credencial.
2. **Given** que la credencial del evento está inactiva o no existe, **Then** se usa la
   predeterminada; si no hay ninguna activa, la aprobación continúa y el panel ofrece reenviar.

### User Story 3 - Transición sin pasos manuales (Priority: P1)

Como responsable del despliegue quiero que las credenciales que hoy están en variables de
entorno pasen a la BD en el primer arranque de la versión nueva.

**Acceptance Scenarios**:

1. **Given** `BREVO_API_KEY` y `BREVO_SENDER` en el entorno y la tabla vacía, **When** arranca la
   API, **Then** se crea la credencial "Brevo (importado del entorno)" como predeterminada.
2. **Given** `DECOLECTA_TOKEN` y el pool de consultas vacío, **Then** se crea un token de
   Decolecta (sin límite local, renovación mensual, prioridad 1).
3. **Given** que las tablas ya tienen datos, **Then** no se sobrescribe nada y el log indica qué
   variables sobran.

## Requirements

- **FR-001**: Tabla `credenciales_correo` (proveedor BREVO, API key cifrada AES-256-GCM, sufijo,
  remitente, predeterminada, activo, último estado/error, última prueba/envío).
- **FR-002**: `eventos.credencial_correo_id` opcional (ON DELETE SET NULL).
- **FR-003**: Resolución al enviar: credencial del evento activa → predeterminada activa →
  activa más antigua → sin envío (la aprobación no se revierte).
- **FR-004**: Cliente Brevo por `fetch` (API key por solicitud, timeout, sin redirecciones);
  se retiran `sib-api-v3-sdk` y `@getbrevo/brevo`.
- **FR-005**: Siempre hay a lo sumo una predeterminada; la primera creada lo es; al eliminarla se
  promueve otra; no se puede "desmarcar" (se marca otra).
- **FR-006**: Endpoints solo para SuperAdmin.
- **FR-007**: Importación única desde `BREVO_*` y `DECOLECTA_TOKEN` al arrancar (tablas vacías).

## Success Criteria

- **SC-001**: Ninguna API key de proveedor queda en variables de entorno tras la transición.
- **SC-002**: Cambiar de cuenta de correo no requiere redeplegar.

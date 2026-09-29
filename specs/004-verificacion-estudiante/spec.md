# Feature Specification: Verificación de estudiantes UNDC

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado (pendiente de API key de producción)
**Input**: "Usar el API de API_UNDC (api-jp.episundc.pe) para ver si es un estudiante o no: si es estudiante y pone su correo en /estudiantes, saber que es estudiante y habilitarle los kits."

## Decisiones del usuario

- UNDC verificado → precio UNDC; estudiantes de otras universidades pueden elegir planes de
  estudiante a **precio regular** y el administrador los valida al aprobar.
- Antisuplantación: API_UNDC cruza los nombres oficiales (RENIEC) con el nombre del alumno
  en SIVIRENO y responde solo sí/no.

## User Scenarios & Testing

### User Story 1 - Precio UNDC para estudiantes verificados (Priority: P1)

Como estudiante UNDC quiero que, al ingresar mi DNI y mi correo institucional
(`<código>@undc.edu.pe`), el sistema confirme que soy estudiante y me muestre el precio UNDC.

**Acceptance Scenarios**:

1. **Given** DNI consultado en RENIEC y correo institucional de un alumno activo cuyo nombre
   coincide, **When** se verifica, **Then** `esEstudianteUndc = true` y se emite un
   `verificacionToken` firmado (24 h).
2. **Given** ese token, **When** me inscribo en un tipo de la categoría estudiantil, **Then**
   se cobra `precioInstitucional` y la inscripción guarda código de estudiante y el detalle.
3. **Given** el correo de otro alumno con mi DNI, **When** se verifica, **Then**
   `IDENTIDAD_NO_COINCIDE` y se cobra precio regular.

### User Story 2 - Estudiantes externos (Priority: P1)

Como estudiante de otra universidad quiero inscribirme como estudiante pagando el precio
regular; el administrador ve en el panel que no fui verificado como UNDC.

### User Story 3 - Tolerancia a fallas (Priority: P2)

Si API_UNDC no responde, la inscripción continúa a precio regular y queda marcada
`SERVICIO_NO_DISPONIBLE` para revisión.

### Edge Cases

- Correo no institucional → sin llamada a API_UNDC (`CORREO_NO_INSTITUCIONAL`).
- CE → `DOCUMENTO_NO_SOPORTADO` (sin nombres oficiales para cruzar).
- DNI sin nombres oficiales y sin tokens de consulta → `SIN_DATOS_IDENTIDAD`.
- Egresado → `EGRESADO`.
- Token manipulado, expirado o emitido para otro correo/documento/evento → se ignora.

## Requirements

- **FR-001**: `POST /api/v1/public/events/:codigo/student-verification` con
  `{ correo, tipoDocumento, numeroDocumento }` → `{ esEstudianteUndc, codigoEstudiante, motivo, verificacionToken }`.
- **FR-002**: El backend llama a API_UNDC servidor a servidor con `X-API-Key` (contrato 1 de
  `docs/arquitectura-ecosistema.md`), enviando los nombres oficiales que obtuvo él mismo.
- **FR-003**: Regla: `esEstudianteUndc = es_estudiante ∧ ¬egresado ∧ coincide_identidad`.
- **FR-004**: El token es un JWT HS256 (`aud: verificacion-estudiante`) atado a evento,
  documento y correo; solo se emite si la verificación es positiva.
- **FR-005**: La inscripción guarda `es_estudiante_undc`, `codigo_estudiante` y
  `verificacion_estudiante` (instantánea: motivo, carrera, matrícula, criterio, fecha).
- **FR-006**: Ruta legacy: precio por dominio (comportamiento anterior) y verificación
  informativa para el administrador.

## Success Criteria

- **SC-001**: Un correo institucional ajeno no obtiene el precio UNDC.
- **SC-002**: Una caída de API_UNDC no bloquea inscripciones.

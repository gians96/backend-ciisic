# Feature Specification: Plataforma multi-evento

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "El backend guarda la administración de inscripciones y creación de eventos; ahora solo está para un evento, pero debería reusarse para los demás eventos."

## User Scenarios & Testing

### User Story 1 - Inscribirse a un evento concreto (Priority: P1)

Como asistente quiero inscribirme al evento que veo en la landing (p. ej. VIII CIISIC 2026)
eligiendo un tipo de inscripción de ese evento, subir mi voucher y recibir la confirmación,
aunque ya me haya inscrito a una edición anterior.

**Independent Test**: `POST /api/v1/public/events/ciisic-viii-2026/inscriptions` con un
participante nuevo y con uno que ya tiene inscripción en otro evento.

**Acceptance Scenarios**:

1. **Given** un evento publicado con inscripciones abiertas, **When** envío datos válidos y
   voucher, **Then** se crea la inscripción en estado `PENDIENTE` con el monto calculado por
   el servidor.
2. **Given** que ya estoy inscrito en ese mismo evento, **When** intento inscribirme de nuevo,
   **Then** recibo `409 ALREADY_REGISTERED`.
3. **Given** que me inscribí en el evento anterior, **When** me inscribo en el nuevo, **Then**
   se reutiliza mi registro de participante (mismo documento) y se crea la nueva inscripción.
4. **Given** que envío `estadoId=2`, `pago=0` o `descuento=500`, **When** me inscribo, **Then**
   el servidor los ignora (estado `PENDIENTE`, monto del tipo de inscripción).
5. **Given** un evento en `BORRADOR` o con inscripciones cerradas, **When** intento inscribirme,
   **Then** recibo `404 EVENT_NOT_FOUND` o `409 REGISTRATION_CLOSED`.

### User Story 2 - Administrar eventos y tipos de inscripción (Priority: P1)

Como administrador quiero crear eventos (p. ej. IX CIISIC 2027) con sus fechas, datos de
pago, categorías y tipos de inscripción con precios, y copiar la configuración de una
edición anterior, sin tocar código ni redesplegar.

**Acceptance Scenarios**:

1. **Given** el evento VIII, **When** creo el IX indicando `copiarDeEventoId`, **Then** se
   copian sus categorías y tipos de inscripción.
2. **Given** un tipo de inscripción con inscripciones, **When** intento borrarlo, **Then**
   recibo `409` y la sugerencia de desactivarlo.
3. **Given** un evento marcado como principal, **When** marco otro como principal, **Then** el
   anterior deja de serlo.

### User Story 3 - Revisar y aprobar inscripciones por evento (Priority: P1)

Como administrador quiero listar las inscripciones de un evento con filtros y paginación,
ver el voucher, aprobarlas o rechazarlas con motivo, y que al aprobar se genere la
credencial y se envíe por correo con la marca del evento.

**Acceptance Scenarios**:

1. **Given** una inscripción pendiente, **When** la apruebo, **Then** queda `APROBADO`, se
   registra quién y cuándo la revisó, y se envía la credencial (si falla el correo la
   aprobación se mantiene y se informa `credencialEnviada: false`).
2. **Given** que rechazo sin motivo, **Then** recibo `422`.
3. **Given** un nombre con HTML (`<iframe …>`), **When** se genera la credencial, **Then** el
   texto aparece escapado.

### User Story 4 - Asistencia por actividad del evento (Priority: P2)

Como organizador quiero registrar actividades (sesiones) de cada evento y marcar asistencia
solo de participantes con inscripción aprobada en ese evento.

### User Story 5 - Compatibilidad con la landing actual (Priority: P1)

Como equipo quiero desplegar el backend antes que la nueva landing sin romper las
inscripciones en curso: las rutas legacy funcionan contra el evento principal con las
mismas formas de respuesta.

### Edge Cases

- Correo ya usado por otra persona (otro documento) → `409 EMAIL_IN_USE`.
- Número de operación repetido (en cualquier evento) → `409 OPERATION_ALREADY_REGISTERED`.
- Tipo de inscripción de otro evento o inactivo → `422 REGISTRATION_TYPE_INVALID`.
- Sin evento principal configurado → rutas legacy responden `404 EVENT_NOT_FOUND`.
- Carrera de dos aprobaciones simultáneas: la credencial se genera una vez por aprobación;
  reenviar es una acción explícita.

## Requirements

### Functional Requirements

- **FR-001**: Existe la entidad `Evento` con código único, fechas, estado, ventana de
  inscripciones, dominio institucional, contacto, remitente de correo y datos de pago (JSON).
- **FR-002**: Categorías, inscripciones, actividades, ponencias, mensajes e integraciones
  pertenecen a un evento.
- **FR-003**: Una persona (tipo + número de documento) tiene como máximo una inscripción por
  evento (restricción única en BD).
- **FR-004**: La API pública (`/api/v1/public`) se direcciona por `eventos.codigo` y solo
  expone eventos `PUBLICADO` o `FINALIZADO`.
- **FR-005**: El servidor calcula el monto: precio institucional solo con verificación de
  estudiante UNDC válida (categoría estudiantil, spec 004) o correo del dominio institucional
  (categoría general); nunca acepta montos, descuentos ni estados del cliente.
- **FR-006**: El voucher es obligatorio en la ruta nueva y se valida por contenido.
- **FR-007**: Aprobar genera la credencial PDF con los datos del evento (texto escapado) y la
  envía por correo; se registra `revisadoPor`, `revisadoEn`, `credencialEnviadaEn`.
- **FR-008**: Rechazar exige motivo.
- **FR-009**: Listados administrativos paginados y filtrables; exportación CSV de inscripciones.
- **FR-010**: Resumen (KPIs) por evento: por estado, por tipo, por día y montos.
- **FR-011**: Las rutas legacy de la landing actual siguen funcionando contra el evento
  principal con su forma de respuesta anterior.
- **FR-012**: El login rechaza administradores inactivos; los roles se validan por código.

### Key Entities

- **Evento**: edición del congreso u otro evento de la facultad.
- **CategoriaInscripcion**: agrupa tipos (Estudiantes / Público general); `esEstudiantil`
  activa la verificación de estudiante.
- **TipoInscripcion**: plan con precio regular e institucional.
- **Participante**: persona identificada por documento; reutilizable entre eventos.
- **Inscripcion**: participante + evento + tipo + pago + estado + revisión.
- **Actividad / Asistencia**: sesiones del evento y su asistencia.

## Success Criteria

- **SC-001**: Crear una nueva edición con sus tipos de inscripción no requiere cambios de código.
- **SC-002**: 0 inscripciones auto-aprobadas: toda inscripción pública nace `PENDIENTE`.
- **SC-003**: La landing actual (sin cambios) puede seguir inscribiendo tras desplegar el backend.

## Assumptions

- Los datos existentes en producción son del VII CIISIC 2025 (inscripciones del 29-sep al
  22-oct-2025); la migración los asigna a ese evento (FINALIZADO) y crea el VIII CIISIC 2026
  como evento principal con la misma configuración de categorías y tipos.
- La categoría general mantiene el precio institucional por dominio de correo (limitación
  conocida: no verifica propiedad del correo).

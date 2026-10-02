# Feature Specification: Reinscripción tras un rechazo o una cancelación

**Created**: 2026-10-02 · **Status**: Implementado

**Input**: una inscripción rechazada y después cancelada seguía impidiendo que la persona se volviera a
inscribir (`409 ALREADY_REGISTERED`): el índice único evento-participante no mira el estado. Además,
eliminar inscripciones debe quedar solo para el Owner.

## User Scenarios & Testing

### User Story 1 - Me rechazaron (o me cancelaron) y vuelvo a inscribirme (Priority: P1)

1. **Given** mi inscripción del evento está `RECHAZADO` o `CANCELADO`, **When** envío el formulario de la
   landing con mi DNI, **Then** la inscripción vuelve a `PENDIENTE` con el tipo, el pago, el voucher y el
   precio nuevos (mismo `id`), con la fecha de hoy, sin la revisión anterior y con un código de
   credencial nuevo (el QR anterior deja de servir).
2. **Given** mi inscripción está `PENDIENTE`, `EN_REVISION` o `APROBADO`, **Then** sigo recibiendo
   `409 ALREADY_REGISTERED`.
3. **Given** envío el formulario dos veces a la vez, **Then** solo uno reutiliza la fila; el otro recibe
   `409 ALREADY_REGISTERED`.

### User Story 2 - Solo el Owner elimina inscripciones (Priority: P2)

1. **Given** soy Owner y la inscripción está `RECHAZADO` o `CANCELADO`, **Then** el panel me ofrece
   «Eliminar» (borra la fila, el voucher y la credencial).
2. **Given** soy Administrador del sistema, **Then** `DELETE /v1/inscriptions/:id` (y la legacy) me
   responde `403 FORBIDDEN` y el panel no muestra el botón.

## Requirements

- **FR-001**: `crearInscripcion` (sitio y legacy) reutiliza la inscripción `RECHAZADO` o `CANCELADO` con
  un `updateMany` condicionado al estado (`estadoId IN (rechazado, cancelado)`); `count = 0` →
  `409 ALREADY_REGISTERED`.
- **FR-002**: se vuelven a calcular precio, disponibilidad (spec 016), verificación de estudiante y
  correo conservado (spec 014) como en una inscripción nueva; `motivoRechazo`, `revisadoPor`,
  `revisadoEn` y `credencialEnviadaEn` quedan en `null`, `esQrLegado` en `false` y `creadoEn` en la fecha
  de la reinscripción.
- **FR-003**: tras confirmar la transacción se borran el voucher anterior (si es otro archivo) y los PDF
  de credencial de esa inscripción; un fallo al borrar no deshace la reinscripción.
- **FR-004**: el listado del panel se ordena por `creadoEn` (y `id`) descendente, para que una
  reinscripción aparezca arriba.
- **FR-005**: `inscripciones.eliminar` está en `PERMISOS_SOLO_OWNER` junto con `sistema.configurar`.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; sin cambios de esquema.
- **SC-002**: la landing no necesita cambios (misma respuesta `201`).

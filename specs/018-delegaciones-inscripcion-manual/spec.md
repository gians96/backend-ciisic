# Feature Specification: Delegaciones e inscripción manual

**Created**: 2026-10-15 · **Status**: Implementado

**Input**: el staff necesita inscribir en bloque a estudiantes de un salón o ciclo con su pago
presencial real (efectivo, banco o billetera), sin voucher, y después ver y gestionar a esas
personas como un grupo. Hoy solo existían las cortesías (sin pago real) y la inscripción pública
(con voucher). Además, el panel debe poder consultar los miembros de un grupo.

## User Scenarios & Testing

### User Story 1 - El staff registra una inscripción con su pago real (Priority: P1)

1. **Given** soy Owner o Administrador del sistema, **When** envío
   `POST /v1/events/:eventId/manual-inscriptions` con `participanteId` o los datos de la persona,
   el medio de pago (`efectivo`, `banco` o `billetera`) con su número de operación, la fecha y el
   monto, **Then** la inscripción nace `APROBADO`, revisada por mí, con credencial generada y sin
   voucher.
2. **Given** el pago es en `banco`, **Then** `banco` y `tipoOperacion` son obligatorios; en
   `billetera`, la `billeteraDigital`; en `efectivo`, ninguno extra.
3. **Given** el número de operación ya se registró antes, **Then** respondo `409
   OPERATION_ALREADY_REGISTERED`.
4. **Given** la persona ya tiene inscripción en el evento, **Then** respondo `409 ALREADY_REGISTERED`.
5. **Given** envío `enviarCredencial: true`, **Then** se genera el PDF y se envía el correo como al
   aprobar (un fallo de correo no deshace la inscripción).
6. **Given** envío un `delegacionId`, **Then** la inscripción queda vinculada a esa delegación
   (debe ser del evento y estar activa: `422 DELEGATION_INVALID` / `DELEGATION_INACTIVE`).

### User Story 2 - El staff organiza las delegaciones de un evento (Priority: P1)

1. **Given** soy Owner o Administrador del sistema, **When** creo una delegación con nombre,
   tipo (`SALON`, `CICLO` u `OTRO`), abreviatura opcional y delegado opcional, **Then** aparece
   activa en la lista del evento con su total de inscritos.
2. **Given** dos delegaciones del evento tienen el mismo nombre, **Then** respondo `409
   DELEGATION_EXISTS`.
3. **Given** quiero cambiar nombre, tipo, abreviatura, delegado o `activo`, **Then** `PATCH
   /v1/delegations/:id` cambia solo los campos enviados.
4. **Given** desactivo una delegación, **Then** sigue existiendo (las inscripciones la conservan)
   pero ya no admite inscripciones manuales nuevas.

### User Story 3 - El staff ve los miembros de una delegación (Priority: P2)

1. **Given** una delegación con inscritos, **When** pido `GET /v1/delegations/:id/members`,
   **Then** recibo sus inscripciones paginadas con el mismo formato del listado de inscritos del
   evento (montos solo con `pagos.ver`).

## Requirements

- **FR-001**: módulo `delegation` (`/v1/events/:eventId/delegations`, `/v1/delegations/:id`,
  `/v1/delegations/:id/members`) con el permiso global `delegaciones.gestionar` (Owner y
  Administrador; `403 FORBIDDEN` para Tesorero, Comisión y participantes).
- **FR-002**: modelo `Delegacion` por evento: `nombre` único por evento, `tipo`
  (`SALON`/`CICLO`/`OTRO`, por defecto `OTRO`), `abreviatura` opcional, `delegadoId` opcional
  (FK a `participantes`, `SET NULL`), `activo` (por defecto `true`).
- **FR-003**: `Inscripcion.delegacionId` opcional (FK, `SET NULL`, índice); el detalle y el
  listado de inscripciones incluyen `delegacion: { id, nombre, tipo, abreviatura, activo } | null`;
  el listado del panel admite el filtro `?delegacionId=`.
- **FR-004**: `POST /v1/events/:eventId/manual-inscriptions` con el permiso global
  `inscripciones.manual`; cuerpo con exactamente uno de `participanteId` / `participante` (si el
  documento no existe se da de alta), `modalidadPago` (`banco`/`billetera`/`efectivo`) con los
  campos propios, `numeroOperacion` (único en el sistema, sin el prefijo `CORTESIA-`),
  `fechaPago` no futura, `monto` ≥ 0, `descuento` opcional, `tipoInscripcionId` y
  `clasificacionId` opcionales (del evento), `delegacionId` opcional y `enviarCredencial`.
- **FR-005**: la inscripción manual nace `APROBADO` con `revisadoPor` y `revisadoEn` de quien la
  registra, `codigoCredencial` nuevo, `voucherArchivo` en `null` y los montos a dos decimales;
  no calcula precios (el monto lo escribe el staff).
- **FR-006**: los miembros de una delegación son sus inscripciones del evento, paginados como el
  listado de inscritos (mismo `meta` y mismas filas).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; migración nueva
  `20261015120000_delegaciones` sin drift.
- **SC-002**: el contrato (`contracts/api-delegaciones.md`) permite al panel consumir la feature
  sin leer el código del backend.

# Feature Specification: Registro de delegaciones con representante y pago conjunto

**Created**: 2026-10-20 · **Status**: Implementado

**Input**: las delegaciones (grupos de una institución) no tenían forma de inscribirse desde la
landing. El panel solo permitía darlas de alta a mano, sin voucher ni pago; la landing pedía elegir
un plan de una categoría `DELEGACIONES` que no existe en la base de datos, y su formulario enviaba
a un endpoint que no estaba en el backend (`404`).

## User Scenarios & Testing

### User Story 1 - Soy el representante y quiero inscribir a mi grupo (Priority: P1)

1. **Given** entro a `/delegaciones` en la landing, **When** completo la sección del representante
   (nombres, documento, correo, celular) y marco «Soy también integrante del grupo», **Then** mis
   datos aparecen como el integrante #1 (editables) y el resto de la lista se agrega debajo.
2. **Given** no marco la casilla, **Then** mis datos quedan solo como contacto de la delegación y la
   lista de integrantes no me incluye.
3. **Given** completo los datos de la delegación (nombre e institución), **Then** el formulario
   muestra la tarifa por persona del evento y cuánto se paga en total según el número de
   integrantes.
4. **Given** envío el formulario con el voucher del pago total, **Then** el backend registra a todas
   las personas del grupo, guarda **un solo** número de operación y **un solo** voucher para la
   delegación, y me devuelve el link de seguimiento del grupo.
5. **Given** el grupo tiene al menos el mínimo de integrantes, **Then** a todos se les aplica la
   tarifa promocional (la estándar si el grupo es más pequeño).

### User Story 2 - Soy el staff y tengo que revisar el pago del grupo (Priority: P1)

1. **Given** una delegación se registró desde la landing, **When** la abro en el panel, **Then** veo
   el pago conjunto (modalidad, medio, número de operación, fecha y total pagado) y puedo abrir el
   voucher del grupo.
2. **Given** el link de una delegación, **When** lo abro desde la landing, **Then** solo funciona
   dentro del evento del token de acceso: el código de una delegación de otro evento responde `404`.

### User Story 3 - Tengo el link de mi delegación y quiero inscribir a mi grupo (Priority: P1)

1. **Given** entro por el link de una delegación que el staff ya creó, **When** abro el
   formulario, **Then** ve su nombre y su institución, y el aviso de que el registro se sumará a
   ese grupo; la tarifa que se muestra es la de esa delegación, no la del evento.
2. **Given** envío el formulario por ese link, **Then** el registro se suma a esa delegación (no se
   crea otra) y el pago conjunto queda en ella.
3. **Given** reenvío la misma lista por el mismo link, **Then** a quien ya estaba se le omite
   (`omitidos`), sin duplicarlo.

### User Story 4 - El grupo ya se registró y quiero ampliarlo (Priority: P2)

1. **Given** el staff agrega integrantes a una delegación desde el panel, **Then** la tarifa se
   recalcula con el total nuevo y se aplica a todas sus inscripciones (como ya ocurría).

## Requirements

- **FR-001**: `POST /v1/site/delegations` (multipart) registra una delegación completa: la crea con
  la tarifa por defecto del evento (`delegacionesMinIntegrantes`, `delegacionesPrecioEstandar`,
  `delegacionesPrecioPromocional`), agrega a sus integrantes y guarda el pago conjunto. Exige el
  token de acceso del evento (`requireTokenEvento`) y los límites de inscripción (por IP y por
  token). El cliente **no** envía precios ni montos.
- **FR-002**: el cuerpo lleva `delegacion` (nombre e institución), `representante` (datos de la
  persona y la casilla `esIntegrante`), `participantes` (1..200), los datos del pago y el `voucher`.
  El representante, si es integrante, va primero en la lista de participantes: el backend lo coloca
  ahí, sin depender del orden que envíe el cliente.
- **FR-003**: el pago es **de la delegación**, no de cada inscripción: un solo `numeroOperacion`, un
  solo `fechaPago`, un solo medio y un solo `voucherArchivo`, guardados en `delegaciones`. Cada
  inscripción lleva un número de operación interno (`DELEGACION-<uuid>`) porque el de la inscripción
  es único.
- **FR-004**: la tarifa por persona y el total los calcula el servidor con el total final de la
  delegación (`precioUnitario`): la promocional desde `minIntegrantes` y la estándar antes.
- **FR-005**: dos delegaciones del mismo evento no pueden compartir el número de operación del
  voucher (`uq_delegaciones_evento_numero_operacion`) → `409 OPERATION_ALREADY_REGISTERED`.
- **FR-005b`: con `codigoLink` el registro se suma a esa delegación (su tarifa, su mínimo, su
  link); sin `codigoLink` se crea una nueva con la tarifa del evento. Un link de otro evento o
  de una delegación inactiva → `404 DELEGATION_NOT_FOUND`.
- **FR-006**: el link de una delegación solo se consulta dentro del evento del token
  (`GET /v1/site/delegations/link/:codigoLink`): una delegación de otro evento responde `404`. Ya no
  existe la ruta pública `GET /v1/delegations/link/:codigoLink`.
- **FR-007**: la tarifa por defecto de las delegaciones es **del evento** (`eventos.delegaciones_*`),
  no del sistema: cada delegación la copia al crearse, así un cambio de precio no altera lo ya
  cobrado. La landing la lee en `GET /v1/site/delegations/tarifa`.
- **FR-008**: el staff ve el voucher del grupo en `GET /v1/delegations/:id/voucher`
  (`eventos.configurar`, con el evento de la delegación).
- **FR-009**: si el registro falla al escribir las inscripciones, la delegación a medias se borra.
- **FR-010**: las inscripciones del grupo nacen `PENDIENTE` (las revisa el staff) y con el código de
  credencial propio, como cualquier inscripción.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío.
- **SC-002**: la landing registra un grupo de prueba de punta a punta y el panel muestra el pago
  conjunto y su voucher.
- **SC-003**: el número de operación y el voucher de un grupo no aparecen en el listado de
  inscripciones (son de la delegación).

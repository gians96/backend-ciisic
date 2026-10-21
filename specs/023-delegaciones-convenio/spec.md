# Feature Specification: Delegaciones con convenio (modalidad, vouchers múltiples y grupo editable)

**Created**: 2026-10-21 · **Status**: Implementado en el backend (panel y landing en sus repos)

**Input**: hay convenio con delegaciones de otras universidades (UNH, UNAT). Un **delegado** inscribe a
su grupo y paga por todos. Las reglas pactadas: presencial sin kit a **S/ 60** por persona de 1 a 9
integrantes y **S/ 50** desde 10; virtual a **S/ 30** por persona sin escalas. El delegado se
registra desde un **link oculto** que el staff le envía por correo, pone su documento, correo y
celular, agrega a sus integrantes (el total se multiplica en vivo), sube **varios vouchers** y puede
volver para **agregar** integrantes y vouchers. El staff puede hacer lo mismo desde el panel, editar
todo y aprobar al grupo.

Parte de las specs [021](../021-delegaciones/spec.md) y [022](../022-tipos-delegacion/spec.md)
(rama `delegacionesd`, Atuncar) y **las reemplaza en dos puntos**: el pago ya no es un único voucher
y el tipo ya no lo elige el delegado con una tarjeta.

## Decisiones

- **Umbral**: la tarifa promocional aplica con **10 o más** integrantes (`>= minIntegrantes`), como
  dice la descripción del tipo `delegacion_grupal` en producción.
- **Virtual**: S/ 30 para todos los integrantes, sin escalas y sin distinguir estudiantes de docentes.
- **Integrantes**: se registra a cada uno con sus datos (cada uno tiene su inscripción, credencial QR
  y certificado).
- **Link del delegado**: con su link solo **agrega** (integrantes y vouchers); nunca borra ni cambia
  lo ya enviado. El staff edita todo.

## User Scenarios & Testing

### User Story 1 - Soy el delegado y registro a mi grupo (Priority: P1)

1. **Given** abro el link de la landing, **When** completo mi documento, correo y celular, la
   delegación, la modalidad (presencial o virtual) y la lista de integrantes, **Then** el formulario
   muestra el precio por persona y el total, y cuántos faltan para la tarifa de S/ 50.
2. **Given** envío uno o varios vouchers (archivo, medio, número de operación, fecha y monto de cada
   uno), **Then** el backend registra al grupo y los vouchers en una sola transacción; si algo falla
   no queda nada a medias.
3. **Given** el grupo llega a 10 integrantes, **Then** **todos** pasan a S/ 50 y al tipo
   «Delegación Promocional» (si baja de 10, vuelven a S/ 60).

### User Story 2 - Vuelvo con mi link para ampliar el grupo (Priority: P1)

1. **Given** mi grupo ya está registrado, **When** abro mi link, **Then** veo a mis integrantes
   (documento enmascarado), mis vouchers (número enmascarado) y mi saldo.
2. **Given** quiero sumar a una persona o un voucher, **Then** lo agrego sin tocar lo anterior; la
   tarifa se recalcula con el total nuevo.

### User Story 3 - Soy del staff y registro o corrijo una delegación (Priority: P1)

1. **Given** estoy en el panel, **When** creo la delegación con el DNI, correo y celular del delegado
   (y, si ya los tengo, los integrantes), **Then** obtengo el link para enviárselo.
2. **Given** la delegación existe, **Then** puedo editar sus datos, agregar o quitar integrantes
   (mientras no estén aprobados), subir más vouchers y verificarlos o rechazarlos.
3. **Given** los vouchers están conformes, **When** aprobo al grupo, **Then** todos los integrantes
   pendientes pasan a APROBADO y sus credenciales se envían una por una.

## Requirements

- **FR-001**: cada delegación tiene `modalidad` (`PRESENCIAL` | `VIRTUAL`) y los datos del delegado
  (nombres, documento, correo, celular). La modalidad solo cambia mientras el grupo no tenga
  integrantes (`409 DELEGATION_MODALITY_LOCKED`).
- **FR-002**: **el servidor decide el tipo y el precio**; el cliente no envía precios ni tipo.
  Presencial: `delegacion_general` por debajo de `minIntegrantes` y `delegacion_grupal` desde ahí.
  Virtual: `delegacion_virtual`. El tipo y el monto se recalculan para **todas** las inscripciones
  activas del grupo en cada alta o baja (transacción con la delegación bloqueada).
- **FR-003**: `delegacion_virtual` es un tipo nuevo de la categoría `DELEGACIONES`
  (`modalidad = VIRTUAL`, S/ 30). Mientras el evento no lo tenga, la modalidad virtual no se ofrece
  (`virtual: null` en la tarifa) y registrar una virtual responde `422 DELEGATION_MODALITY_NOT_AVAILABLE`.
  La tarifa de una delegación virtual se copia al crearse con estándar = promocional = el precio del tipo.
- **FR-004**: son integrantes los que no están `RECHAZADO` ni `CANCELADO`: el recuento de la tarifa los
  ignora; una inscripción rechazada o cancelada se reutiliza si la persona vuelve (spec 017).
- **FR-005**: el pago es una lista de **vouchers** (`delegacion_pagos`): archivo, medio (banco o
  billetera), número de operación, fecha y el monto que dice el voucher. Se envían hasta 6 por
  petición (`vouchers` en el multipart, emparejados por posición con `pagos`). El número de
  operación no se repite en el evento ni coincide con el de una inscripción individual
  (`409 OPERATION_ALREADY_REGISTERED`). El registro público exige al menos un voucher.
- **FR-006**: el staff marca cada voucher `VERIFICADO` o `RECHAZADO` (con motivo) o lo devuelve a
  `PENDIENTE`; uno verificado no se elimina. Un voucher rechazado no cuenta como declarado.
- **FR-007**: el resumen de pagos de una delegación es `totalAPagar` (precio unitario × integrantes),
  `declarado` (sin los rechazados), `verificado` y `saldo`. Solo informa: no bloquea nada.
- **FR-008**: con el link (`/v1/site/delegations/link/:codigoLink/…`) el delegado solo **agrega**
  integrantes y vouchers, dentro del evento del token y con las inscripciones abiertas. La vista del
  link enmascara documentos y números de operación y no expone el correo ni el teléfono del delegado.
- **FR-009**: el staff quita un integrante solo si no está aprobado (`409 INSCRIPTION_NOT_REMOVABLE`);
  uno aprobado se cancela desde Inscripciones.
- **FR-010**: `POST /v1/delegations/:id/approve` aprueba a los integrantes `PENDIENTE` o `EN_REVISION`
  en el acto y genera y envía las credenciales en diferido, una por una (`aprobarVarias`). Lo hace
  quien tiene `eventos.configurar` o `inscripciones.validar` en ese evento.
- **FR-011**: el registro público es atómico: el grupo, los integrantes y los vouchers se escriben en una
  transacción; si falla, la delegación nueva se borra y los archivos subidos se eliminan.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío.
- **SC-002**: con 9 integrantes cada uno cuesta S/ 60; con el décimo, S/ 50 para todos; una virtual
  cuesta S/ 30 a cualquier tamaño.
- **SC-003**: un delegado registra a su grupo con dos vouchers, vuelve con su link, agrega a una
  persona y otro voucher, y el staff aprueba al grupo.

## Out of Scope

- Precios distintos por rol (estudiante / docente) dentro de una delegación.
- Bloquear la aprobación mientras haya saldo (el panel solo lo avisa).
- Cobro automático o conciliación con el banco.

## Despliegue

Orden: respaldo `mysqldump` → backend (`migrate deploy` crea `delegaciones`, `delegacion_pagos` y las
columnas de `eventos`) → panel y landing → crear el tipo `delegacion_virtual`
(`prisma/preflight/configurar-delegacion-virtual.sql` o desde el panel) → `verificar-delegacion-virtual.sql`.
Las migraciones son aditivas: la imagen anterior sigue funcionando.

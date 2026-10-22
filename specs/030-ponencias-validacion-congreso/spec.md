# Feature Specification: Ponencias especializadas solo para congresistas con pago aprobado

**Created**: 2026-10-22 · **Status**: Implementado en el backend (pendiente de desplegar y de validar lo existente en producción)

**Input**: las ponencias especializadas (spec 019) nacieron libres: cualquiera se inscribía con un documento. El
usuario pidió que **solo puedan inscribirse quienes estén inscritos al congreso y con el pago validado**,
comprobándolo con el **DNI y el correo obligatorios**, y que al validar se habilite el modo con el que entraron
(**virtual sin límite; presencial según el aforo ya establecido**). Además, un interruptor en la configuración de las
ponencias para volver a dejar entrar a cualquiera solo con su DNI («acceso libre / gratuito»).

> **Numeración**: es la spec **030**; la 028 es «docentes con DNI» y la 029 «delegaciones con planes propios» (otras líneas de trabajo, en
> sus propias ramas). Panel = spec 020, landing = spec 009. La migración (`20261024130000`) va después de la de las delegaciones
> (`20261024120000`) para que se apliquen en ese orden.

## Decisiones

- **Congresista válido** = `Participante` con el mismo tipo y número de documento y una `Inscripcion` del **mismo evento**
  en estado `APROBADO` («pagó = aprobado», igual que los reportes de la spec 025). En la landing el correo también
  debe coincidir con el registrado (sin distinguir mayúsculas).
- **Modo** = `modalidadDe(inscripcion.tipoInscripcion?.modalidad)`: sale del tipo de inscripción (categoría
  estudiantes, público general, delegaciones…); una cortesía sin tipo es presencial. Solo las inscripciones
  **presenciales** vigentes ocupan el aforo (`cupo`); las virtuales nunca lo consumen ni se bloquean por él.
- **Interruptor** `eventos.ponencias_acceso_libre` (por evento; **apagado por defecto**): encendido, la landing, el alta
  manual y la puerta funcionan solo con el documento y no miran el congreso (como antes de esta spec); apagado, rige la
  validación. Lo cambia quien tiene `especializadas.gestionar` (Owner y Administrador).
- **Lo existente** (inscripciones hechas antes): quedan **«Sin validar»** (`inscripcion_congreso_id` NULL) y siguen
  ocupando su asiento presencial. Se validan solas si coinciden por documento con un congresista aprobado
  (`npm run ponencias-especializadas:validar-existentes`), al volver a la landing con DNI y correo, con el alta manual
  del staff o en la puerta. No se cancela a nadie automáticamente.
- **Puerta y alta manual** aplican la regla **solo con el documento** (el staff ve a la persona); el correo se exige solo en la landing.
- **No se revela quién está inscrito**: con el correo en la petición, un documento desconocido, otro evento o un correo
  distinto dan el mismo `422 CONGRESS_REGISTRATION_NOT_FOUND`; el motivo específico (pago pendiente o rechazado) solo se
  dice a quien acertó documento y correo, y al staff autenticado.
- Si el pago de un congresista se rechaza o cancela **después** de inscribirse a una ponencia, la inscripción no se cancela
  sola: el panel la marca para que el staff decida.

## User Scenarios & Testing

### User Story 1 - Verificar y inscribirme desde la landing (P1)

1. **Given** estoy inscrito al congreso con el pago aprobado, **When** envío mi documento y el correo con el que me
   inscribí, **Then** `POST /site/specialized-talk-eligibility` me dice mi modo (presencial o virtual) y al inscribirme
   quedo con ese modo; mis nombres, correo y celular salen de mi inscripción (no se consulta el DNI).
2. **Given** mi pago está pendiente, en revisión, rechazado o no estoy inscrito, **Then** `422` con el motivo
   (`CONGRESS_PAYMENT_PENDING`, `CONGRESS_REGISTRATION_REJECTED`) o el mensaje genérico `CONGRESS_REGISTRATION_NOT_FOUND`.
3. **Given** una ponencia con el aforo presencial completo, **Then** un presencial recibe `409 TALK_FULL` y un virtual se inscribe.
4. **Given** ya estaba inscrito antes de la validación, **When** repito con mi documento y correo, **Then** es idempotente
   (`yaInscrito`) y mi inscripción queda validada.

### User Story 2 - Acceso libre (P1)

1. **Given** el interruptor está encendido, **When** alguien se inscribe solo con su documento, **Then** entra (modo presencial,
   aforo normal, sin validar). **Given** está apagado, **Then** se exige el congreso otra vez.

### User Story 3 - Staff y puerta (P1)

1. **Given** el interruptor apagado, **When** el staff inscribe o marca la asistencia con un documento, **Then** debe ser
   congresista aprobado (si no, el motivo exacto); la inscripción queda validada con su modo. Un virtual se marca en la puerta
   sin consumir aforo y la respuesta lo indica.
2. **Given** el panel, **Then** ve el modo y el estado de validación de cada inscripción, filtra por ambos y los contadores
   separan presenciales y virtuales.

## Requirements

- **FR-001**: migración aditiva `20261024130000_ponencias_validacion_congreso`: `eventos.ponencias_acceso_libre`,
  `inscripciones_ponencia.inscripcion_congreso_id` (FK `SET NULL`) y `modo_asistencia` (`PRESENCIAL` por defecto).
- **FR-002**: `resolverAcceso(eventoId, persona, { exigirCorreo })` es el único punto de decisión (landing, alta manual, puerta,
  reactivación). `exigirCupo(tx, ponencia, modo)` cuenta solo `modoAsistencia = PRESENCIAL`.
- **FR-003**: rutas nuevas `POST /v1/site/specialized-talk-eligibility` y `GET|PUT /v1/events/:eventId/specialized-talks/access`;
  `GET /v1/site/specialized-talks` agrega `meta.accesoLibre`; el listado del panel agrega `validacion` y `modo`.
- **FR-004**: `npm run ponencias-especializadas:validar-existentes -- --evento <código> [--aplicar] [--csv]` (simula por defecto).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío.
- **SC-002**: la matriz de rutas clasifica las 3 rutas nuevas (175 rutas en esta rama).
- **SC-003**: un virtual se inscribe en una ponencia con el aforo presencial completo y no cambia `cuposDisponibles`.

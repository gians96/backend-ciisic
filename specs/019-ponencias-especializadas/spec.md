# Feature Specification: Ponencias especializadas

**Created**: 2026-10-20 · **Status**: Implementado (pendiente de desplegar)

**Input**: el VIII CIISIC (27 y 28 de octubre de 2026) tiene 19 ponencias especializadas simultáneas
(12:00–12:45, laboratorios de aforo 20 y aulas de aforo 40) que solo existían como datos estáticos de la
landing. Hacen falta: gestionar las ponencias (ambiente, horario, duración, precio, modalidad, ponente y
tema), ver las inscripciones con filtros y poder inscribir a mano, una página de inscripción en la
landing y la asistencia en puerta solo con el DNI (incluida la inscripción en el acto).

> **Nombre**: en este sistema «ponencias» ya son los *papers* del Call for Papers (`Ponencia`,
> `/v1/papers`, permiso `ponencias.ver`). Lo nuevo se llama **ponencias especializadas**
> (`specialized-talks`, `PonenciaEspecializada`) y no toca nada de lo anterior.

## Decisiones

- **Gratuitas por ahora.** El campo `precio` existe (0 = gratuita) pero no hay flujo de cobro: la landing
  no deja inscribirse a una de pago (`422 PAID_TALK_UNAVAILABLE`). Plan de cobro:
  [`plan-futuro-cobro.md`](plan-futuro-cobro.md).
- **Persona propia, no `Participante`.** El participante exige correo y celular; aquí son opcionales y
  la inscripción al congreso no es requisito. `AsistentePonencia` se identifica por documento.
- **Una ponencia es una sola sesión**: la asistencia vive en la misma fila de la inscripción.
- **Ponente embebido** en la ponencia (nombre, bio, foto, externo); quien dicta dos repite su bio.

## User Scenarios & Testing

### User Story 1 - Gestionar las ponencias (Priority: P1)

1. **Given** soy Owner o Administrador, **When** creo una ponencia con tema, fecha, hora de inicio y fin,
   ambiente, modalidad, precio, cupo y datos del ponente, **Then** queda con su duración calculada y, si
   `publicada`, aparece en la landing.
2. **Given** otra ponencia **presencial** usa el mismo ambiente a esa hora, **Then** `409 ROOM_CONFLICT`
   (los horarios que solo se tocan en el borde no chocan; las virtuales no comparten ambiente).
3. **Given** una ponencia con inscritos vigentes, **Then** no se elimina (`409 TALK_HAS_REGISTRATIONS`)
   ni se baja el cupo por debajo de ellos (`409 CAPACITY_BELOW_REGISTERED`); se despublica.

### User Story 2 - Inscribirme desde la landing (Priority: P1)

1. **Given** ponencias publicadas y gratuitas, **When** envío mi documento y de 1 a 4 ponencias, **Then**
   quedo inscrito en todas o en ninguna, con origen `LANDING`.
2. **Given** dos ponencias que se cruzan en horario (entre las elegidas o con una a la que ya estoy
   inscrito), **Then** `409 SCHEDULE_CONFLICT` nombrando ambas.
3. **Given** una ponencia sin cupos, **Then** `409 TALK_FULL`; si ya estaba inscrito, repetir es idempotente
   (`yaInscrito`) y no ocupa otro cupo.
4. **Given** una persona ya registrada, **Then** el formulario público **no** modifica sus datos.

### User Story 3 - Ver y corregir inscripciones; inscribir a mano (Priority: P1)

1. **Given** `especializadas.ver`, **When** listo las inscripciones del evento, **Then** filtro por
   ponencia, día, modalidad, estado, asistencia, origen, procedencia (interno/externo/sin dato) y busco por
   documento, nombre, correo o celular.
2. **Given** `especializadas.inscribir` (Owner, Administrador o Comisión con el permiso), **When** inscribo a
   mano con documento (y nombres/correo/celular/procedencia opcionales), **Then** se registra con origen
   `STAFF`; con DNI los nombres salen de la consulta oficial. El staff **sí** puede inscribir en ponencias que
   se cruzan, pero respeta el cupo.
3. **Given** una inscripción, **Then** el staff la cancela, la reactiva (con cupo) y corrige los datos de la
   persona. No se cancela a quien ya asistió: primero se anula la asistencia.

### User Story 4 - Asistencia en puerta con el DNI (Priority: P1)

1. **Given** `especializadas.asistencia`, **When** escribo el DNI de alguien inscrito, **Then** se marca su
   asistencia.
2. **Given** el DNI de alguien **no inscrito** en esa ponencia (o que no existe en el sistema), **When** hay
   aforo, **Then** se busca el DNI con la API, se registra a la persona, se inscribe en el acto (origen
   `PUERTA`) y se marca; sin aforo, `409 TALK_FULL`.
3. **Given** que estaba inscrita en otra ponencia **del mismo horario** a la que no asistió, **When** se
   marca esta, **Then** esa inscripción se cancela (`CAMBIO_EN_PUERTA`) para liberar el cupo y la respuesta
   la lista en `liberadas`.
4. **Given** fuera del día o de la ventana [inicio − 30 min, fin], **Then** se registra igual con
   `esFueraDeHorario`. Una segunda lectura: `409 ATTENDANCE_ALREADY_REGISTERED` con la hora.

## Requirements

- **FR-001**: tablas `ponencias_especializadas`, `asistentes_ponencia` e `inscripciones_ponencia` (única
  `(ponencia, asistente)`), migración `20261020120000_ponencias_especializadas`.
- **FR-002**: permisos `especializadas.gestionar` (global), `.ver`, `.inscribir` y `.asistencia` (por
  evento; los dos últimos implican `.ver`). Elegibles para la Comisión: los tres por evento. Los resolutores
  de evento son `eventoDePonenciaEspecializada` y `eventoDeInscripcionPonencia`.
- **FR-003**: el cupo cuenta inscripciones `INSCRITO` y se comprueba en una transacción con `SELECT … FOR
  UPDATE` de la fila de la ponencia; `cupo` NULL = sin límite.
- **FR-004**: la regla de cruces (`inicio < otraFin && otraInicio < fin`) la aplica solo la landing.
- **FR-005**: la landing exige token del evento, ponencia publicada del evento, gratuita y no terminada;
  los límites son `limiteInscripcion` y `limiteTokenInscripcion`. Los nombres salen de la caché de
  consultas DNI (`nombresOficiales`) o de los enviados (`422 NAMES_REQUIRED` si no hay).
- **FR-006**: staff y puerta consultan el DNI con `consultarDni(…, 'PANEL')`; si falla usan los enviados.
- **FR-007**: la asistencia en puerta lleva el limitador por cuenta `limiteCheckInPonencia` (exento para
  cuentas globales) y la auditoría registra solo ids.
- **FR-008**: seed idempotente `npm run seed:ponencias-especializadas -- --evento <código>` con las 19
  ponencias de 2026 (`prisma/datos/ponencias-especializadas-2026.json`, cupo 20 en laboratorios y 40 en aulas).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío.
- **SC-002**: la matriz de rutas clasifica las 11 rutas nuevas (140 en total).
- **SC-003**: en una carrera por el último cupo, solo una inscripción lo obtiene.

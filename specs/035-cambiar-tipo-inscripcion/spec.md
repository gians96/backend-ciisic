# Feature Specification: Cambiar el tipo de una inscripción (solo Owner)

**Created**: 2026-10-23 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: algunos inscritos se equivocaron al elegir su tipo de inscripción (p. ej. un docente de la facultad que se inscribió como
«PROFESIONALES Y PUBLICO EN GENERAL · CON KIT» y debía estar en «Docente, egresados y administrativos de la Facultad Ingeniería UNDC · CON KIT»).
El usuario pidió que **el Owner pueda corregirlo** desde Inscripciones para ordenar y actualizar los datos.

> **Numeración**: es la spec **035** del backend. Panel = spec 026.

## Decisiones

- **Solo el Owner**: permiso nuevo `inscripciones.cambiar_tipo`, global y en `PERMISOS_SOLO_OWNER` (como `inscripciones.eliminar`). El Administrador del
  sistema, el Tesorero y la Comisión reciben `403 FORBIDDEN`. Si algún día debe poder también el Administrador, basta quitarlo de esa lista.
- **Se cambia el tipo; la categoría va con él** (cada tipo pertenece a una categoría). Cualquier tipo del **mismo evento**, también uno inactivo (es una
  corrección deliberada). Se puede en cualquier estado de la inscripción, también cortesías (con o sin tipo).
- **Es una corrección de clasificación, no de pago**: el **monto pagado no cambia** (es lo que dice el voucher). El `descuento` se recalcula contra el
  precio de lista del tipo nuevo (`precio − monto`, nunca negativo; una cortesía siempre 0). Si lo pagado no coincide con el precio del tipo nuevo, el
  panel lo avisa, pero no lo corrige.
- **No se aplican las reglas de alta** (`disponiblePara`, `excluyeEstudiantesUndc`): frenan inscripciones nuevas y esto es una corrección hecha por el Owner.
- **Delegaciones**: no se mueve a un integrante de una delegación (`409 INSCRIPTION_IN_DELEGATION`) ni hacia un plan de delegación; su plan lo decide y
  recalcula Delegaciones (spec 029).
- **Historial**: cada corrección queda en `cambios_tipo_inscripcion` con el texto de los dos tipos (no sus ids, para que se lea aunque después se renombre o se borre un
  tipo), el motivo opcional y quién la hizo. El detalle de la inscripción lo trae en `cambiosTipo`, de la más reciente a la más antigua. En el log solo van ids.
- **Credencial**: lleva el tipo. Al cambiarlo se descartan los PDF guardados y el siguiente («Ver credencial» o «Reenviar») sale con el tipo nuevo. **No se envía
  ningún correo solo**: quien ya recibió la credencial con el tipo anterior no la recibe de nuevo hasta que el Owner la reenvíe.
- **Ponencias especializadas** (spec 030): su modo (presencial ocupa aforo, virtual no) sale de la modalidad del tipo. Si el cambio **cambia la modalidad de
  asistencia**, las inscripciones de esa persona a ponencias que sigan **vigentes, sin asistencia y sin terminar** toman el modo nuevo; las que ya asistieron
  conservan el modo con el que asistieron. Pasar a presencial exige cupo en cada una (`409 TALK_FULL_ON_TYPE_CHANGE`, con el nombre de la ponencia: no se cambia nada);
  pasar a virtual libera el suyo.

## User Scenarios & Testing

1. **Given** soy Owner y una inscripción con el tipo equivocado, **When** elijo el tipo correcto, **Then** la inscripción pasa a ese tipo y a su categoría, conserva
   su monto, recalcula el descuento y queda anotado quién lo cambió, cuándo y qué tenía antes.
2. **Given** soy Administrador, Tesorero o Comisión, **Then** `PATCH /v1/inscriptions/:id/type` responde `403` y no se lee ni se cambia nada.
3. **Given** un integrante de una delegación, **Then** `409 INSCRIPTION_IN_DELEGATION`: se cambia desde Delegaciones.
4. **Given** una persona virtual con ponencias pendientes que pasa a un tipo presencial sin cupo en alguna de ellas, **Then** `409 TALK_FULL_ON_TYPE_CHANGE` y la inscripción no cambia.
5. **Given** dos Owners que cambian la misma inscripción a la vez, **Then** el segundo recibe `409 INSCRIPTION_CHANGED` y no se pisa nada.

## Requirements

- **FR-001**: migración aditiva `20261026150000_cambios_tipo_inscripcion` (tabla `cambios_tipo_inscripcion`; CASCADE con la inscripción, SET NULL con la cuenta).
- **FR-002**: `PATCH /v1/inscriptions/:id/type` con `{ tipoInscripcionId, motivo? }`; guarda `inscripciones.cambiar_tipo` (global) antes de validar el cuerpo.
- **FR-003**: el cambio, su historial y el ajuste de las ponencias van en **una transacción**; la actualización está condicionada al tipo leído y a que no haya delegación.
- **FR-004**: `GET /v1/inscriptions/:id` agrega `cambiosTipo`; los listados y el CSV no lo traen.
- **FR-005**: `descuentoSobreLista` (puro) lo comparten `calcularPrecio` y el cambio de tipo.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío; la matriz de rutas clasifica la ruta nueva (187).
- **SC-002**: ninguna cuenta distinta del Owner puede cambiar un tipo, y nunca cambia el monto pagado.

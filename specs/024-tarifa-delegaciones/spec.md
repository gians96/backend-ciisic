# Feature Specification: Tarifa de delegaciones administrable

**Created**: 2026-10-21 · **Status**: Implementado en el backend (panel en su repo) · **Contrato**: [`contracts/api-tarifa-delegaciones.md`](contracts/api-tarifa-delegaciones.md)

**Input**: en la pestaña Delegaciones del panel el precio presencial (S/ 60 y S/ 50 desde 10 integrantes) y el
virtual (S/ 30) eran solo texto. Los precios vivían en los tres tipos de la categoría `DELEGACIONES` (se podían
editar en «Categorías y tipos», sin que la pestaña lo dijera), el mínimo de integrantes solo en
`eventos.delegaciones_min_integrantes` (sin ninguna vía para cambiarlo) y cada delegación copia la tarifa al
crearse. El staff necesita administrar la tarifa desde un solo lugar.

Amplía la [spec 023](../023-delegaciones-convenio/spec.md) sin cambiar su contrato: los tres códigos de tipo
siguen siendo `delegacion_general`, `delegacion_grupal` y `delegacion_virtual`, y el servidor sigue decidiendo el
tipo y el precio de cada inscripción. **No hay migración**: usa las columnas que ya existen.

## Decisiones

- **Fuente de la tarifa**: los precios de los tipos (como hoy); `eventos.delegaciones_*` se escribe igual para que
  el respaldo nunca contradiga a los tipos. Cambiar la tarifa no altera lo ya cobrado: cada delegación conserva su copia.
- **Existentes**: con `aplicarAExistentes` la tarifa se copia **solo** a las delegaciones sin integrantes activos ni
  vouchers; las demás (con dinero o personas ya involucrados) se editan una por una con `PUT /v1/delegations/:id`.
- **Virtual**: se puede ofrecer u ocultar (`activo` del tipo). Si el evento no tiene el tipo, guardar un precio virtual
  o encenderlo lo crea con los textos de `prisma/preflight/configurar-delegacion-virtual.sql`; si no existe la categoría
  `DELEGACIONES`, no se inventa (`422 DELEGATION_CATEGORY_NOT_FOUND`).
- **Presencial**: el tipo `delegacion_general` o `delegacion_grupal` que falte no se crea: sin él la tarifa sale de los
  precios del evento (como ya hacía la spec 023).

## User Scenarios & Testing

### User Story 1 - Cambio la tarifa de las delegaciones (Priority: P1)

1. **Given** estoy en Eventos → Delegaciones, **When** cambio el estándar, el promocional, el mínimo o el virtual,
   **Then** la landing (`GET /site/delegations/tarifa`) y las delegaciones **nuevas** usan los valores nuevos.
2. **Given** el promocional queda por encima del estándar, **Then** el guardado se rechaza y no cambia nada.

### User Story 2 - Ofrezco u oculto la modalidad virtual (Priority: P1)

1. **Given** el evento no tiene el tipo virtual, **When** activo la modalidad con un precio, **Then** se crea el tipo.
2. **Given** lo apago, **Then** `tarifa.virtual` pasa a `null` para la landing y registrar una virtual responde
   `422 DELEGATION_MODALITY_NOT_AVAILABLE`; el precio queda guardado.

### User Story 3 - Aplico la nueva tarifa a delegaciones que aún no empiezan (Priority: P2)

1. **Given** hay delegaciones sin integrantes ni vouchers, **When** marco «aplicar a existentes», **Then** esas
   reciben el mínimo y los precios nuevos (cada una según su modalidad) y se informa cuántas fueron.
2. **Given** una delegación ya tiene integrantes o vouchers, **Then** no se toca.

## Requirements

- **FR-001**: `GET /v1/events/:eventId/delegations/tarifa` devuelve el mínimo, los precios presenciales vigentes, la
  virtual (`null` si no hay tipo; `activo`) y cuántas delegaciones hay y cuántas están sin integrantes ni vouchers.
- **FR-002**: `PUT` mezcla lo recibido con lo vigente y exige promocional ≤ estándar (`422` si ambos llegan mal;
  `409 INVALID_PRICES` si el valor mezclado queda mal). Todo ocurre en una transacción con el evento bloqueado.
- **FR-003**: los tipos presenciales se actualizan solo si llega su precio; `precio` e `precioInstitucional` quedan
  iguales (sin descuento por correo en las delegaciones).
- **FR-004**: `aplicarAExistentes` bloquea las delegaciones del evento (`FOR UPDATE`) antes de elegir las vacías.
- **FR-005**: gestionar es `eventos.configurar` (global: Owner y Administrador; Tesorero y Comisión → `403`).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde (no hay esquema nuevo: `prisma migrate diff` sin cambios).
- **SC-002**: tras cambiar el mínimo a 8 y el estándar a 70, una delegación nueva paga S/ 70 hasta 7 integrantes y el
  promocional desde el 8.º; la tarifa pública (`/site/delegations/tarifa`) muestra los mismos números.

## Out of Scope

- Reprecio de delegaciones con integrantes o vouchers (se edita cada una con `PUT /v1/delegations/:id`).
- Precios distintos por rol dentro de una delegación.
- Crear la categoría `DELEGACIONES` ni los tipos presenciales que falten.

## Despliegue

Solo código: backend primero y el panel después (el panel avisa y oculta «Editar tarifa» si el backend aún no tiene
estas rutas). Sin migración ni script de producción.

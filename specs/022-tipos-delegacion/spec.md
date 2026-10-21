# Feature Specification: Tipos de inscripción de delegación (General y Promocional)

**Created**: 2026-10-20 · **Status**: Implementado

**Input**: la landing quiere ofrecer, después de los datos del representante, dos tarjetas de tipo
de delegación con sus características (como las de cualquier plan): **Delegación General** y
**Delegación Promocional**. El panel ya permite crear esos tipos en la categoría `DELEGACIONES`
(`delegacion_general`, `delegacion_grupal`), pero el registro de delegaciones no guardaba el tipo
elegido (`tipoInscripcionId` quedaba en `null`) y los precios salían solo de `eventos.delegaciones_*`:
en el panel no se veía qué tipo correspondía a cada inscripción ni el grupo en «Inscripciones».

## User Scenarios & Testing

### User Story 1 - Soy el representante y elijo el tipo de mi delegación (Priority: P1)

1. **Given** completo la sección del representante y los datos de la delegación en `/delegaciones`,
   **Then** el formulario muestra las dos tarjetas (Delegación General y Delegación Promocional) con
   su precio, su descripción y sus características, leídas de los tipos activos de la categoría
   `DELEGACIONES`.
2. **Given** no elijo ninguna tarjeta, **When** intento registrar, **Then** el formulario no envía y
   pide elegir el tipo de delegación.
3. **Given** el evento no tiene los tipos `delegacion_general` y `delegacion_grupal` activos,
   **Then** el formulario muestra un error de configuración (sin tarjetas de respaldo) y no permite
   registrar.
4. **Given** elijo un tipo y envío, **Then** la delegación y **cada** inscripción del grupo quedan con
   ese tipo, y el monto por persona sigue la regla existente: el precio de `delegacion_general` si el
   grupo es menor al mínimo y el de `delegacion_grupal` desde el mínimo de integrantes.
5. **Given** entro por el link de una delegación existente, **Then** también elijo el tipo; la
   selección se guarda en esa delegación.

### User Story 2 - Soy del staff y necesito ver el grupo en «Inscripciones» (Priority: P1)

1. **Given** una delegación se registró con un tipo, **When** abro el listado de inscripciones,
   **Then** cada fila muestra el tipo (Delegación General/Promocional) y un indicador del grupo.
2. **Given** abro el detalle de una inscripción de una delegación, **Then** veo un bloque con la
   delegación (nombre, link, integrantes), su pago conjunto (modalidad, operación, fecha y total) y
   el enlace a la pestaña Delegaciones del evento.
3. **Given** el pago del grupo, **When** tengo permiso para ver pagos/configurar, **Then** puedo
   abrir el voucher del grupo desde el detalle.

## Requirements

- **FR-001**: `GET /v1/site/registration-types?categoria=DELEGACIONES` entrega los tipos activos de
  la categoría `DELEGACIONES` (la landing arma las tarjetas con `id`, `nombre`, `etiqueta`,
  `descripcion`, `caracteristicas` y `precio`).
- **FR-002**: los códigos `delegacion_general` (precio estándar) y `delegacion_grupal` (precio
  promocional) son contrato: con ellos el backend resuelve la tarifa por persona de las delegaciones
  del evento. Si faltan, se usan `eventos.delegacionesPrecioEstandar/Promocional` (delegaciones del
  staff o eventos sin configurar).
- **FR-003**: `GET /v1/site/delegations/tarifa` devuelve la tarifa ya resuelta desde los tipos (mismos
  precios que muestran las tarjetas) más `minIntegrantes`.
- **FR-004**: `POST /v1/site/delegations` acepta `tipoInscripcionId` (entero). Debe ser un tipo
  activo del evento y de la categoría `DELEGACIONES`; si no → `422 REGISTRATION_TYPE_NOT_AVAILABLE`.
- **FR-005**: el tipo se guarda en `delegaciones.tipo_inscripcion_id` y en **cada** inscripción del
  grupo (las nuevas, las reutilizadas y las que se agreguen después desde el panel). Con
  `codigoLink`, la selección actualiza el tipo de la delegación existente.
- **FR-006**: la regla de precio no cambia (`precioUnitario`): se cobra el precio estándar por debajo
  del mínimo y el promocional desde el mínimo, con los precios resueltos en FR-002. La delegación
  **copia** la tarifa al crearse (snapshot), como en la spec 021: editar un tipo después no
  repricea a los grupos ya registrados.
- **FR-007**: `GET /v1/events/:id/inscriptions` (listado) y `GET /v1/inscriptions/:id` (detalle)
  incluyen la delegación a la que pertenece la inscripción: `delegacion: { id, nombre, codigoLink,
  totalIntegrantes }` y, en el detalle y con permiso de pagos, el pago conjunto del grupo.
- **FR-008**: `GET /v1/delegations/:id/voucher` acepta además el permiso `pagos.ver` (además de
  `eventos.configurar`), para que quien revisa pagos pueda ver el voucher del grupo desde el detalle.
- **FR-009**: el cliente **nunca** envía precios ni montos (igual que en la spec 021).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío.
- **SC-002**: un registro desde la landing con cada tarjeta deja la delegación y sus inscripciones
  con el tipo elegido, y el panel muestra ese tipo, el grupo y su pago.
- **SC-003**: cambiar el precio de `delegacion_general` en el panel cambia lo que cobra
  `POST /site/delegations` a partir de ese momento, y no altera a los grupos ya registrados.

## Out of Scope

- Cambiar la regla 60/50 por cantidad de integrantes (spec 021).
- Filtro por delegación en el listado de inscripciones.
- Precios institucionales (precio UNDC) por integrante de una delegación.

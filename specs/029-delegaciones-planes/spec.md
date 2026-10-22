# Feature Specification: Delegaciones con planes y tarifa propios

**Created**: 2026-10-22 · **Status**: Implementado en el backend (panel y landing en sus repos) · **Contrato**: [`contracts/api-delegaciones-planes.md`](contracts/api-delegaciones-planes.md)

**Input**: la tarifa de las delegaciones era **global del evento** (categoría `DELEGACIONES` con `delegacion_general` S/ 60,
`delegacion_grupal` S/ 50 y `delegacion_virtual` S/ 30, spec 023/024): cada delegación copiaba esos precios y el servidor elegía el
tipo según el tamaño del grupo. Falta lo que cada convenio necesita: **precio propio por delegación**, que cada integrante elija
**Con kit, Sin kit o Virtual**, apagar o encender cada plan, administrar el **link** (que cada integrante se inscriba solo o solo
el delegado), **filtrar por correo institucional** (`@unac.edu.pe`) y que el **Tesorero valide pagos** mientras Owner, Administrador
y Comisión inscriben.

**Reemplaza** las [specs 021](../021-delegaciones/spec.md), [022](../022-tipos-delegacion/spec.md), [023](../023-delegaciones-convenio/spec.md)
y [024](../024-tarifa-delegaciones/spec.md) en lo que tocan a la tarifa, los tipos, el registro público y las rutas de tarifa. Lo que
no cambia: vouchers múltiples (`delegacion_pagos`), aprobación del grupo, integrantes con su propia inscripción, el número de
operación interno y la regla de que **el servidor calcula el precio**.

## Decisiones

- **Planes por integrante**: una delegación ofrece hasta tres planes (`CON_KIT`, `SIN_KIT`, `VIRTUAL`), cada uno con su precio, su
  estado (activo/apagado) y, opcional, un **precio promocional** que se cobra a ese plan cuando el grupo llega a `minIntegrantes`
  (cuentan todos los integrantes activos, de cualquier plan). Cada integrante queda con el plan que eligió (grupos mixtos).
- **Los planes son tipos reales**: cada delegación tiene su **categoría oculta** `DELEGACION_<id>` (`categorias_inscripcion.delegacion_id`)
  con tres tipos (`delegacion_con_kit`, `delegacion_sin_kit`, `delegacion_virtual`; etiqueta CON KIT / SIN KIT / VIRTUAL; `modalidad`;
  `precio == precioInstitucional`; `disponiblePara = TODOS`). La inscripción apunta a su tipo, así la credencial («DELEGACION UNAC · CON KIT»),
  el correo, el escáner, el resumen por modalidad, el CSV y el portal funcionan **sin cambios**. Esas categorías no salen en
  Categorías y tipos ni en la landing (`delegacionId: null` en esas consultas) y no se editan ahí (`409 DELEGATION_CATEGORY_MANAGED`).
- **La categoría compartida `DELEGACIONES` desaparece** (migración `20261024120000_delegaciones_planes`): antes de borrarla convierte cada
  delegación a sus planes y mueve a sus integrantes (los montos no cambian).
- **El tipo del integrante ya no cambia con el tamaño del grupo**: lo que cambia es el precio de su plan (`recalcularGrupo` por plan).
- **Dos links**: `codigoLink` (el del delegado: agrega integrantes y vouchers) y `codigoInscripcion` (individual: cada integrante se inscribe
  solo; `NULL` = apagado). Se encienden, apagan y regeneran desde el panel. El delegado ve el individual para compartirlo.
- **Correo**: `delegaciones.dominio_correo` (`unac.edu.pe`, sin arroba). En los flujos **públicos** (link del delegado e individual) todo correo
  debe terminar en `@dominio` (el efectivo: el ya registrado si la persona existe); en el individual basta escribir el **prefijo**
  (`correoPrefijo`) y el servidor arma el correo, **sin Google**. El staff queda exento. El pago sigue siendo **del grupo**.
- **Solo el staff crea delegaciones**: se eliminan `POST /v1/site/delegations`, `GET /v1/site/delegations/tarifa` y
  `GET|PUT /v1/events/:eventId/delegations/tarifa`, y las columnas `eventos.delegaciones_*`.
- **Permisos**: `delegaciones.gestionar` (global: planes, precios, dominio, links, borrar voucher), `delegaciones.ver` (por evento) y
  `delegaciones.inscribir` (por evento: crear delegación, datos del grupo, integrantes, cambiar plan, subir vouchers). Validar vouchers y
  aprobar al grupo es `inscripciones.validar`; ver el voucher, `pagos.ver`. Sin `pagos.ver` los importes, `pago` y los vouchers van en
  `null`/`[]`; los links solo los ve quien inscribe o gestiona. Una Comisión que crea una delegación no fija precios: sus planes nacen
  **apagados y a S/ 0** hasta que un Owner o Administrador los configura (`403 FORBIDDEN` si manda `planes`, `minIntegrantes`, dominio o link).

## User Scenarios & Testing

### User Story 1 - Cada convenio con su precio y sus planes (Priority: P1)

1. **Given** una delegación con Con kit S/ 80 y Sin kit S/ 60 (promo S/ 50 desde 10), **When** el staff inscribe a unos con kit y a otros sin kit,
   **Then** cada uno cobra el precio de su plan y el total del grupo es la suma.
2. **Given** el grupo llega a 10 integrantes, **Then** solo el plan que tiene promocional baja (a S/ 50) y para todos sus integrantes.
3. **Given** el plan Virtual está apagado, **Then** no admite altas nuevas (`422 DELEGATION_PLAN_NOT_AVAILABLE`) pero quienes ya lo tienen lo conservan.

### User Story 2 - Los integrantes se inscriben solos con un correo institucional (Priority: P1)

1. **Given** la delegación tiene `dominioCorreo = unac.edu.pe` y el link individual encendido, **When** un integrante abre el link y escribe su prefijo,
   **Then** queda inscrito (pendiente) con `prefijo@unac.edu.pe` y el plan que eligió, sin Google.
2. **Given** el link individual está apagado, **Then** responde `404`.

### User Story 3 - Quién hace qué (Priority: P1)

1. **Given** soy Tesorero, **Then** veo las delegaciones, verifico o rechazo vouchers y apruebo al grupo, pero no inscribo ni cambio precios.
2. **Given** soy de la Comisión con `delegaciones.inscribir`, **Then** inscribo integrantes y cambio su plan, pero no veo montos.

## Requirements

- **FR-001**: el servidor decide el tipo y el precio de cada integrante; el cliente solo envía el `plan`.
- **FR-002**: con un solo plan activo no hace falta elegir (`PLAN_REQUIRED` si hay varios y falta); sin planes activos, `DELEGATION_WITHOUT_PLANS`.
- **FR-003**: `RECHAZADO` y `CANCELADO` no cuentan para el mínimo ni para el total.
- **FR-004**: cambiar precios, mínimo o plan reprecia al grupo en una transacción con la delegación bloqueada (`SELECT … FOR UPDATE`).
- **FR-005**: la migración es idempotente en los datos y no pierde inscripciones; `prisma migrate diff` queda vacío.

## Despliegue

Backend primero (su migración convierte las delegaciones y borra `DELEGACIONES`), luego el panel y la landing. Entre el backend y el panel la
pestaña antigua de Delegaciones se ve rota unos minutos. Respaldo de solo lectura antes (`mysqldump` de `categorias_inscripcion`,
`tipos_inscripcion`, `delegaciones`, `delegacion_pagos`, `inscripciones` y `eventos`) y verificación después con
`prisma/preflight/verificar-delegaciones-planes.sql`.

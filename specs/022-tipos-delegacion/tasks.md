# Tasks: Tipos de inscripción de delegación (General y Promocional)

- [x] T001 Esquema y migración: `delegaciones.tipo_inscripcion_id` (FK `SET NULL` →
      `tipos_inscripcion`) + `prisma migrate diff` vacío *(aplicada en local 2026-10-20:
      `migrate deploy` + `migrate diff` desde migraciones y desde la BD, ambos sin diferencias)*
- [x] T002 Helper `tiposDeDelegacion`: categoría `DELEGACIONES` del evento y precios resueltos desde
      `delegacion_general` / `delegacion_grupal` (fallback a `eventos.delegaciones_*`)
- [x] T003 `GET /v1/site/delegations/tarifa` con la tarifa resuelta desde los tipos
- [x] T004 `registroDelegacionSchema` acepta `tipoInscripcionId` y `registrarDelegacion` lo valida
      (422 `REGISTRATION_TYPE_NOT_AVAILABLE`), lo guarda en la delegación y lo propaga a cada
      inscripción (creadas, reutilizadas y `updateMany`); con `codigoLink` actualiza el tipo
- [x] T005 Alta desde el panel (`POST /delegations/:id/inscriptions`) hereda el tipo de la delegación
- [x] T006 `aDelegacion` incluye `tipoInscripcion` en la respuesta pública
- [x] T007 Mappers: `detalleInclude` con `delegacion` (+ `_count`); `aDetalle` y `aFilaLista` con
      `delegacion` (pago del grupo solo con `conPago`)
- [x] T008 `GET /v1/delegations/:id/voucher` acepta `pagos.ver` además de `eventos.configurar`
- [x] T009 Pruebas: tarifa desde tipos, validación y propagación del tipo, link, mappers,
      matriz de rutas
- [x] T010 Contrato: `contracts/api-tipos-delegacion.md`, `specs/021-delegaciones/contracts/…` y
      `docs/arquitectura-ecosistema.md` (contratos 3 y 4) + `docs/api.md`
- [x] T011 Landing (repo `ciisic-undc-web`): whitelist `DELEGACIONES`, tarjetas como sección 3
      (tras representante y datos de la delegación; secciones siguientes renumeradas), selección
      obligatoria con estado de error si faltan los tipos, envío de `tipoInscripcionId`, precarga
      desde el link, tests y docs *(typecheck/lint/test/build en verde; token ausente en `.output`)*
- [x] T012 Panel (repo `administrator-ciisic-frontend`): `delegacion` en `InscripcionFila` e
      `InscripcionDetalle`, badge «Delegación · nombre» en el listado, bloque de grupo y pago
      conjunto (con voucher) en el detalle *(typecheck/lint/test en verde)*

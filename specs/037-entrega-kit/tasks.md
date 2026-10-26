# Tasks: Entrega del kit en la puerta y asistencia solo presencial

- [x] T001 Migración aditiva `20261027180000_entrega_kit` (`tipos_inscripcion.incluye_kit`, `inscripciones.kit_entregado_en` y `kit_entregado_por_id` con su índice y clave foránea `SET NULL`) con el relleno de los tipos presenciales «con kit»
- [x] T002 `src/core/kit.ts` (`KitEstado`, `aKit`, `tipoIncluyeKit`, `KIT_SELECT`) y `HttpError.datos` (el `errorHandler` y `normalizeErrorResponses` lo emiten como `data`)
- [x] T003 Tipos: `incluyeKit` en `aTipo`, validación, crear y actualizar (virtual ⇒ sin kit), clonado de eventos y seed; planes de delegación (`PLANES[CON_KIT].incluyeKit`)
- [x] T004 Asistencia: `403 VIRTUAL_REGISTRATION`, `inscripcion.kit` en la marca y en el listado, `data` en `ATTENDANCE_ALREADY_REGISTERED`
- [x] T005 Módulo `src/api/kit`: `PUT|DELETE /v1/inscriptions/:id/kit` y `GET /v1/events/:eventId/kits/summary`; matriz de rutas (194)
- [x] T006 Detalle y listado de inscripciones con `kit`, `incluyeKit` y `kitEntregado`
- [x] T007 Pruebas: `tests/activity/kit.test.ts`, `tests/activity/asistencia.test.ts` (virtuales y kit), `tests/inscription/kit.test.ts`, `tests/registration-type/kit.test.ts`, delegaciones y clonado
- [x] T008 Contrato, AGENTS.md, README, `docs/api.md`, `docs/data-model.md` y `prisma/preflight/verificar-kit.sql`
- [x] T009 Probado contra MySQL local: `migrate diff` vacío, `migrate deploy` con relleno correcto (con kit: 1 y 3; sin kit y virtuales: 0)
- [ ] T010 Producción: desplegar el backend (la migración es aditiva), correr `verificar-kit.sql` en solo lectura y ajustar desde el editor de tipos cualquier tipo que no quede como corresponde

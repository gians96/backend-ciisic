# Tasks: delegaciones con convenio (spec 023)

- [x] T001 Merge de `origin/delegacionesd`; specs 018/019 → 021/022 y migraciones a `20261022*`
- [x] T002 Esquema: `delegaciones.modalidad` y datos del delegado; tabla `delegacion_pagos`; fuera las columnas de pago único
- [x] T003 `services/tarifa.ts`: `precioUnitario`, `tiposDeDelegacion`, `tipoParaGrupo`, `tarifaParaModalidad`
- [x] T004 `services/pagos.ts`: vouchers múltiples, verificación, resumen y número de operación único
- [x] T005 `services/delegation.ts`: alta del staff, edición, integrantes (recalcula monto y tipo), quitar, aprobar y registro público atómico
- [x] T006 `aprobarVarias` en `inscription.ts` (credenciales en diferido, una por una)
- [x] T007 `uploadVarios` y `validateUploadedFilesContent` en `middlewares/upload.ts`
- [x] T008 Rutas del sitio (registro, link, integrantes, vouchers) y del panel (edición, baja, aprobar, pagos)
- [x] T009 `delegacion` de las inscripciones con la modalidad y el resumen de pagos (`mappers.ts`)
- [x] T010 Pruebas: tarifa y umbral 9 → 10, virtual plana, vouchers, solo-agregar por link, aprobar, matriz de rutas
- [x] T011 Contrato `contracts/api-delegaciones-convenio.md`, `docs/arquitectura-ecosistema.md`, `docs/api.md`, `AGENTS.md`
- [x] T012 `prisma/preflight/configurar-delegacion-virtual.sql` y `verificar-delegacion-virtual.sql` (producción, no se ejecutan aquí)
- [ ] T013 Producción: respaldo, despliegue del backend, crear `delegacion_virtual` y verificar

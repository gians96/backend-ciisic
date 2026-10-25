# Tasks: Enlace público del aforo de las ponencias especializadas

- [x] T001 Migración aditiva `20261027120000_enlace_aforo_ponencias` y modelo `EnlaceAforoPonencias` (uno por evento)
- [x] T002 Permiso `especializadas.enlace_aforo` (global, solo Owner) en `permisos.ts`
- [x] T003 `aPonenciaAforo` y `listarAforo` en `services/talks.ts` (sin datos de personas, bio ni precio)
- [x] T004 `services/enlace-aforo.ts`: obtener, crear o renovar, desactivar y `aforoDelEnlace` (mismo evento, mismo 404, acceso cada 5 min)
- [x] T005 Rutas `GET|POST|DELETE …/specialized-talks/occupancy-link` y `GET /v1/site/specialized-talk-occupancy`, controlador y validación
- [x] T006 Pruebas (`tests/specialized-talk/enlace-aforo.test.ts`), permisos, matriz de rutas (191) y rutas protegidas
- [x] T007 Contrato, AGENTS.md, README, `docs/data-model.md` y `docs/arquitectura-ecosistema.md`
- [ ] T008 Probado contra MySQL real: `migrate dev`, `migrate diff` vacío y la página de la landing con el enlace del panel
- [ ] T009 Producción: desplegar (la migración solo crea una tabla); el Owner crea el enlace desde el panel

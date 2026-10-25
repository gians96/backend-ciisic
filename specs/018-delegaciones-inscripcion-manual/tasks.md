# Tasks: Delegaciones e inscripción manual

- [x] T001 Esquema: enum `TipoDelegacion`, modelo `Delegacion`, `Inscripcion.delegacionId` (FK `SET NULL`) y migración a mano
- [x] T002 Permisos globales: `delegaciones.gestionar` e `inscripciones.manual` (Owner y Administrador) con sus etiquetas
- [x] T003 Módulo `delegation`: CRUD, listado por evento y miembros paginados
- [x] T004 Inscripción manual: validador, servicio (`crearInscripcionManual`), controller y ruta
- [x] T005 Mappers: `delegacion` en el detalle y en las filas del listado; filtro `delegacionId`
- [x] T006 Pruebas: `tests/delegation/delegaciones.test.ts` y `tests/inscription/manual.test.ts`; matriz de rutas (135)
- [x] T007 Contrato para el panel (`contracts/api-delegaciones.md`) y docs (`data-model`, `api`, `arquitectura-ecosistema`, `overview`, README)
- [ ] T008 Panel: pantallas de delegaciones, inscripción manual y filtro por delegación (repo del panel, fuera de este alcance)

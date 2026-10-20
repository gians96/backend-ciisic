# Tasks: Ponencias especializadas

- [x] T001 Esquema Prisma: `PonenciaEspecializada`, `AsistentePonencia`, `InscripcionPonencia` y sus enums
- [x] T002 Migración `20261020120000_ponencias_especializadas` (generada contra la BD local) y `prisma migrate diff` vacío
- [x] T003 Permisos `especializadas.*` (catálogo, etiquetas, dependencias, elegibles de la Comisión) y resolutores de evento
- [x] T004 Reglas puras (`src/core/ponencias-especializadas.ts`) y limitador `limiteCheckInPonencia`
- [x] T005 Validación (`validation.ts`) y servicios: ponencias, asistentes, inscripciones y asistencia en puerta
- [x] T006 Rutas del panel (9) y del sitio (2), controladores
- [x] T007 Seed idempotente y datos 2026
- [x] T008 Pruebas: ponencias, inscripciones (sitio y panel), puerta, reglas puras, permisos y matriz de rutas
- [x] T009 Docs: `docs/api.md`, `data-model.md`, `overview.md`, `arquitectura-ecosistema.md`, README y AGENTS
- [ ] T010 Panel: Programa, Inscripciones y Asistencia en puerta (spec 012 del panel)
- [ ] T011 Landing: página de inscripción (spec 006 de la landing)
- [ ] T012 Producción (tras desplegar): migración, seed del evento y asignar los permisos a la Comisión

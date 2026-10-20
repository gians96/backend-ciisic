# Tasks: Tipos de inscripción que no admiten estudiantes UNDC

- [x] T001 Columna `tipos_inscripcion.excluye_estudiantes_undc` con migración aditiva (`false` por defecto) y `schema.prisma`
- [x] T002 `esCorreoDeEstudiante` / `PATRON_CODIGO_ESTUDIANTE` en `correo-institucional.ts` y `estudianteUndcExcluido` en `pricing.ts`
- [x] T003 Guarda en `crearInscripcion` (sitio y legacy; no en cortesías): `422 REGISTRATION_TYPE_NOT_AVAILABLE`
- [x] T004 Validación y servicio de tipos: `aTipo`, `tiposPublicos`, `crearTipo`, `actualizarTipo`
- [x] T005 Copiar el interruptor al crear un evento copiando otro; `seed.ts --demo`
- [x] T006 Pruebas (precio/correo, creación, tipos del panel y del sitio, copia de evento)
- [x] T007 Script de producción `prisma/preflight/excluir-estudiantes-undc-virtual.sql` (idempotente) con verificación y conteo de estudiantes ya inscritos
- [x] T008 Contratos y documentación: `contracts/api-excluye-estudiantes.md`, `docs/`, README, AGENTS y nota en la spec 018
- [ ] T009 Panel: casilla «No admitir estudiantes UNDC» en el editor de tipos y badge en la lista (spec 013 del panel); landing: ocultar el plan a estudiantes UNDC y explicarlo (spec 007 de la landing)
- [ ] T010 Producción: respaldo, desplegar el backend, encender el interruptor en `estudiantes_virtual` y `general_virtual` (panel o script), verificar. Decidir qué hacer con los estudiantes UNDC ya inscritos en virtual (2 aprobados el 2026-10-20)

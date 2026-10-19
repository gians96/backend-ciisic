# Tasks: Modalidad de asistencia virtual

- [x] T001 Enum `ModalidadAsistencia`, columna `tipos_inscripcion.modalidad` con migración aditiva (`PRESENCIAL` por defecto) y `catalogos.ts`
- [x] T002 Validación y servicio de tipos: `aTipo`, `tiposPublicos`, `crearTipo` y `actualizarTipo`
- [x] T003 Copiar la modalidad al crear un evento copiando otro
- [x] T004 Resumen del evento: `porTipo[].modalidad` y `totales.porModalidad`
- [x] T005 Inscripciones: `tipoInscripcion.modalidad` (detalle, lista, creación), filtro `?modalidad=` fusionado con `?categoria=` y columna «Modalidad de asistencia» del CSV
- [x] T006 Portal (lista y fotocheck) y escáner de asistencia (aviso, sin bloquear)
- [x] T007 Credencial PDF (rótulo, huella, `VERSION_PLANTILLA`) y párrafo del correo de aprobación solo para virtuales
- [x] T008 `seed.ts --demo`: tipos virtuales de demostración
- [x] T009 Pruebas
- [x] T010 Scripts de producción: `prisma/preflight/configurar-virtual.sql` (idempotente, no destructivo) y `verificar-virtual.sql`
- [x] T011 Contratos y documentación: `contracts/api-modalidad.md`, specs 002, 007 y 014, `docs/` (modelo de datos, operación, arquitectura del ecosistema, API), README y AGENTS
- [ ] T012 Panel: selector de modalidad en el tipo, filtro, columna y KPI (spec del panel)
- [ ] T013 Landing: separar los tipos presenciales de los virtuales con textos neutros (spec de la landing)
- [ ] T014 Producción: respaldo, desplegar el backend, crear los tipos `estudiantes_virtual` y `general_virtual` (script o panel), desplegar panel y landing, verificar

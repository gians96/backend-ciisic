# Tasks: Cambiar el tipo de una inscripción (solo Owner)

- [x] T001 Migración aditiva `20261026150000_cambios_tipo_inscripcion` y modelo `CambioTipoInscripcion` (historial con el texto de los dos tipos)
- [x] T002 Permiso `inscripciones.cambiar_tipo` (global, solo Owner) en `permisos.ts`
- [x] T003 `descuentoSobreLista` (puro, compartido con `calcularPrecio`) y `etiquetaDeTipo`
- [x] T004 `services/cambio-tipo.ts`: validar (delegación, mismo tipo, tipo del evento), cambiar con descuento recalculado, historial y ajuste de las ponencias pendientes en una transacción
- [x] T005 Ruta `PATCH /v1/inscriptions/:id/type`, controlador y `cambiosTipo` en `GET /v1/inscriptions/:id`
- [x] T006 Pruebas (`tests/inscription/cambio-tipo.test.ts`), permisos, matriz de rutas (187) y mocks del detalle
- [x] T007 Contrato, AGENTS.md, README y `docs/arquitectura-ecosistema.md`
- [x] T008 Panel (spec 026): botón «Cambiar tipo» en el detalle de la inscripción, historial y mensajes de error (rama `feat/cambiar-tipo-inscripcion` del panel)
- [x] T008b Probado contra MySQL real (copia aislada de la BD local con todas las migraciones): `prisma migrate deploy` sin errores y `migrate diff` vacío; cambio de tipo, historial, descuento, ponencias pendientes (virtual ↔ presencial con y sin cupo), delegación (409) y permisos (403)
- [ ] T009 Producción: desplegar (la migración solo crea una tabla) y corregir los tipos que el Owner indique

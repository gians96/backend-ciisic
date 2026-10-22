# Tasks: Ponencias especializadas solo para congresistas con pago aprobado

- [x] T001 Esquema y migración aditiva (`eventos.ponencias_acceso_libre`, `inscripciones_ponencia.inscripcion_congreso_id` y `modo_asistencia`)
- [x] T002 Regla pura (`resolverElegibilidad`, `correosCoinciden`) y servicio `congresista.ts` (`resolverAcceso`, `selloDe`, `verificarCongresista`)
- [x] T003 Cupo solo presencial (`exigirCupo` con modo, `sellarInscripcion`) y conteos presencial/virtual en el programa
- [x] T004 Landing: `inscribirDesdeSitio` con validación (documento + correo), `meta.accesoLibre` y `POST /site/specialized-talk-eligibility`
- [x] T005 Staff y puerta: alta manual, reactivación y asistencia validan por documento; la respuesta lleva `validada` y `modoAsistencia`
- [x] T006 Listado del panel: `validada`, `modoAsistencia`, `congreso`, filtros `validacion` y `modo`, `meta.sinValidar`
- [x] T007 Interruptor `GET|PUT /v1/events/:eventId/specialized-talks/access`
- [x] T008 Script `ponencias-especializadas:validar-existentes` (simula por defecto; `--aplicar`; `--csv`)
- [x] T009 Pruebas (validación, cupo por modo, interruptor, listado) y matriz de rutas (175)
- [x] T010 Contratos y documentación (`contracts/`, `docs/arquitectura-ecosistema.md`, README, AGENTS, nota en la spec 019)
- [ ] T011 Panel (spec 020 del panel) y landing (spec 009 de la landing)
- [ ] T012 Producción: respaldo, desplegar, `validar-existentes` (simulación y luego `--aplicar`), revisar los «Sin validar» y decidir el acceso libre

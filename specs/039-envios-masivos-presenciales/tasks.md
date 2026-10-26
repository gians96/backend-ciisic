# Tasks: Envíos masivos a los inscritos presenciales

- [x] T001 Marcas `enlace_credencial_enviado_en` y `enlace_ponencias_enviado_en` en `inscripciones` (migración de la spec 038)
- [x] T002 `broadcast/services/destinatarios.ts`: aprobadas presenciales, búsqueda y filtro «enviado», página con totales del evento e ids
- [x] T003 `broadcast/services/enviar.ts`: reserva atómica de la marca, envío por persona, reversión si falla y resultado `{ enviados, yaEnviados, noElegibles, fallidos }`
- [x] T004 Enlace de la credencial (`enviarCorreoEnlaceCredencial` + plantilla `credencial-enlace.html`) y mensaje de ponencias (`htmlComunicado` con botón) con su prueba
- [x] T005 Rutas, controlador, validación (máx. 100) y límites `limiteEnviosMasivos` / `limiteLecturaEnvios`; matriz de rutas
- [x] T006 Pruebas (`tests/broadcast/envios.test.ts`, `tests/email/enlace-credencial.test.ts`)
- [x] T007 Contrato `contracts/api-envios-masivos.md`, `docs/`, AGENTS.md y README
- [ ] T008 Probado de punta a punta en local con un Brevo simulado (panel + backend)
- [ ] T009 Producción: tras desplegar, revisar los créditos de Brevo (Correo → Probar) y enviar por tandas

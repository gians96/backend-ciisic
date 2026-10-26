# Tasks: Credencial 3D con enlace y tecnologías editables

- [x] T001 Migración aditiva `20261028120000_credencial_3d_y_envios` (`url_landing`, `tecnologias_credencial` y las marcas de la spec 039); `migrate diff` vacío
- [x] T002 `urlLanding` en Sistema (`core/configuracion-sistema.ts`, `system-settings` service y validación); no sale en la configuración pública
- [x] T003 `services/credencial-publica.ts`: `credencialPublica` y `guardarTecnologias` (solo aprobadas del evento del token; `tecnologiasDe` tolerante)
- [x] T004 Rutas `GET /v1/site/credential/:codigo` y `POST …/technologies`, controlador, validación yup y límites (`limiteEdicionCredencial`, `limiteTokenEdicionCredencial`)
- [x] T005 Botón «Ver mi credencial 3D» en el correo de aprobación (`filaCredencial3d`, `approval.html`); el PDF adjunto no cambia
- [x] T006 Helper puro `core/enlaces-landing.ts` (`urlCredencial`, `urlInscripcionPonencias`, `origenLanding`)
- [x] T007 Pruebas: `tests/site/credencial-publica.test.ts`, `tests/email/enlace-credencial.test.ts`, `tests/core/enlaces-landing.test.ts` y la matriz de rutas (200)
- [x] T008 Contrato `contracts/api-credencial.md`, `docs/arquitectura-ecosistema.md`, `docs/configuracion.md`, `docs/api.md`, AGENTS.md y README
- [ ] T009 Producción: desplegar (migración aditiva) y poner la URL de la landing en Sistema (`https://ciisic-viii.episundc.pe`)

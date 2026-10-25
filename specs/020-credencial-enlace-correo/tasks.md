# Tasks: Credencial en el correo con enlace a la landing

- [x] T001 Esquema: `url_landing` en `configuracion_sistema` (migración aditiva `20261025120000_url_landing`)
- [x] T002 Configuración: `urlLanding` en `ConfiguracionVigente`/`aVigente`, validación yup y `normalizarUrlSitio` en el panel; **no** en `configuracionPublica`
- [x] T003 Informe PDF genérico en `generatePdf.ts`: `huellaInforme`, `rutaInforme`, `htmlDeInforme`, `borrarInformes`, `generarInformePdf` (retrato, misma cola) + plantilla `templates/informe.html`
- [x] T004 Correo: `enviarCorreoAprobacion(inscripcion)` con `{{ACCION}}` (botón al enlace), adjunto del informe a mejor esfuerzo y plantilla `approval.html` actualizada
- [x] T005 `emitirCredencial` sin `pdfPath` (sigue generando la credencial personalizada para descargas)
- [x] T006 Endpoint `GET /v1/site/credential/:codigo` (service `credencialPublica`, controller `publicCredential`, ruta con token y límites)
- [x] T007 Pruebas: matriz de rutas (136), correo con informe y enlace, informe PDF, endpoint del sitio, `urlLanding` en settings; firma nueva en admin/manual/cortesia/credencial
- [x] T008 Contratos y docs: `contracts/api-credencial.md`, ruta en el contrato de la API del sitio (spec 007), `docs/arquitectura-ecosistema.md` (contrato 3), `docs/configuracion.md`, `docs/api.md`, `README.md`
- [ ] T009 Landing (`ciisic-undc-web`): BFF `GET /api/publico/credencial/:codigo`, página `/credencial/:codigo` con menú ⋮ «Editar» (tecnologías en localStorage), retiro del demo y copy de `confirmacion.ts`
- [ ] T010 Panel (`administrator-ciisic-frontend`): campo «URL de la landing» en Sistema (hasta entonces se configura con `PUT /v1/settings`)

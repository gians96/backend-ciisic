# Tasks: Resumen por persona de las ponencias especializadas, cancelación y comunicado

- [x] T001 Migración aditiva `20261024150000_ponencias_resumen_aviso` (`SIN_CONGRESO`, `aviso_enviado_en`) y esquema
- [x] T002 Reglas puras compartidas (`SituacionCongreso`, `situacionDe`, `variantesDocumento`; `validar-existentes` las usa)
- [x] T003 `services/resumen.ts`: personas con su situación actual, filtros, totales y listado paginado
- [x] T004 `services/avisos.ts`: cancelar (`SIN_CONGRESO`) y avisar por correo con comunicado escapado y `{nombre}`
- [x] T005 `services/exportar-resumen.ts`: Excel con hoja de resumen y hoja de personas
- [x] T006 Rutas, controlador, validación y límites por cuenta (`limiteDescargaResumenPonencias`, `limiteAvisosPonencias`)
- [x] T007 Pruebas (`tests/specialized-talk/resumen.test.ts`) y matriz de rutas (186)
- [x] T008 Contrato, AGENTS.md, README y `docs/arquitectura-ecosistema.md`
- [x] T009 Panel (spec 022): pantalla «Resumen» con filtros, descarga, cancelar y avisar (rama `feat/ponencias-resumen-personas` del panel)
- [ ] T010 Producción: desplegar, revisar el resumen y decidir a quién se cancela o avisa (con permiso)

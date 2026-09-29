# Tasks: Configuración del sistema en la BD

- [x] T001 Migración `20260930120000_configuracion_sistema` (fila única con `CHECK`) y modelo `ConfiguracionSistema`
- [x] T002 Caché de configuración con actualización inmediata al guardar
- [x] T003 Módulo `system-settings` (SuperAdmin) + prueba de conexión con API_UNDC
- [x] T004 Configuración pública para el panel y la landing
- [x] T005 API_UNDC, rutas legacy y deportes-fi leen la configuración y validan URLs contra SSRF
- [x] T006 Constantes en lugar de `DNI_*`, `INTEGRATIONS_*`, `VERIFICACION_*`, `BREVO_API_URL`, `EMAIL_TIMEOUT_MS`, `UPLOADS_DIR`, `MAX_UPLOAD_BYTES`; `config/env.ts` con 3 variables
- [x] T007 Importación única de `UNDC_API_*`, `GOOGLE_CLIENT_ID` y `LEGACY_ROUTES_ENABLED`; avisos de variables obsoletas
- [x] T008 `bootstrapAdmin` con argumentos y contraseña temporal; entrypoint siempre migra
- [x] T009 Pruebas
- [ ] T010 Producción: configurar API_UNDC en Sistema cuando API_UNDC (rama `feat/clientes-api`) esté desplegada

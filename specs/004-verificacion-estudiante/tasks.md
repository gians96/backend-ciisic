# Tasks: Verificación de estudiantes

- [x] T001 Contrato con API_UNDC en `docs/arquitectura-ecosistema.md` (Contrato 1)
- [x] T002 Cliente `undc-client.ts` (API key, timeout, errores → no disponible)
- [x] T003 Servicio de verificación con motivos y nombres oficiales (spec 003)
- [x] T004 Token firmado atado a evento/documento/correo (pruebas de alteración y coincidencia)
- [x] T005 Endpoint público con rate limit
- [x] T006 Precio UNDC solo con token válido; instantánea en la inscripción (pruebas)
- [x] T007 Migración `20260929120300_verificacion_estudiante`
- [ ] T008 Configurar `UNDC_API_URL`/`UNDC_API_KEY` en producción (tras desplegar API_UNDC)
- [x] T009 Prueba integrada contra API_UNDC local: verificado (token + S/ 100), identidad que no coincide → IDENTIDAD_NO_COINCIDE, correo inexistente → NO_ES_ESTUDIANTE, externo → S/ 120 (2026-09-29)

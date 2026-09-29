# Tasks: Consultas de DNI

- [x] T001 Investigar documentación de Decolecta y apiperu (endpoints, respuestas, errores)
- [x] T002 Migración `20260929120200_consultas_dni` y modelos Prisma
- [x] T003 Cifrado AES-256-GCM (`src/core/crypto.ts`) con pruebas
- [x] T004 Adaptadores Decolecta y apiperu + clasificación de fallas (pruebas con `fetch` simulado)
- [x] T005 Pool con rotación, renovación perezosa, límite local, caché y bitácora (pruebas)
- [x] T006 Endpoints públicos (con rate limit) y alias legacy `/v1/reniec/dni`
- [x] T007 Endpoints admin: CRUD, prueba, reinicio, uso y bitácora
- [x] T008 Eliminar módulo `reniec` (NubeTec en host de pruebas) y variables obsoletas
- [ ] T009 Registrar los tokens reales en el panel de producción (responsable: administrador)

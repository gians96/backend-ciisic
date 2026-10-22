# Tasks: DNI y secciones editables del docente, y consulta con el DNI (spec 028)

- [x] T001 Columna `asesores.documento` + índice único `(evento_id, documento)` y migración aditiva `20261023150000_asesores_documento` (aplicada en local, sin drift)
- [x] T002 `normalizarDni` (7 u 8 dígitos → 8) en `services/seguimiento.ts`
- [x] T003 `services/asesores.ts`, `controllers/asesores.ts`, `docenteSchema` y 4 rutas de gestión (`reportes.gestionar`, `limiteGestionDocentes`)
- [x] T004 `asesorDelDocumento` y `seguimientoDelDocumento` (comparten el armado con el enlace personal); `POST /v1/public/advisor/lookup` y `/export`
- [x] T005 `limiteIntentosDni` (10 fallos / 15 min por IP; `soloFallos` en `limitador`) y respuesta idéntica para cualquier DNI inválido
- [x] T006 Recarga del padrón: `asesores=conservar|reemplazar` (por defecto conserva), conserva DNI y enlace por nombre al reemplazar y avisa de secciones que ya no están
- [x] T007 Matriz de rutas (178) y pruebas: `asesores.test.ts`, `consulta-dni.test.ts` e importación (`api.test.ts`, `enlaces.test.ts`)
- [x] T008 Documentación: contrato, `docs/api.md`, `docs/data-model.md`, `docs/arquitectura-ecosistema.md`, `README.md` y `AGENTS.md`
- [ ] T009 Producción: desplegar (la migración corre al iniciar), cargar el DNI de los docentes desde el panel y repartir la dirección de la página común

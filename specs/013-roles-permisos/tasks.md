# Tasks: Roles, permisos y alcance por evento

- [x] T001 Catálogos de roles (`ROL`, `ROLES_GLOBALES`) y métodos de asistencia
- [x] T002 Catálogo de permisos, dependencias, permisos por rol y elegibles de la Comisión
- [x] T003 Esquema y migración `20260930150000_roles_permisos_alcance`
- [x] T004 Preflight, reasignación y reversión (`prisma/preflight/*-013.sql`)
- [x] T005 Actor leído de la BD y resolutores del evento
- [x] T006 `requirePermiso`, `requireActor` y límites por cuenta
- [x] T007 Infraestructura de pruebas (`setup-actor`, `tokenDeRol` con eventos y permisos)
- [x] T008 Identidad: delegación en `/v1/admin`, `LAST_OWNER`, `/v1/roles`, sesión y login con `acceso`, `POST /v1/auth/refresh`, Google, seed y bootstrap
- [x] T009 Operación: vista reducida de eventos, montos en null sin `pagos.ver`, `STATUS_NOT_ALLOWED`, reenvío con PDF reutilizado, categorías, integraciones, ponencias y mensajes
- [x] T010 Asistencia: búsqueda en el evento, auditoría, fuera de horario con permiso, anulación lógica, documento enmascarado y límite por cuenta
- [x] T011 Configuración: tokens de acceso, correo, Sistema, consultas DNI, participantes y QR de pago
- [x] T012 Pruebas por frente, con acceso denegado en cada ruta protegida
- [x] T013 Documentación: spec, plan, contrato, `docs/`, `AGENTS.md` y constitución 1.3.0
- [x] T014 Seguridad transversal: matriz de rutas y alcance (`tests/security/matriz-rutas.test.ts`, `alcance.test.ts`), actualizar `tests/security/routes.test.ts` (mock `participante.findUnique`; el Administrador ya entra a `/admin`, correo y tokens) y retirar `requireRoles`, `verifyAdminRole` y `verifySuperAdminRole`
- [ ] T015 Panel: permisos en menús, páginas y botones; formulario del equipo (spec 008 del panel)
- [ ] T016 Prueba integrada local (panel → backend) con una cuenta de cada rol en un evento en BORRADOR
- [ ] T017 Despliegue: respaldo, `verificar-roles-013.sql`, decisión cuenta por cuenta, migración y `reasignar-013.sql` (ver `docs/operacion.md`)
- [x] T018 Revisión adversarial: huella de credenciales en el JWT y tope de 12 h de la renovación, promoción fuera de la delegación sin credenciales, relectura del rol con `FOR UPDATE` (`ADMIN_CHANGED`), correo propio solo el Owner, cuentas sin eventos editables, exportación de asistencia enmascarada, `esFueraDeHorario` real, límite de marcado solo por evento, `pago` con claves en null, PDF de la credencial al día y resumen de deportes con lista blanca

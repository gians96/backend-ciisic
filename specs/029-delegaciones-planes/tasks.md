# Tasks: delegaciones con planes y tarifa propios (spec 029)

- [x] T001 `schema.prisma` y migración `20261024120000_delegaciones_planes` (esquema, conversión de lo existente y borrado de `DELEGACIONES`)
- [x] T002 `services/planes.ts` (catálogo de planes, precio por plan, reglas) y borrar `tarifa.ts` y `tarifa-admin.ts`
- [x] T003 `services/delegation.ts`: alta con planes, listado agrupado, detalle, configuración, links, integrantes con plan, cambio de plan, dominio
- [x] T004 `validation.ts`, `controllers/delegation.ts` y `routes/delegation.ts` (rutas nuevas y retiradas)
- [x] T005 Permisos `delegaciones.gestionar|ver|inscribir` (`core/permisos.ts`, Tesorero y Comisión elegible)
- [x] T006 Categorías de delegación ocultas y protegidas (`registration-type`, `event` y `inscription/mappers`)
- [x] T007 Pruebas: `tests/delegation/delegacion.test.ts` (103), permisos, categorías ocultas, clonado y resumen; matriz de rutas (173)
- [x] T008 `prisma/preflight/verificar-delegaciones-planes.sql`; migración probada sobre una copia de producción (3 delegaciones, 3 integrantes movidos) y `migrate diff` vacío
- [x] T009 Contrato `contracts/api-delegaciones-planes.md`, `docs/`, `AGENTS.md` y README
- [ ] T010 Producción: respaldo de solo lectura, desplegar el backend (migra y borra `DELEGACIONES`), verificar con el preflight, y luego panel y landing

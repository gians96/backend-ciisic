# Tasks: tarifa de delegaciones administrable (spec 024)

- [x] T001 `validation.ts`: `tarifaDelegacionesSchema` (mínimo, precios, virtual, aplicar a existentes; al menos un dato)
- [x] T002 `services/tarifa-admin.ts`: `obtenerTarifaAdmin` y `guardarTarifa` (tipos, evento, tipo virtual, delegaciones vacías)
- [x] T003 `controllers/delegation.ts` y `routes/delegation.ts`: `GET` y `PUT /v1/events/:eventId/delegations/tarifa`
- [x] T004 `tests/delegation/tarifa-admin.test.ts` y matriz de rutas (158 rutas)
- [x] T005 Contrato `contracts/api-tarifa-delegaciones.md`, `docs/arquitectura-ecosistema.md`, `docs/api.md`, `AGENTS.md`
- [ ] T006 Producción: desplegar el backend (sin migración) y, desde el panel, ajustar la tarifa si se decide

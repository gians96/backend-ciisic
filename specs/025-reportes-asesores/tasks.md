# Tasks: reportes de seguimiento por asesor (spec 025)

- [x] T001 Esquema: `Asesor`, `AsesorSeccion` y `PadronEstudiante` y migración `20261023120000_seguimiento_asesores` (aditiva, escrita a mano; `prisma migrate diff` sin cambios)
- [x] T002 Permisos `reportes.ver`, `reportes.exportar` (por evento) y `reportes.gestionar` (global) con sus dependencias; Tesorero y Comisión elegible
- [x] T003 `services/seguimiento.ts`: situación, normalización, cruce con inscripciones, filtros y resúmenes (puro)
- [x] T004 `services/consulta.ts`: lectura del padrón, los asesores y las inscripciones coincidentes (listas `IN` por lotes)
- [x] T005 `services/lector-excel.ts` y `services/importacion.ts`: lectura del Excel de la facultad, advertencias y reemplazo en una transacción
- [x] T006 `exports/excel.ts` (`exceljs`) y `exports/pdf.ts` (`pdfkit`), con los mismos datos y sin columnas de dinero sin «pagos.ver»
- [x] T007 `controllers`, `routes`, `uploadExcel` (memoria, ≤ 5 MB, firma ZIP) y limitadores por cuenta
- [x] T008 Pruebas: `tests/advisory/*` y la matriz de rutas (162 rutas)
- [x] T009 Contrato, `docs/api.md`, `docs/data-model.md`, `docs/arquitectura-ecosistema.md`, `README.md` y `AGENTS.md`
- [ ] T010 Producción: desplegar el backend (la migración corre sola al iniciar), luego el panel (spec 016) y, desde Reportes, cargar el Excel (primero «Simular»)

# Tasks: Secciones por curso (JP) en el seguimiento por asesor

- [x] T001 Migración aditiva `20261025140000_padron_secciones` (tabla `padron_secciones`, FK en cascada, relleno) y modelo `PadronSeccion`
- [x] T002 `seguimiento.ts` (puro): `secciones` por alumno y por fila, asesores de todas, `filtrarAlcance` con proyección, `resumir` y `opcionesDeFiltro` por sección
- [x] T003 `consulta.ts`, `enlaces-ciclo.ts` y `asesores.ts` leen `padron_secciones`; `importacion.ts` guarda con `guardarPadron` (Excel: una sección por alumno)
- [x] T004 Vistas públicas con `secciones` (solo etiquetas del alcance) y columna «Otras secciones» en el Excel y el PDF
- [x] T005 `matriculas-jp.ts`: `plegarSeccion`, `seccionesDelEstudiante`, `seccionPrincipal` y `consolidarPadron`
- [x] T006 `designacion.ts`: lectura y validación del JSON de asesores (grupos, turnos, DNI) y `planearAsesores`
- [x] T007 Script `padron:desde-jp` (JP solo lectura, simula por defecto, `--aplicar`, `--csv`) y dependencia `mysql2`
- [x] T008 Pruebas (`matriculas-jp`, `designacion`, ampliación de seguimiento y de la vista por DNI) y actualización de las existentes
- [x] T009 Contrato, `AGENTS.md`, README, `docs/operacion.md` y `prisma/preflight/verificar-padron-jp.sql`
- [ ] T010 Panel (spec 023): etiquetas de las otras secciones y filtros por sección (rama del panel)
- [ ] T011 Producción: desplegar (migración), respaldo `mysqldump`, simulación contra JP, `--aplicar` y verificación (con permiso explícito)

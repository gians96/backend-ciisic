# Tasks: Seguimiento por curso y docente según SIVIRENO

- [x] T001 Migración aditiva `20261026120000_padron_cursos` y modelos `PadronCurso`, `PadronMatricula` y `Asesor.jpDocenteId`
- [x] T002 `seguimiento.ts` (puro): `cursos` por alumno y por fila, secciones y asesores desde los cursos, `cursoId` en `filtrarAlcance` (proyección por curso), `porCurso` y `opciones.cursos`
- [x] T003 `consulta.ts` lee las matrículas con su curso y docente (quien no tiene curso queda sin docente); `importacion.ts` guarda cursos y matrículas con `guardarPadron`
- [x] T004 Vistas públicas con `cursos` (solo del alcance) y filtro `cursoId` en el panel de administración y en las descargas
- [x] T005 Excel y PDF: tabla «Por curso», columna «Cursos» y hoja «Listado completo» (una fila por alumno y curso)
- [x] T006 `asesores.ts`: un docente de SIVIRENO solo cambia de nombre y DNI; la lista trae `desdeSivireno` y `cursos`
- [x] T007 `services/cursos-jp.ts` (puro) y script `padron:desde-jp` reescrito (JP solo lectura, simula por defecto, `--docentes`, `--aplicar`, `--csv`); se retiran `designacion.ts` y `matriculas-jp.ts`
- [x] T008 Pruebas (`cursos-jp`, `guardar-padron`, ampliación de seguimiento, api, vista por DNI y vista del ciclo)
- [x] T009 Contrato, `AGENTS.md`, README, `docs/operacion.md`, `docs/arquitectura-ecosistema.md` y `prisma/preflight/verificar-padron-cursos.sql`
- [ ] T010 Panel (spec 025): pestaña «Por curso», listado completo y vistas públicas por curso
- [ ] T011 Producción: desplegar (migración), respaldo `mysqldump`, simulación contra JP, `--aplicar` y verificación (con permiso explícito)

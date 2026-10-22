# Tasks: enlace público por docente (spec 026)

- [x] T001 Esquema: `asesores.enlace_token` (único), `enlace_creado_en` y `enlace_ultimo_acceso`; migración aditiva `20261023130000_enlaces_asesores` (`prisma migrate diff` sin cambios)
- [x] T002 `services/enlaces.ts`: token de 256 bits, listar, crear (faltantes o `regenerar`), desactivar y resolver el token con último acceso
- [x] T003 `services/publico.ts`: vista mínima del docente (sin DNI, correo, montos ni otros asesores) y los datos de su reporte
- [x] T004 `exports`: marca `publico` (Excel y PDF sin DNI, correo ni columna de asesores)
- [x] T005 `services/importacion.ts`: los enlaces sobreviven a recargar el padrón (por nombre del asesor)
- [x] T006 `controllers/enlaces.ts`, `controllers/publico.ts`, `validation.ts`, rutas y limitadores (administración por cuenta, vista pública por IP)
- [x] T007 Pruebas: `tests/advisory/enlaces.test.ts` (13) y la matriz de rutas (167 rutas, 2 públicas nuevas)
- [x] T008 Contrato, `docs/api.md`, `docs/data-model.md`, `docs/arquitectura-ecosistema.md`, `README.md` y `AGENTS.md`
- [ ] T009 Producción: desplegar el backend (la migración corre sola) y el panel (spec 017); desde Reportes → «Padrón y enlaces» crear los enlaces y enviarlos

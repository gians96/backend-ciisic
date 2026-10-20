# Plan: Ponencias especializadas

**Spec**: [spec.md](spec.md) · **Contrato**: [contracts/api-ponencias-especializadas.md](contracts/api-ponencias-especializadas.md)

## Diseño

- **Módulo** `src/api/specialized-talk/` (se autocarga): `routes`, `controllers`, `validation.ts` y tres
  grupos de servicios:
  - `services/talks.ts`: CRUD, listados (panel y sitio), conteos por ponencia y regla de ambiente.
  - `services/asistentes.ts`: busca o crea a la persona por documento (`SITIO` no modifica a una existente;
    `PANEL` completa solo datos vacíos). La consulta externa va **antes** de abrir la transacción.
  - `services/registrations.ts`: listado con filtros, alta manual, cancelar/reactivar/corregir, anular
    asistencia e inscripción desde el sitio. `bloquearPonencias` + `exigirCupo` son el patrón de cupo.
  - `services/checkin.ts`: asistencia en puerta (persona → inscripción → marca → liberación de cruzadas).
- **Reglas puras** en `src/core/ponencias-especializadas.ts` (`seCruzan`, `duracionMinutos`,
  `esFueraDeHorario`, `esFotoValida`), con pruebas propias.
- **Transacciones**: `prisma.$transaction` + `SELECT … FOR UPDATE` de las filas de las ponencias, siempre en
  orden de id. Las ponencias de una petición del sitio se bloquean juntas (todo o nada).
- **Pruebas**: BD en memoria (`tests/helpers/bd-ponencias.ts`) que ejecuta las mismas consultas del módulo y
  restaura el estado si una transacción lanza; las pruebas atraviesan `app` con supertest, así que cubren
  guardas, validación y servicios a la vez.

## Archivos

| Área | Archivos |
|---|---|
| Esquema | `prisma/schema.prisma`, `prisma/migrations/20261020120000_ponencias_especializadas/` |
| Núcleo | `src/core/permisos.ts`, `src/core/resolutores-evento.ts`, `src/core/ponencias-especializadas.ts`, `src/middlewares/rate-limit.ts` |
| Módulo | `src/api/specialized-talk/**` |
| Seed | `src/database/seedPonenciasEspecializadas.ts`, `prisma/datos/ponencias-especializadas-2026.json`, `package.json` |
| Pruebas | `tests/specialized-talk/*`, `tests/core/ponencias-especializadas.test.ts`, `tests/helpers/bd-ponencias.ts`; actualizados `tests/security/matriz-rutas.test.ts` y `tests/core/permisos.test.ts` |
| Docs | `docs/api.md`, `docs/data-model.md`, `docs/overview.md`, `docs/arquitectura-ecosistema.md`, `README.md`, `AGENTS.md` |

## Despliegue

Backend (migración + `npm run seed:ponencias-especializadas -- --evento <código>`) → panel (spec 012) →
landing (spec 006). Panel y landing degradan si el backend aún no lo tiene. Los permisos nuevos no se
reparten solos: un Owner o Administrador los marca a cada cuenta de la Comisión en «Equipo y administradores».
